// Stage B: render each Stage A candidate's known sample string and pick
// whichever real font renders closest to the actual measured target
// profile (stroke-to-height ratio + ink density) — this is the step that
// turns a coarse metric shortlist into an actual typeSpec winner.
//
// Distance is compared in *rendered-profile space*, not as a raw pixel diff
// against the real photo crop: the real crop has a photo/card background,
// drop shadows, and exact alignment no clean candidate render will ever
// match, so a pixel L2 diff would mostly measure "is the background the
// same color" rather than "is the typography close."

import path from "node:path";
import { shortlistCandidates } from "./shortlist-candidates.mjs";
import { downloadFont } from "./download-font.mjs";
import { registerFont, renderAndMeasure } from "./render-and-measure.mjs";

// Both terms are on comparable scales (~0.03-0.15 for ratio, ~0.1-0.4 for
// density) so an unweighted normalized sum is a reasonable starting point;
// ratio (boldness) gets double weight since it's the more visually salient
// and more reliably measured of the two.
const RATIO_WEIGHT = 2;
const DENSITY_WEIGHT = 1;
const RATIO_SCALE = 0.05;
const DENSITY_SCALE = 0.15;

function categoryToGenericFamily(category) {
  switch (category) {
    case "Serif": return "serif";
    case "Monospace": return "monospace";
    case "Handwriting": return "cursive";
    case "Display": return "sans-serif";
    default: return "sans-serif";
  }
}

function inferAlign(box) {
  if (!box) return "left";
  const center = box.x + box.width / 2;
  if (Math.abs(center - 0.5) < 0.06) return "center";
  const rightEdge = box.x + box.width;
  if (rightEdge > 0.92) return "right";
  return "left";
}

/**
 * Matches one region's target profile against the font corpus. Returns
 * `null` (not a thrown error) when the region has no usable profile (e.g.
 * detect-regions never found a box) — callers decide whether that's a
 * skip-and-log or a hard failure; this module doesn't silently invent a
 * placeholder typeSpec for a region we have no real measurement for.
 */
export async function matchFont(profile, region, { shortlistLimit = 40 } = {}) {
  if (profile.error || profile.strokeToHeightRatio == null) {
    return null;
  }

  const { candidates } = await shortlistCandidates(profile, { limit: shortlistLimit });
  const targetRatio = profile.strokeToHeightRatio;
  const targetDensity = profile.inkDensity;
  const targetGlyphHeightPx = profile.glyphHeightPx;

  let winner = null;
  const attempted = [];

  for (const candidate of candidates) {
    let fontPath;
    try {
      fontPath = await downloadFont(candidate.woff2Url ?? candidate.ttfUrl);
    } catch {
      // A handful of URLs 404/timeout across a 7500-face corpus; skip this
      // candidate rather than aborting the whole region's match.
      continue;
    }
    const alias = `af-${candidate.id}-${candidate.weight}`;
    try {
      registerFont(fontPath, alias);
    } catch {
      continue;
    }

    const rendered = renderAndMeasure(region.sample, alias, candidate.weight, targetGlyphHeightPx);
    if (!rendered || rendered.strokeToHeightRatio == null) continue;

    const ratioDelta = Math.abs(rendered.strokeToHeightRatio - targetRatio) / RATIO_SCALE;
    const densityDelta = Math.abs(rendered.inkDensity - targetDensity) / DENSITY_SCALE;
    const distance = RATIO_WEIGHT * ratioDelta + DENSITY_WEIGHT * densityDelta;
    const fitScore = 1 / (1 + distance);

    attempted.push({ family: candidate.family, weight: candidate.weight, distance, fitScore });
    if (!winner || fitScore > winner.fitScore) {
      winner = { candidate, rendered, fitScore, distance };
    }
  }

  if (!winner) return null;

  return {
    key: region.key,
    fontId: winner.candidate.id,
    family: winner.candidate.family,
    fallbackFamily: categoryToGenericFamily(winner.candidate.category),
    weight: winner.candidate.weight,
    italic: false,
    case: profile.case,
    // Ratio of the CSS font-size that produced the matching render to the
    // *measured* target glyph height — a consumer with only the target
    // glyph height in their own pixel space computes
    // `fontSize = targetGlyphHeightPx * sizeRatio` to reproduce it at any
    // resolution, independent of this build's absolute pixel scale.
    sizeRatio: targetGlyphHeightPx ? winner.rendered.fontSizePx / targetGlyphHeightPx : null,
    lineHeight: winner.candidate.lineHeight ?? 1.2,
    tracking: 0, // not measured — default normal tracking, documented gap
    align: inferAlign(region.box),
    color: profile.colorHex,
    fitScore: Math.round(winner.fitScore * 1000) / 1000,
    candidatesEvaluated: attempted.length,
  };
}

// CLI: node match-font.mjs <profileJson> <regionJson>
if (import.meta.url === `file://${process.argv[1]}`) {
  const profile = JSON.parse(process.argv[2]);
  const region = JSON.parse(process.argv[3]);
  const result = await matchFont(profile, region);
  console.log(JSON.stringify(result, null, 2));
}
