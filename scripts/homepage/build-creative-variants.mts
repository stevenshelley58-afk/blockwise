import { stat, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import {
  CREATIVE_SOURCE_WIDTHS,
  CREATIVE_WIDTH_STEPS,
  creativeImageSrcSet,
} from "../../src/lib/homepage-concept/creative-image.ts";
import { AD_EXAMPLES, AD_LIBRARY, SHOWCASE_ADS } from "../../src/lib/homepage-concept/content.ts";

/**
 * Writes the homepage responsive variants: `-192`, `-384` and `-750` WebP copies
 * beside every creative the homepage renders.
 *
 * The widths come from `CREATIVE_SOURCE_WIDTHS` and the ladder from
 * `CREATIVE_WIDTH_STEPS`, so the srcset the page emits and the files on disk are
 * generated from one definition. Steps at or above a source's own width are
 * skipped rather than upscaled, and a source whose measured width disagrees with
 * the map is reported instead of quietly generating an over-claimed candidate.
 *
 * Idempotent: an existing variant whose real width already matches its step is
 * left untouched. Run it after adding or replacing a homepage creative, then
 * commit the new files. `tests/homepage-creative-variants.test.ts` is the guard.
 *
 * The filenames carry the width, not the encoding, and `/adstudio-thumbnails/`
 * variants are served `immutable` for a year, so changing how a step is encoded
 * means changing the step (or the name) rather than quietly rewriting a file.
 */
const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public");
const VARIANT_MAX_BYTES = 120_000;

const images = [
  ...new Set([
    ...SHOWCASE_ADS.map((ad) => ad.image),
    ...AD_EXAMPLES.map((example) => example.image),
    ...AD_LIBRARY.map((entry) => entry.image),
  ]),
].sort();

const mismatches = [];
let written = 0;
let kept = 0;
let bytes = 0;

for (const image of images) {
  const sourcePath = path.join(PUBLIC_DIR, image.replace(/^\//, ""));
  const sourceWidth = await measureImageWidth(sourcePath);
  const declaredWidth = CREATIVE_SOURCE_WIDTHS[image];

  if (!declaredWidth) {
    mismatches.push(`${image} is missing from CREATIVE_SOURCE_WIDTHS.`);
    continue;
  }
  if (sourceWidth !== declaredWidth) {
    mismatches.push(`${image} is ${sourceWidth}px wide; CREATIVE_SOURCE_WIDTHS says ${declaredWidth}.`);
    continue;
  }

  for (const step of CREATIVE_WIDTH_STEPS) {
    if (step >= sourceWidth) continue;
    const outputPath = sourcePath.replace(/\.webp$/, `-${step}.webp`);
    if ((await measureImageWidth(outputPath)) === step) {
      kept += 1;
      continue;
    }
    bytes += await encodeBounded(sourcePath, outputPath, step, VARIANT_MAX_BYTES);
    written += 1;
  }
}

if (mismatches.length > 0) {
  for (const mismatch of mismatches) process.stderr.write(`${mismatch}\n`);
  throw new Error("Fix CREATIVE_SOURCE_WIDTHS before generating homepage variants.");
}

process.stdout.write(`Homepage creatives: ${images.length} sources, ${written} variants written (${Math.round(bytes / 1024)} KB), ${kept} already correct.\n`);
process.stdout.write(`Sample srcset: ${creativeImageSrcSet(images[0])}\n`);

/** Rendered pixel width of a local image, or 0 when it cannot be read. */
async function measureImageWidth(filePath) {
  try {
    return (await sharp(filePath).metadata()).width ?? 0;
  } catch {
    return 0;
  }
}

/** Encodes `sourcePath` at `width`, stepping quality down until it fits `maxBytes`. */
async function encodeBounded(sourcePath, outputPath, width, maxBytes) {
  let quality = width >= 1080 ? 80 : 74;
  let output;
  do {
    output = await sharp(sourcePath)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality, effort: 6, smartSubsample: true })
      .toBuffer();
    quality -= 4;
  } while (output.byteLength > maxBytes && quality >= 38);

  if (output.byteLength > maxBytes) {
    throw new Error(`${outputPath} is ${output.byteLength} bytes (limit ${maxBytes}).`);
  }
  await writeFile(outputPath, output);
  if ((await stat(outputPath)).size !== output.byteLength) {
    throw new Error(`Incomplete output: ${outputPath}`);
  }
  return output.byteLength;
}
