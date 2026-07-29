// Renders a candidate font's known sample string on a clean canvas and
// measures the same profile shape extract-target-profile.mjs measures from
// the real photo crop (stroke-to-height ratio, ink density, width per
// character) — so Stage B can compare "how this candidate actually renders"
// against "what the real ad creative actually looks like" in the same
// units, rather than a raw pixel diff against a crop that also contains
// photo background/card texture no candidate render will ever match.
//
// Pure-JS chamfer distance transform (no OpenCV subprocess) since this runs
// per-candidate, potentially thousands of times across the full corpus —
// subprocess spawn overhead alone would dominate runtime at that volume.

import { GlobalFonts, createCanvas } from "@napi-rs/canvas";

const registeredAliases = new Set();

export function registerFont(fontPath, alias) {
  if (registeredAliases.has(alias)) return;
  const ok = GlobalFonts.registerFromPath(fontPath, alias);
  if (!ok) throw new Error(`Failed to register font: ${fontPath} as ${alias}`);
  registeredAliases.add(alias);
}

const CHAMFER_ORTHO = 3;
const CHAMFER_DIAG = 4;
const CHAMFER_SCALE = 3;

/** Approximate distance-to-background (chamfer 3-4) for every ink pixel. */
function chamferDistanceTransform(mask, width, height) {
  const INF = 1e9;
  const dist = new Float32Array(width * height);
  for (let i = 0; i < mask.length; i++) dist[i] = mask[i] ? INF : 0;

  const at = (x, y) => dist[y * width + x];
  const set = (x, y, v) => {
    const i = y * width + x;
    if (v < dist[i]) dist[i] = v;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      let d = at(x, y);
      if (x > 0) d = Math.min(d, at(x - 1, y) + CHAMFER_ORTHO);
      if (y > 0) d = Math.min(d, at(x, y - 1) + CHAMFER_ORTHO);
      if (x > 0 && y > 0) d = Math.min(d, at(x - 1, y - 1) + CHAMFER_DIAG);
      if (x < width - 1 && y > 0) d = Math.min(d, at(x + 1, y - 1) + CHAMFER_DIAG);
      set(x, y, d);
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      if (!mask[y * width + x]) continue;
      let d = at(x, y);
      if (x < width - 1) d = Math.min(d, at(x + 1, y) + CHAMFER_ORTHO);
      if (y < height - 1) d = Math.min(d, at(x, y + 1) + CHAMFER_ORTHO);
      if (x < width - 1 && y < height - 1) d = Math.min(d, at(x + 1, y + 1) + CHAMFER_DIAG);
      if (x > 0 && y < height - 1) d = Math.min(d, at(x - 1, y + 1) + CHAMFER_DIAG);
      set(x, y, d);
    }
  }
  for (let i = 0; i < dist.length; i++) dist[i] /= CHAMFER_SCALE;
  return dist;
}

function measureRenderedMask(imageData, width, height) {
  const { data } = imageData;
  const mask = new Uint8Array(width * height);
  let inkCount = 0;
  for (let p = 0; p < width * height; p++) {
    // Text is drawn pure black on pure white; alpha-blended edge pixels
    // (anti-aliasing) land in between — threshold at mid-gray.
    const r = data[p * 4];
    if (r < 128) {
      mask[p] = 1;
      inkCount += 1;
    }
  }
  if (inkCount < 4) return null;

  const dist = chamferDistanceTransform(mask, width, height);
  let strokeSum = 0;
  for (let p = 0; p < mask.length; p++) if (mask[p]) strokeSum += dist[p];
  const strokeWidthPx = (strokeSum / inkCount) * 2;
  const inkDensity = inkCount / (width * height);
  return { inkDensity, strokeWidthPx };
}

/**
 * Renders `sampleText` in the registered `alias` font, tuning font size so
 * the rendered glyph height matches `targetGlyphHeightPx` (2 passes: an
 * initial guess, then a correction from the first pass's measured height —
 * em-size vs. actual cap/ascender-descender height isn't 1:1 and varies per
 * family, so a single fixed-ratio guess isn't reliable across candidates).
 */
export function renderAndMeasure(sampleText, alias, weight, targetGlyphHeightPx) {
  let fontSizePx = targetGlyphHeightPx;
  let measured = null;

  for (let pass = 0; pass < 2; pass++) {
    const probe = createCanvas(10, 10).getContext("2d");
    probe.font = `${weight} ${fontSizePx}px "${alias}"`;
    const m = probe.measureText(sampleText);
    const renderedHeight = (m.actualBoundingBoxAscent ?? fontSizePx * 0.75) +
      (m.actualBoundingBoxDescent ?? fontSizePx * 0.1);
    if (renderedHeight > 0.5) {
      fontSizePx = fontSizePx * (targetGlyphHeightPx / renderedHeight);
    }
    measured = m;
  }

  const width = Math.max(16, Math.ceil((measured.width ?? fontSizePx * sampleText.length * 0.6) + 20));
  const height = Math.max(16, Math.ceil(fontSizePx * 1.8));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000000";
  ctx.font = `${weight} ${fontSizePx}px "${alias}"`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(sampleText, 10, height * 0.75);

  const imageData = ctx.getImageData(0, 0, width, height);
  const renderProfile = measureRenderedMask(imageData, width, height);
  if (!renderProfile) return null;

  const finalMetrics = ctx.measureText(sampleText);
  const renderedHeightPx = (finalMetrics.actualBoundingBoxAscent ?? fontSizePx * 0.75) +
    (finalMetrics.actualBoundingBoxDescent ?? fontSizePx * 0.1);

  return {
    fontSizePx,
    textWidthPx: finalMetrics.width,
    glyphHeightPx: renderedHeightPx,
    inkDensity: renderProfile.inkDensity,
    strokeWidthPx: renderProfile.strokeWidthPx,
    strokeToHeightRatio: renderedHeightPx > 0 ? renderProfile.strokeWidthPx / renderedHeightPx : null,
    widthPerChar: sampleText.length > 0 ? finalMetrics.width / sampleText.length : null,
  };
}
