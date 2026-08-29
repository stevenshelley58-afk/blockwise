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

// Every AdStudio gallery template's declared copy is English/Latin. Several
// popular Google Fonts families are variants hinted/optimized for a
// specific non-Latin script but still ship a Latin subset (so they're
// technically usable and can even score well on thickness/width) — e.g.
// "Noto Sans JP" renders Latin text fine, but picking a CJK-oriented family
// for English marketing copy is a poor aesthetic match even when its raw
// metrics line up. Exclude these by name rather than trying to detect
// script intent from metadata that doesn't reliably encode it.
const NON_LATIN_NAME_PATTERN =
  /\b(JP|KR|SC|TC|HK|Devanagari|Gujarati|Gurmukhi|Bengali|Tamil|Telugu|Kannada|Malayalam|Oriya|Sinhala|Thai|Lao|Khmer|Myanmar|Georgian|Armenian|Hebrew|Arabic|Ethiopic|Cherokee|Nastaliq|Kufi|Naskh|Sans HK)\b/;

function estimateTargetWeight(strokeToHeightRatio) {
  if (strokeToHeightRatio == null) return 400;
  const bucket = WEIGHT_BREAKPOINTS.find((b) => strokeToHeightRatio <= b.maxRatio);
  return bucket.weight;
}

// Google Fonts records these axes on a compact 1–10 scale. The profile has
// real pixel measurements instead, so convert them only into a broad bucket.
// This remains a shortlist heuristic: Stage B is the fidelity decision.
function estimateTargetThickness(targetWeight) {
  return Math.min(8, Math.max(3, Math.round((targetWeight + 100) / 150)));
}

function estimateTargetWidth(profile) {
  if (!Number.isFinite(profile.widthPerChar) || !Number.isFinite(profile.glyphHeightPx) || profile.glyphHeightPx <= 0) {
    return null;
  }
  // A normal Latin face occupies roughly 0.55 glyph-heights per character.
  // Clamp because letter distribution in a sample string is not a font axis.
  return Math.min(10, Math.max(1, Math.round((profile.widthPerChar / profile.glyphHeightPx) * 12)));
}

function categoryBucket(candidate) {
  // A Display classification is a secondary style tag: Playfair Display is
  // correctly categorised as Serif and should count toward that coverage.
  if (candidate.category === "Display") return "display";
  if (candidate.category === "Serif") return "serif";
  return "other";
}

function categoryReservations(limit) {
  if (limit < 8) return { display: 0, serif: 0 };
  // The corpus labels several high-contrast marketing faces as Serif and
  // others as Display. Reserve a small, fixed share for both so a popularity
  // run of generic sans faces cannot exclude an entire visual class.
  return {
    display: Math.max(2, Math.floor(limit * 0.15)),
    serif: Math.max(3, Math.floor(limit * 0.3)),
  };
}

function categoryCap(category, limit) {
  // A very popular handwriting or monospace family can otherwise consume most
  // of an English marketing shortlist when its coarse weight matches. Keep a
  // representative set for Stage B without allowing either niche category to
  // crowd out measured text faces.
  if (category === "Handwriting" || category === "Monospace") return Math.max(2, Math.floor(limit * 0.1));
  return limit;
}

/**
 * Pure Stage-A ranking, exported so its coverage can be regression-tested
 * against a small synthetic corpus without downloading a font.
 */
