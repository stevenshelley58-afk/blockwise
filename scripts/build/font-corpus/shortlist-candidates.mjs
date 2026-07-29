// Stage A: cheaply narrow the ~1905-family / ~7527-face corpus down to a
// shortlist of candidate faces worth actually rendering and pixel-comparing
// in Stage B (rendering every face would mean thousands of canvas draws per
// region across 71 templates). Pure metric comparison against
// fonts.google.com's per-face thickness/slant/width — no font files are
// downloaded at this stage.
//
// This is deliberately a coarse filter, not a verdict: Stage B's actual
// rendered-pixel residual is what picks the winner. Stage A's job is only
// to make sure the true best-matching face is *somewhere* in the ~40
// candidates it hands off, spanning categories rather than assuming
// sans-serif — we have no serif/sans classifier from pixels alone, and this
// corpus's own templates use both (e.g. a serif display headline sits right
// next to sans body copy in some samples).

import { readFile } from "node:fs/promises";
import path from "node:path";

const CORPUS_PATH = path.resolve(process.cwd(), ".cache/font-corpus/corpus-metadata.json");

// Coarse strokeToHeightRatio -> CSS weight breakpoints. Calibrated loosely
// against common web-font rendering (a regular-weight sans typically lands
// ~0.045-0.06 stroke/height at moderate sizes; a heavy display headline
// stroke can run 0.09+). This only needs to get the ballpark right — Stage B
// tests the weights actually available for each shortlisted family and
// picks whichever real render matches best, so an off-by-one-bucket miss
// here is corrected there, not fatal.
const WEIGHT_BREAKPOINTS = [
  { maxRatio: 0.045, weight: 300 },
  { maxRatio: 0.058, weight: 400 },
  { maxRatio: 0.07, weight: 500 },
  { maxRatio: 0.085, weight: 600 },
  { maxRatio: 0.1, weight: 700 },
  { maxRatio: 0.12, weight: 800 },
  { maxRatio: Infinity, weight: 900 },
];

function estimateTargetWeight(strokeToHeightRatio) {
  if (strokeToHeightRatio == null) return 400;
  const bucket = WEIGHT_BREAKPOINTS.find((b) => strokeToHeightRatio <= b.maxRatio);
  return bucket.weight;
}

let corpusPromise = null;
export function loadCorpus() {
  if (!corpusPromise) {
    corpusPromise = readFile(CORPUS_PATH, "utf8").then((raw) => JSON.parse(raw).families);
  }
  return corpusPromise;
}

/**
 * Returns up to `limit` {family, face} candidates ranked for Stage B to
 * render and pixel-test against `profile`.
 */
export async function shortlistCandidates(profile, { limit = 40 } = {}) {
  const families = await loadCorpus();
  const targetWeight = estimateTargetWeight(profile.strokeToHeightRatio);

  const scored = [];
  for (const family of families) {
    if (family.isOpenSource === false) continue;
    // Nearest available weight for this family (most families don't ship
    // all 9 CSS weights) — never hard-exclude a family just because it
    // lacks the exact target weight.
    let best = null;
    for (const face of family.faces) {
      if (face.italic) continue; // none of the profiles we extract are italic yet
      const weightDelta = Math.abs(face.weight - targetWeight);
      if (!best || weightDelta < best.weightDelta) {
        best = { face, weightDelta };
      }
    }
    if (!best) continue;

    // Popularity is an inverse rank in google-font-metadata (lower = more
    // popular); fold it in as a mild tiebreaker so two equally-plausible
    // weight matches prefer the well-known, well-hinted family.
    const popularityPenalty = family.popularity ? Math.log10(family.popularity + 1) * 0.5 : 5;
    const score = best.weightDelta + popularityPenalty;

    scored.push({
      family: family.family,
      id: family.id,
      category: family.category,
      weight: best.face.weight,
      italic: best.face.italic,
      ttfUrl: best.face.ttfUrl,
      woff2Url: best.face.woff2Url,
      thickness: best.face.thickness,
      lineHeight: best.face.lineHeight,
      score,
    });
  }

  scored.sort((a, b) => a.score - b.score);
  return { targetWeight, candidates: scored.slice(0, limit) };
}

// CLI: node shortlist-candidates.mjs <profileJson>
if (import.meta.url === `file://${process.argv[1]}`) {
  const profile = JSON.parse(process.argv[2]);
  const result = await shortlistCandidates(profile);
  console.log(JSON.stringify(result, null, 2));
}
