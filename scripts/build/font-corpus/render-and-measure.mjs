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
  const coverageMask = new Uint8Array(width * height);
  const strokeMask = new Uint8Array(width * height);
  let inkCount = 0;
  let strokeCount = 0;
  for (let p = 0; p < width * height; p++) {
    // Target profiles retain visibly anti-aliased edge pixels.  Mid-gray
    // discarded those pixels from clean renders while keeping them in a
    // textured source crop, systematically making clean geometric sans faces
    // appear too light.  This threshold mirrors the source-profile contrast
    // floor against a white card/paper background.
    const r = data[p * 4];
    if (r < 240) {
      coverageMask[p] = 1;
      inkCount += 1;
    }
    // Must mirror the target profile's opaque-core threshold. Coverage and
    // thickness intentionally use different masks (see target extractor).
    if (r < 128) {
      strokeMask[p] = 1;
      strokeCount += 1;
    }
  }
  if (inkCount < 4 || strokeCount < 4) return null;

  const dist = chamferDistanceTransform(strokeMask, width, height);
  let strokeSum = 0;
  for (let p = 0; p < strokeMask.length; p++) if (strokeMask[p]) strokeSum += dist[p];
  const strokeWidthPx = (strokeSum / strokeCount) * 2;
  // Density must describe the text treatment, not arbitrary canvas padding.
  // The source profile measures its OCR text box; use the equivalent tight
  // bounds for a candidate render so a serif does not win merely because its
  // clean render happened to use a smaller empty canvas fraction.
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!coverageMask[y * width + x]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const inkBoundsArea = Math.max(1, (maxX - minX + 1) * (maxY - minY + 1));
  const inkDensity = inkCount / inkBoundsArea;
  return { inkDensity, strokeWidthPx };
}

/**
 * Renders `sampleText` in the registered `alias` font, tuning font size so
 * the rendered glyph height matches `targetGlyphHeightPx` (2 passes: an
 * initial guess, then a correction from the first pass's measured height —
 * em-size vs. actual cap/ascender-descender height isn't 1:1 and varies per
 * family, so a single fixed-ratio guess isn't reliable across candidates).
 */
function wrapToDeclaredLines(context, sampleText, lineCount, targetTextWidthPx) {
  const words = sampleText.trim().split(/\s+/u).filter(Boolean);
  const count = Math.max(1, Math.min(lineCount, words.length));
  if (count === 1) return [words.join(" ")];
  const target = Math.max(1, targetTextWidthPx ?? context.measureText(words.join(" ")).width / count);
  const memo = new Map();
  const choose = (start, remaining) => {
    const key = `${start}:${remaining}`;
    if (memo.has(key)) return memo.get(key);
    if (remaining === 1) {
      const line = words.slice(start).join(" ");
      const result = { cost: ((context.measureText(line).width - target) / target) ** 2, lines: [line] };
      memo.set(key, result);
      return result;
    }
    let winner = null;
    for (let end = start + 1; end <= words.length - remaining + 1; end += 1) {
      const line = words.slice(start, end).join(" ");
      const rest = choose(end, remaining - 1);
      const cost = ((context.measureText(line).width - target) / target) ** 2 + rest.cost;
      if (!winner || cost < winner.cost) winner = { cost, lines: [line, ...rest.lines] };
    }
    memo.set(key, winner);
    return winner;
  };
  return choose(0, count).lines;
}

export function renderAndMeasure(sampleText, alias, weight, targetGlyphHeightPx, {
  lineCount = 1,
  targetTextWidthPx = null,
  lineHeight = 1.2,
} = {}) {
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

  const layoutProbe = createCanvas(10, 10).getContext("2d");
  layoutProbe.font = `${weight} ${fontSizePx}px "${alias}"`;
  const lines = wrapToDeclaredLines(layoutProbe, sampleText, lineCount, targetTextWidthPx);
  const lineWidths = lines.map((line) => layoutProbe.measureText(line).width);
  const width = Math.max(16, Math.ceil(Math.max(...lineWidths, 0) + 20));
  const height = Math.max(16, Math.ceil(fontSizePx * 1.8 + (lines.length - 1) * fontSizePx * lineHeight));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000000";
  ctx.font = `${weight} ${fontSizePx}px "${alias}"`;
  ctx.textBaseline = "alphabetic";
  const firstBaseline = fontSizePx * 0.75;
  lines.forEach((line, index) => {
    ctx.fillText(line, 10, firstBaseline + index * fontSizePx * lineHeight);
  });

  const imageData = ctx.getImageData(0, 0, width, height);
  const renderProfile = measureRenderedMask(imageData, width, height);
  if (!renderProfile) return null;

  const finalMetrics = ctx.measureText(lines[0] ?? sampleText);
  const renderedHeightPx = (finalMetrics.actualBoundingBoxAscent ?? fontSizePx * 0.75) +
    (finalMetrics.actualBoundingBoxDescent ?? fontSizePx * 0.1);

  return {
    fontSizePx,
    textWidthPx: Math.max(...lineWidths, 0),
    glyphHeightPx: renderedHeightPx,
    inkDensity: renderProfile.inkDensity,
    strokeWidthPx: renderProfile.strokeWidthPx,
    strokeToHeightRatio: renderedHeightPx > 0 ? renderProfile.strokeWidthPx / renderedHeightPx : null,
    widthPerChar: sampleText.length > 0 ? Math.max(...lineWidths, 0) / sampleText.length : null,
    lines,
  };
}
