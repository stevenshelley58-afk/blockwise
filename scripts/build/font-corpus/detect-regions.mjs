// Offline text-region detection for the 71 gallery templates, using OCR
// instead of a live vision-model call (this build script has no API keys and
// must be reproducible/offline). We already know the EXACT string in every
// region (inputs.text[].sample) — OCR only needs to find WHERE it sits, not
// transcribe it perfectly, so a fuzzy match against the known strings is
// robust to the transcription noise stylized ad typography produces.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);
const CACHE_DIR = path.resolve(process.cwd(), ".cache/font-corpus/regions");
const UPSCALE = 2;
const MIN_WORD_CONF = 30;
// Bump when the matching algorithm changes. Region geometry is input to the
// persisted type specs, so reusing a cache made by an older matcher quietly
// preserves precisely the bad boxes a rebuild is intended to correct.
const REGION_DETECTION_VERSION = 6;
// Below this contiguous-match score, treat the box as unreliable — flagged
// in the output (`lowConfidence: true`) for a human/manual pass rather than
// silently trusted, per the "no silent caps" build principle.
const LOW_CONFIDENCE_THRESHOLD = 0.6;

function levenshtein(a, b) {
  const al = a.length, bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const dp = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) dp[j] = j;
  for (let i = 1; i <= al; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= bl; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[bl];
}

