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
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);
const CACHE_DIR = path.resolve(process.cwd(), ".cache/font-corpus/profiles");
const PROFILE_MEASUREMENT_VERSION = 6;

function sourceImageHash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizedRegionBox(region) {
  if (!region.box) return null;
  const { x, y, width, height } = region.box;
  return { x, y, width, height };
}

function normalizedLineBoxes(region) {
  return Array.isArray(region.lineBoxes)
    ? region.lineBoxes.map(({ x, y, width, height }) => ({ x, y, width, height }))
    : null;
}

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
# Keep the OCR-matched box as the measurement area.  The surrounding band is
# only used to learn the local paper/card colour.  Mixing that band into the
# ink measurement made subtle paper grain look like glyph coverage.
pad = max(6, int(0.30 * ph))
x0, y0 = max(0, px - pad), max(0, py - pad)
x1, y1 = min(iw, px + pw + pad), min(ih, py + ph + pad)
crop = img[y0:y1, x0:x1]
ch, cw = crop.shape[:2]
if ch < 3 or cw < 3:
    print(json.dumps({"error": "crop too small"}))
    sys.exit(0)

# Only pixels outside the matched text box can establish the background.
# A ring carved from a small padded crop intersects ascenders/descenders, so
# its average becomes a blend of paper and ink (particularly bad on textured
# stock).  Median is deliberately robust to isolated decorative marks.
core_x0, core_y0 = px - x0, py - y0
core_x1, core_y1 = core_x0 + pw, core_y0 + ph
background_mask = np.ones((ch, cw), dtype=bool)
background_mask[core_y0:core_y1, core_x0:core_x1] = False
background_pixels = crop[background_mask].reshape(-1, 3)
# A box can sit beside a photograph or colour block.  Choose the dominant
# local surface rather than averaging every surrounding colour together; the
# latter turns a paper background grey and can erase dark glyphs entirely.
cluster_count = min(3, len(background_pixels))
if cluster_count > 1:
    cv2.setRNGSeed(0)
    _, labels, centers = cv2.kmeans(
        background_pixels.astype(np.float32), cluster_count, None,
        (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 25, 0.5),
        1, cv2.KMEANS_PP_CENTERS,
    )
    labels = labels.reshape(-1)
    dominant = int(np.bincount(labels, minlength=cluster_count).argmax())
    surface_pixels = background_pixels[labels == dominant]
    bg_color = np.median(surface_pixels, axis=0)
else:
    surface_pixels = background_pixels
    bg_color = np.median(background_pixels, axis=0)

diff = np.linalg.norm(crop.astype(np.float32) - bg_color.astype(np.float32), axis=2)
# Texture/noise is measured from the known background band, never the text
# area.  The floor still accepts anti-aliased text while the adaptive term
# rejects a noisy paper surface on other templates.
background_diff = np.linalg.norm(
    surface_pixels.astype(np.float32) - bg_color.astype(np.float32), axis=1
)
threshold = max(24.0, float(np.percentile(background_diff, 99.5)) * 1.8)
ink_mask = (diff > threshold).astype(np.uint8)
# The outer band is context only, not ink.  This also prevents a nearby rule,
# shadow or paper defect from changing density/stroke measurements.
ink_mask[background_mask] = 0

# Coverage should include visibly anti-aliased edges, but stroke thickness
# must be measured from the opaque glyph core.  Using the same permissive
# threshold for both makes light geometric sans faces look semibold simply
# because their anti-aliasing expands the distance transform.
stroke_threshold = max(48.0, min(128.0, threshold * 3.0))
stroke_mask = (diff > stroke_threshold).astype(np.uint8)
stroke_mask[background_mask] = 0

ink_count = int(ink_mask.sum())
total = max(1, pw * ph)
stroke_count = int(stroke_mask.sum())
if ink_count < 8 or stroke_count < 8:
    print(json.dumps({"error": "no ink pixels found", "inkDensity": 0}))
    sys.exit(0)

ink_density = ink_count / total

dist = cv2.distanceTransform(stroke_mask * 255, cv2.DIST_L2, 5)
stroke_values = dist[stroke_mask.astype(bool)]
# distanceTransform gives distance to nearest zero (background) pixel, i.e.
# roughly the stroke half-width at each ink pixel's location; doubling the
# mean approximates full stroke width.
stroke_width_px = float(stroke_values.mean()) * 2

ink_pixels = crop[stroke_mask.astype(bool)].reshape(-1, 3)
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
    "measurementWidthPx": pw,
    "measurementHeightPx": ph,
    "inkDensity": round(ink_density, 5),
    "strokeWidthPx": round(stroke_width_px, 3),
    "colorHex": ink_color_hex,
    "backgroundColorHex": bg_color_hex,
    "backgroundNoiseP995": round(float(np.percentile(background_diff, 99.5)), 3),
    "inkThreshold": round(threshold, 3),
    "strokeThreshold": round(stroke_threshold, 3),
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
  const regionBox = normalizedRegionBox(region);
  const lineBoxes = normalizedLineBoxes(region);
  // The same template/key is deliberately reused when OCR improves.  A
  // measurement cache is valid only for the precise source pixels it read;
  // version alone cannot detect a newly-tightened box or replaced sample.
  const imageHash = sourceImageHash(await readFile(imagePath));
  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8"));
    if (
      cached.measurementVersion === PROFILE_MEASUREMENT_VERSION
      && cached.sourceImageHash === imageHash
      && JSON.stringify(cached.regionBox) === JSON.stringify(regionBox)
      && JSON.stringify(cached.lineBoxes) === JSON.stringify(lineBoxes)
    ) return cached;
  } catch { /* not cached */ }

  if (!region.box) {
    const profile = {
      measurementVersion: PROFILE_MEASUREMENT_VERSION,
      sourceImageHash: imageHash,
      regionBox,
      lineBoxes,
      key: region.key,
      error: "no matched box",
      ...classifyCase(region.sample),
    };
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
  const measuredLineHeights = (region.lineBoxes ?? [])
    .map((box) => box?.height * imageHeight)
    .filter((height) => Number.isFinite(height) && height > 0);
  const glyphHeightPx = measuredLineHeights.length
    ? measuredLineHeights.reduce((sum, height) => sum + height, 0) / measuredLineHeights.length
    : pixelProfile.measurementHeightPx
      ? pixelProfile.measurementHeightPx / lineCount
      : null;
  // Stroke-to-height ratio is what actually transfers across image scale /
  // DPI and is what Stage A compares against fonts.google.com's per-face
  // `thickness` metric — raw stroke px is meaningless without it.
  const strokeToHeightRatio =
    pixelProfile.strokeWidthPx && glyphHeightPx ? pixelProfile.strokeWidthPx / glyphHeightPx : null;

  const profile = {
    measurementVersion: PROFILE_MEASUREMENT_VERSION,
    sourceImageHash: imageHash,
    regionBox,
    lineBoxes,
    key: region.key,
    sample: region.sample,
    ...classifyCase(region.sample),
    ...pixelProfile,
    lineCount,
    glyphHeightPx,
    strokeToHeightRatio,
    // The OCR box is a tight measurement of the actual ink width. The crop
    // intentionally has padding for colour/stroke analysis, so cropWidthPx
    // must not be used as the target glyph width.
    textWidthPx: region.box.width * imageWidth,
    widthPerChar: region.sample.length > 0
      ? (region.box.width * imageWidth) / region.sample.length
      : null,
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
