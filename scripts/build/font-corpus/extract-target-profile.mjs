// For each matched region (see detect-regions.mjs), measure a "target
// profile" from the actual crop pixels: how bold the strokes are, how tall
// the glyphs are, and what color the text is. This profile drives both the
// Stage A corpus shortlist (thickness/slant/width scoring against
// fonts.google.com metadata) and the final typeSpec's `color` field.
//
// Case (upper/lower/mixed) doesn't need pixel analysis — we already know
// the exact declared string (inputs.text[].sample), so it's derived from
// that directly rather than guessed from OCR'd glyph shapes.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);
const CACHE_DIR = path.resolve(process.cwd(), ".cache/font-corpus/profiles");

// Classifies each pixel as "ink" (the glyph strokes) vs "background" by
// distance from the estimated background color, rather than a single global
// Otsu threshold — this way it doesn't matter whether the text is light-on-
// dark, dark-on-light, or a saturated color against a near-neutral card;
// only the crop's own border ring (assumed mostly background) sets the
// reference color.
const PY_SCRIPT = `
import cv2, sys, json, numpy as np

image_path, x, y, w, h = sys.argv[1], *[float(v) for v in sys.argv[2:6]]
img = cv2.imread(image_path)
ih, iw = img.shape[:2]
px, py, pw, ph = int(x * iw), int(y * ih), int(w * iw), int(h * ih)
# A few px of padding so we don't clip ascenders/descenders right at the
# fuzzy-matched box edge, clamped to image bounds.
pad = max(2, int(0.08 * ph))
x0, y0 = max(0, px - pad), max(0, py - pad)
x1, y1 = min(iw, px + pw + pad), min(ih, py + ph + pad)
crop = img[y0:y1, x0:x1]
ch, cw = crop.shape[:2]
if ch < 3 or cw < 3:
    print(json.dumps({"error": "crop too small"}))
    sys.exit(0)

# Border ring (outer ~12% of the crop) approximates local background.
ring = max(1, int(0.12 * min(ch, cw)))
border_mask = np.zeros((ch, cw), dtype=bool)
border_mask[:ring, :] = True
border_mask[-ring:, :] = True
border_mask[:, :ring] = True
border_mask[:, -ring:] = True
bg_color = crop[border_mask].reshape(-1, 3).mean(axis=0)

diff = np.linalg.norm(crop.astype(np.float32) - bg_color.astype(np.float32), axis=2)
threshold = max(30.0, float(np.percentile(diff, 90)) * 0.35)
ink_mask = (diff > threshold).astype(np.uint8)
# Border ring is background by construction; excluding it from the ink mask
# avoids crop-edge artifacts (rounded card corners, drop shadows) reading as
# "ink".
ink_mask[border_mask] = 0

ink_count = int(ink_mask.sum())
total = ch * cw
if ink_count < 8:
    print(json.dumps({"error": "no ink pixels found", "inkDensity": 0}))
    sys.exit(0)

ink_density = ink_count / total

dist = cv2.distanceTransform(ink_mask * 255, cv2.DIST_L2, 5)
stroke_values = dist[ink_mask.astype(bool)]
# distanceTransform gives distance to nearest zero (background) pixel, i.e.
# roughly the stroke half-width at each ink pixel's location; doubling the
# mean approximates full stroke width.
stroke_width_px = float(stroke_values.mean()) * 2

ink_pixels = crop[ink_mask.astype(bool)].reshape(-1, 3)
ink_color_bgr = ink_pixels.mean(axis=0)
ink_color_hex = "#{:02x}{:02x}{:02x}".format(
    int(round(ink_color_bgr[2])), int(round(ink_color_bgr[1])), int(round(ink_color_bgr[0]))
)
bg_color_hex = "#{:02x}{:02x}{:02x}".format(
    int(round(bg_color[2])), int(round(bg_color[1])), int(round(bg_color[0]))
)

print(json.dumps({
    "cropWidthPx": cw,
    "cropHeightPx": ch,
    "inkDensity": round(ink_density, 5),
    "strokeWidthPx": round(stroke_width_px, 3),
    "colorHex": ink_color_hex,
    "backgroundColorHex": bg_color_hex,
}))
`;

function classifyCase(sample) {
  const letters = sample.replace(/[^a-zA-Z]/g, "");
  if (!letters) return { case: "none", uppercaseRatio: 0 };
  const upperCount = (letters.match(/[A-Z]/g) ?? []).length;
  const uppercaseRatio = upperCount / letters.length;
  if (uppercaseRatio === 1) return { case: "upper", uppercaseRatio };
  if (uppercaseRatio === 0) return { case: "lower", uppercaseRatio };
  return { case: "mixed", uppercaseRatio };
}

export async function extractTargetProfile(templateId, region, imagePath, imageWidth, imageHeight) {
  const cachePath = path.join(CACHE_DIR, `${templateId}--${region.key}.json`);
  try {
    return JSON.parse(await readFile(cachePath, "utf8"));
  } catch { /* not cached */ }

  if (!region.box) {
    const profile = { key: region.key, error: "no matched box", ...classifyCase(region.sample) };
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cachePath, JSON.stringify(profile, null, 2));
    return profile;
  }

  const { stdout } = await execFileAsync("python3", [
    "-c",
    PY_SCRIPT,
    imagePath,
    String(region.box.x),
    String(region.box.y),
    String(region.box.width),
    String(region.box.height),
  ]);
  const pixelProfile = JSON.parse(stdout.trim().split("\n").pop());

  const lineCount = region.lineCount ?? 1;
  const glyphHeightPx = pixelProfile.cropHeightPx ? pixelProfile.cropHeightPx / lineCount : null;
  // Stroke-to-height ratio is what actually transfers across image scale /
  // DPI and is what Stage A compares against fonts.google.com's per-face
  // `thickness` metric — raw stroke px is meaningless without it.
  const strokeToHeightRatio =
    pixelProfile.strokeWidthPx && glyphHeightPx ? pixelProfile.strokeWidthPx / glyphHeightPx : null;

  const profile = {
    key: region.key,
    sample: region.sample,
    ...classifyCase(region.sample),
    ...pixelProfile,
    lineCount,
    glyphHeightPx,
    strokeToHeightRatio,
  };

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cachePath, JSON.stringify(profile, null, 2));
  return profile;
}

// CLI: node extract-target-profile.mjs <templateId> <imagePath> <regionJson>
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , templateId, imagePath, regionJson] = process.argv;
  const region = JSON.parse(regionJson);
  const pySizeScript = `
import cv2, sys
img = cv2.imread(sys.argv[1])
print(img.shape[1], img.shape[0])
`;
  const { stdout: dims } = await execFileAsync("python3", ["-c", pySizeScript, imagePath]);
  const [imageWidth, imageHeight] = dims.trim().split(" ").map(Number);
  const profile = await extractTargetProfile(templateId, region, imagePath, imageWidth, imageHeight);
  console.log(JSON.stringify(profile, null, 2));
}