function normalizeForMatch(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function similarity(a, b) {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (!na || !nb) return 0;
  const dist = levenshtein(na, nb);
  return 1 - dist / Math.max(na.length, nb.length);
}

function lineCanContribute(lineText, sample) {
  const lineTokens = normalizeForMatch(lineText).split(" ").filter(Boolean);
  const sampleTokens = normalizeForMatch(sample).split(" ").filter(Boolean);
  if (!lineTokens.length || !sampleTokens.length) return false;
  return lineTokens.some((lineToken) => sampleTokens.some((sampleToken) => {
    return similarity(lineToken, sampleToken) >= 0.5;
  }));
}

// Plain grayscale loses contrast for saturated colored text on a
// near-white/near-black background (e.g. gold/orange CTA copy on a white
// card — both channels land at similar luminance). We OCR several
// preprocessed variants and pool every word they find rather than picking
// one "best" conversion up front: a saturated-color subheadline that
// grayscale drops entirely still shows up via the saturation-channel pass.
const VARIANTS = [
  {
    id: "gray",
    py: `
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
out = cv2.resize(gray, None, fx=${UPSCALE}, fy=${UPSCALE}, interpolation=cv2.INTER_CUBIC)
`,
  },
  {
    id: "gray-inv",
    // Light/white text on a dark background.
    py: `
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
inv = cv2.bitwise_not(gray)
out = cv2.resize(inv, None, fx=${UPSCALE}, fy=${UPSCALE}, interpolation=cv2.INTER_CUBIC)
`,
  },
  {
    id: "sat-inv",
    // Any saturated color (brand accent text, gold/orange CTAs, etc.) reads
    // as dark against a light/neutral background once you invert S: neutral
    // backgrounds have S=0 -> 255 (light), saturated text has S>0 -> darker.
    py: `
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
sat = hsv[:, :, 1]
inv = cv2.bitwise_not(sat)
out = cv2.resize(inv, None, fx=${UPSCALE}, fy=${UPSCALE}, interpolation=cv2.INTER_CUBIC)
`,
  },
];

async function ocrVariant(imagePath, variant) {
  const pyScript = `
import cv2, sys
img = cv2.imread(sys.argv[1])
${variant.py}
cv2.imwrite(sys.argv[2], out)
`;
  const tmpIn = `/tmp/ocr-${variant.id}-${path.basename(imagePath)}.png`;
  await execFileAsync("python3", ["-c", pyScript, imagePath, tmpIn]);
  const { stdout } = await execFileAsync("tesseract", [tmpIn, "stdout", "--psm", "11", "tsv"], {
    maxBuffer: 20 * 1024 * 1024,
  });
  const lines = stdout.trim().split("\n").slice(1);
  const words = [];
  for (const line of lines) {
    const cols = line.split("\t");
    if (cols.length < 12) continue;
    const [level, , blockNum, parNum, lineNum, , left, top, width, height, conf, ...textParts] = cols;
    const text = textParts.join("\t");
    if (Number(level) !== 5 || !text.trim()) continue;
    // Below MIN_WORD_CONF is overwhelmingly OCR hallucination on photo
    // texture (accent lighting, foliage, reflections misread as glyphs) —
    // real text, even stylized display/script type, scores well above this.
    // Keeping these would litter the line list with garbage entries that
    // sit BETWEEN real lines and break the contiguous multi-line merge
    // windows in matchRegionsToLines (see dedupeLines' doc comment).
    if (Number(conf) < MIN_WORD_CONF) continue;
    words.push({
      variant: variant.id,
      block: Number(blockNum), par: Number(parNum), line: Number(lineNum),
      left: Number(left) / UPSCALE, top: Number(top) / UPSCALE,
      width: Number(width) / UPSCALE, height: Number(height) / UPSCALE,
      conf: Number(conf), text,
    });
  }
  return words;
}

/**
 * Run every preprocessing variant and pool their words. Each variant's
 * block/par/line numbering is independent (tesseract restarts numbering per
 * run), so line-grouping keys are prefixed with the variant id — this keeps
 * variants from merging unrelated words into one box, while still letting a
 * region genuinely missed by one variant (e.g. grayscale) be picked up from
 * a duplicate line another variant (e.g. sat-inv) did detect.
 */
async function ocrTsv(imagePath) {
  const results = await Promise.all(VARIANTS.map((variant) => ocrVariant(imagePath, variant)));
  return results.flat();
}

/** Group words into OCR "lines" (same variant+block/par/line), each with a merged box + text. */
function groupIntoLines(words) {
  const byKey = new Map();
  for (const word of words) {
    const key = `${word.variant}:${word.block}:${word.par}:${word.line}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(word);
  }
  const lines = [];
  for (const group of byKey.values()) {
    group.sort((a, b) => a.left - b.left);
    const left = Math.min(...group.map((w) => w.left));
    const top = Math.min(...group.map((w) => w.top));
    const right = Math.max(...group.map((w) => w.left + w.width));
    const bottom = Math.max(...group.map((w) => w.top + w.height));
    lines.push({
      text: group.map((w) => w.text).join(" "),
      left, top, width: right - left, height: bottom - top,
      avgConf: group.reduce((s, w) => s + w.conf, 0) / group.length,
    });
  }
  // Reading order: top-to-bottom, then left-to-right.
  lines.sort((a, b) => (a.top - b.top) || (a.left - b.left));
  return lines;
}

function boxIou(a, b) {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  if (right <= left || bottom <= top) return 0;
  const intersection = (right - left) * (bottom - top);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Running OCR across several preprocessed variants (see VARIANTS above)
 * means the same real text line is usually detected multiple times — once
 * per variant that could "see" it — at near-identical positions. Left
 * un-deduped, those near-duplicates sit adjacent in reading order and
 * poison the multi-line merge windows in matchRegionsToLines (e.g. a
 * 3-line wrapped headline detected by 3 variants becomes 9 interleaved
 * lines, so no 5-line window ever contains one clean copy of all 3). Merge
 * any lines whose boxes overlap heavily (IoU > 0.4) into one, keeping the
 * highest-confidence transcription — this collapses cross-variant repeats
 * back down to one entry per real line while still keeping a line that only
 * one variant could see at all (no overlapping duplicate to merge into).
 */
function dedupeLines(lines) {
  const clusters = [];
  for (const line of lines) {
    const cluster = clusters.find((c) => boxIou(c.line, line) > 0.4);
    if (!cluster) {
      clusters.push({ line });
    } else if (line.avgConf > cluster.line.avgConf) {
      cluster.line = line;
    }
  }
  const deduped = clusters.map((c) => c.line);
  deduped.sort((a, b) => (a.top - b.top) || (a.left - b.left));
  return deduped;
}

/**
 * Match each declared text region to one OR MORE contiguous OCR lines
 * (wrapped headlines/body copy span several lines) by trying increasing
 * merge windows and keeping whichever contiguous run best matches the known
 * string. Greedy, in reading order, each OCR line consumed at most once.
 */
export function matchRegionsToLines(textInputs, lines, imageWidth, imageHeight) {
  const used = new Array(lines.length).fill(false);
  const results = [];
  // Longer expected strings first: give body copy first pick of its lines
  // before short headline/cta strings could accidentally swallow them.
  const order = [...textInputs].sort((a, b) => b.sample.length - a.sample.length);

  for (const input of order) {
    let best = null;
    for (let start = 0; start < lines.length; start++) {
      if (used[start]) continue;
      let mergedText = "";
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      const included = [];
      // Window generous enough to bridge low-confidence noise lines that
      // survive MIN_WORD_CONF filtering but still sit between two real,
      // widely-separated lines (e.g. a 2-line wrapped headline with a few
      // stray low-conf photo-texture "words" detected in the gap) — the
      // best-scoring contiguous run still wins, so widening this doesn't
      // make unrelated far-away merges likelier to be picked.
      for (let cursor = start; cursor < lines.length && cursor < start + 12; cursor++) {
        if (used[cursor]) break;
        if (!lineCanContribute(lines[cursor].text, input.sample)) continue;
        if (included.length) {
          const previous = lines[included[included.length - 1]];
          const gap = lines[cursor].top - (previous.top + previous.height);
          if (gap > imageHeight * 0.12) break;
        }
        included.push(cursor);
        mergedText = mergedText ? `${mergedText} ${lines[cursor].text}` : lines[cursor].text;
        left = Math.min(left, lines[cursor].left);
        top = Math.min(top, lines[cursor].top);
        right = Math.max(right, lines[cursor].left + lines[cursor].width);
        bottom = Math.max(bottom, lines[cursor].top + lines[cursor].height);
        const score = similarity(mergedText, input.sample);
        const candidate = {
          score,
          indices: [...included],
          left,
          top,
          width: right - left,
          height: bottom - top,
        };
        // OCR occasionally emits punctuation-only or duplicate fragments on
        // the line before/after real copy. Appending one does not change the
        // normalized string, so the former greedy `>` tie behaviour selected
        // the first, larger window and gave a single field another field's
        // geometry. On equal text confidence, prefer the tightest contiguous
        // run, then the smallest physical crop. This preserves genuine
        // wrapped copy while never inflating an exact one-line match.
        const candidateLines = candidate.indices.length;
        const bestLines = best ? best.indices.length : Infinity;
        const candidateArea = candidate.width * candidate.height;
        const bestArea = best ? best.width * best.height : Infinity;
        if (
          !best ||
          score > best.score + 1e-9 ||
          (Math.abs(score - best.score) <= 1e-9 && (
            candidateLines < bestLines ||
            (candidateLines === bestLines && candidateArea < bestArea)
          ))
        ) {
          best = candidate;
        }
      }
    }
    if (best && best.score > 0.35) {
      for (const index of best.indices) used[index] = true;
      results.push({
        key: input.key,
        sample: input.sample,
        score: best.score,
        lowConfidence: best.score < LOW_CONFIDENCE_THRESHOLD,
        // How many OCR lines the matched box spans — lets downstream glyph
        // measurement divide the crop height back into a per-line figure
        // for wrapped headlines/body copy instead of treating the whole
        // multi-line block as one glyph row.
        lineCount: best.indices.length,
        lineBoxes: best.indices.map((index) => ({
          x: lines[index].left / imageWidth,
          y: lines[index].top / imageHeight,
          width: lines[index].width / imageWidth,
          height: lines[index].height / imageHeight,
        })),
        lineTexts: best.indices.map((index) => lines[index].text),
        box: {
          x: best.left / imageWidth,
          y: best.top / imageHeight,
          width: best.width / imageWidth,
          height: best.height / imageHeight,
        },
      });
    } else {
      results.push({ key: input.key, sample: input.sample, score: best?.score ?? 0, lowConfidence: true, box: null });
    }
  }
  return results;
}

export async function detectTemplateRegions(templateId, imagePath, textInputs) {
  const cachePath = path.join(CACHE_DIR, `${templateId}.json`);
  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8"));
    if (cached.buildVersion === REGION_DETECTION_VERSION) return cached;
  } catch { /* not cached */ }

  const pySize = `
import cv2, sys
img = cv2.imread(sys.argv[1])
print(img.shape[1], img.shape[0])
`;
  const { stdout: dims } = await execFileAsync("python3", ["-c", pySize, imagePath]);
  const [imageWidth, imageHeight] = dims.trim().split(" ").map(Number);

  const words = await ocrTsv(imagePath);
  const lines = dedupeLines(groupIntoLines(words));
  const regions = matchRegionsToLines(textInputs, lines, imageWidth, imageHeight);

  await mkdir(CACHE_DIR, { recursive: true });
  const result = { buildVersion: REGION_DETECTION_VERSION, imageWidth, imageHeight, regions };
  await writeFile(cachePath, JSON.stringify(result, null, 2));
  return result;
}

// CLI: node detect-regions.mjs <templateId> <imagePath> <sample.json with text inputs>
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , templateId, imagePath, textInputsJson] = process.argv;
  const textInputs = JSON.parse(textInputsJson);
  const result = await detectTemplateRegions(templateId, imagePath, textInputs);
  console.log(JSON.stringify(result, null, 2));
}