export function rankShortlistCandidates(profile, families, { limit = 40 } = {}) {
  const targetWeight = estimateTargetWeight(profile.strokeToHeightRatio);
  const targetThickness = estimateTargetThickness(targetWeight);
  const targetWidth = estimateTargetWidth(profile);
  const scored = [];

  for (const family of families) {
    if (family.isOpenSource === false) continue;
    if (NON_LATIN_NAME_PATTERN.test(family.family)) continue;

    let best = null;
    for (const face of family.faces) {
      if (face.italic) continue;
      // Keep the coarse CSS-weight bucket as the dominant signal. Width and
      // thickness resolve faces within that bucket; they must not make a
      // handwritten 400 outrank a measured 700 merely because its metadata
      // happens to be more complete.
      const weightPenalty = Math.abs(face.weight - targetWeight);
      // Missing Google metadata is common, especially on display families.
      // Treat it as uncertainty, not a free perfect score or an exclusion.
      const thicknessPenalty = Number.isFinite(face.thickness)
        ? Math.abs(face.thickness - targetThickness) / 3
        : 0.25;
      const widthPenalty = targetWidth !== null && Number.isFinite(face.width)
        ? Math.abs(face.width - targetWidth) / 4
        : targetWidth !== null ? 0.25 : 0;
      const metricScore = weightPenalty + thicknessPenalty + widthPenalty;
      if (!best || metricScore < best.metricScore) best = { face, metricScore };
    }
    if (!best) continue;

    // Popularity is now strictly a tiebreaker. It must not drown out the
    // actual per-face width and thickness metadata we fetched for this job.
    const popularityPenalty = family.popularity ? Math.log10(family.popularity + 1) * 0.05 : 0.5;
    const legacyPopularityPenalty = family.popularity ? Math.log10(family.popularity + 1) * 0.5 : 5;
    const candidate = {
      family: family.family,
      id: family.id,
      category: family.category,
      classifications: family.classifications ?? [],
      weight: best.face.weight,
      italic: best.face.italic,
      ttfUrl: best.face.ttfUrl,
      woff2Url: best.face.woff2Url,
      thickness: best.face.thickness,
      width: best.face.width,
      lineHeight: best.face.lineHeight,
      score: best.metricScore + popularityPenalty,
      // Preserve the old broad fallback order for the non-reserved portion of
      // the budget. The new metric rank broadens coverage; it must not evict
      // proven same-weight candidates wholesale before Stage B can compare.
      fallbackScore: Math.abs(best.face.weight - targetWeight) + legacyPopularityPenalty,
    };
    scored.push(candidate);
  }

  scored.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  const reservations = categoryReservations(limit);
  const selected = [];
  const selectedIds = new Set();
  const selectedByCategory = new Map();
  const select = (candidate) => {
    selected.push(candidate);
    selectedIds.add(candidate.id);
    selectedByCategory.set(candidate.category, (selectedByCategory.get(candidate.category) ?? 0) + 1);
  };
  const addFrom = (bucket, count) => {
    for (const candidate of scored) {
      if (selected.length >= limit || count <= 0) break;
      if (selectedIds.has(candidate.id) || categoryBucket(candidate) !== bucket) continue;
      select(candidate);
      count -= 1;
    }
  };
  addFrom("display", reservations.display);
  addFrom("serif", reservations.serif);
  const fallbackOrder = [...scored].sort((a, b) => a.fallbackScore - b.fallbackScore || a.id.localeCompare(b.id));
  for (const candidate of fallbackOrder) {
    if (selected.length >= limit) break;
    if (selectedIds.has(candidate.id)) continue;
    if ((selectedByCategory.get(candidate.category) ?? 0) >= categoryCap(candidate.category, limit)) continue;
    select(candidate);
  }

  // Preserve the metric rank for Stage-B diagnostics while returning a stable
  // selection order; selected candidates are still rendered independently.
  selected.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  return {
    targetWeight,
    targetThickness,
    targetWidth,
    candidates: selected.map(({ fallbackScore, ...candidate }) => candidate),
  };
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
  return rankShortlistCandidates(profile, families, { limit });
}

// CLI: node shortlist-candidates.mjs <profileJson>
if (import.meta.url === `file://${process.argv[1]}`) {
  const profile = JSON.parse(process.argv[2]);
  const result = await shortlistCandidates(profile);
  console.log(JSON.stringify(result, null, 2));
}
