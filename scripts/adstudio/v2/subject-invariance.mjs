#!/usr/bin/env node

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import {
  resolvePublicPath,
  resolveTemplateAssetPath,
} from "../../../src/lib/adstudio/v2/render/assets.ts";
import { renderAdDocToPng } from "../../../src/lib/adstudio/v2/render/server.ts";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT_PATH), "..", "..", "..");

export const SUBJECT_INVARIANCE_RUBRIC_VERSION = "adstudio-subject-invariance-v1";
export const FIXTURE_CORPUS_VERSION = "adstudio-subject-invariance-fixtures-v2";

// The real-photo fixture is a DURABLE, VERSIONED dependency of the canonical
// builder. The pinned file is committed at
//   public/adstudio-samples/photos/int-bedroom.png
// so every clean checkout can run the gate at full strength — no transient
// release-worktree file and no symlink indirection. Candidate builds must
// COPY this tree into the candidate root (never symlink it).
//
// v2 corpus note: the artifact was re-encoded losslessly from the v1 corpus
// photo; the decoded RGB pixels are unchanged (canonicalPixelHash identical),
// and the byte pin below matches the committed file exactly. Bump
// FIXTURE_CORPUS_VERSION whenever the corpus artifact or pins change.
const FIXTURE_WIDTH = 1600;
const FIXTURE_HEIGHT = 1000;
const FIXTURE_CORPUS = Object.freeze({
  realPhoto: {
    id: "unrelated-real-photo",
    path: "public/adstudio-samples/photos/int-bedroom.png",
    sha256: "1694485827645913c10ea99f2c71bda57f1172739d2baa4713fa96b8ae6a268f",
    canonicalPixelHash: "5cd890e4ccf0b31dbac879b265635d98793a6e645258198a359a21290a5a965a",
  },
  // Hashes are over decoded RGB pixels, not encoder-specific PNG bytes.
  canonicalPixelHashes: {
    "mid-grey": "4b47a0287b4f4f835a20590ecd849a15b611b18cf908cbbe44146e444402bfbe",
    "grid-gradient": "6baba4184ab5d08a3fbe43f9b69a02e671ab703f0d9fdf47cd393018da358925",
    "neutral-logo": "994a2c4687d1e179008eace8608e2becea27402fe641c380a8bad314bcfa5698",
  },
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function midGreyPixels(width = FIXTURE_WIDTH, height = FIXTURE_HEIGHT) {
  return Buffer.alloc(width * height * 3, 128);
}

function gridGradientPixels(width = FIXTURE_WIDTH, height = FIXTURE_HEIGHT) {
  const pixels = Buffer.allocUnsafe(width * height * 3);
  const majorX = Math.max(32, Math.round(width / 10));
  const majorY = Math.max(32, Math.round(height / 10));
  const minorX = Math.max(8, Math.round(majorX / 4));
  const minorY = Math.max(8, Math.round(majorY / 4));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const onMajor = x % majorX < 5 || y % majorY < 5;
      const onMinor = x % minorX < 2 || y % minorY < 2;
      const diagonal = Math.abs((x / width) - (y / height)) < 0.006;
      const reverseDiagonal = Math.abs((x / width) + (y / height) - 1) < 0.006;

      if (onMajor || diagonal || reverseDiagonal) {
        const black = (Math.floor(x / majorX) + Math.floor(y / majorY)) % 2 === 0;
        const value = black ? 0 : 255;
        pixels[offset] = value;
        pixels[offset + 1] = value;
        pixels[offset + 2] = value;
      } else if (onMinor) {
        pixels[offset] = 24;
        pixels[offset + 1] = 24;
        pixels[offset + 2] = 24;
      } else {
        pixels[offset] = clampByte((x / (width - 1)) * 255);
        pixels[offset + 1] = clampByte((y / (height - 1)) * 255);
        pixels[offset + 2] = clampByte(((x + y) / (width + height - 2)) * 255);
      }
    }
  }
  return pixels;
}

function neutralLogoPixels(width = 512, height = 512) {
  const pixels = Buffer.alloc(width * height * 3, 246);
  const cx = width / 2;
  const cy = height / 2;
  const outer = Math.min(width, height) * 0.34;
  const inner = outer * 0.58;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const distance = Math.hypot(x - cx, y - cy);
      const offset = (y * width + x) * 3;
      if (distance <= outer && distance >= inner) {
        pixels[offset] = 38;
        pixels[offset + 1] = 55;
        pixels[offset + 2] = 62;
      } else if (Math.abs(x - cx) < width * 0.035 || Math.abs(y - cy) < height * 0.035) {
        pixels[offset] = 206;
        pixels[offset + 1] = 161;
        pixels[offset + 2] = 74;
      }
    }
  }
  return pixels;
}

export function buildProceduralFixture(id) {
  if (id === "mid-grey") {
    return { data: midGreyPixels(), width: FIXTURE_WIDTH, height: FIXTURE_HEIGHT, channels: 3 };
  }
  if (id === "grid-gradient") {
    return { data: gridGradientPixels(), width: FIXTURE_WIDTH, height: FIXTURE_HEIGHT, channels: 3 };
  }
  if (id === "neutral-logo") {
    return { data: neutralLogoPixels(), width: 512, height: 512, channels: 3 };
  }
  throw new Error(`unknown procedural subject-invariance fixture: ${id}`);
}

async function encodeFixture(fixture) {
  return sharp(fixture.data, {
    raw: { width: fixture.width, height: fixture.height, channels: fixture.channels },
  }).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
}

function verifyCanonicalFixture(id, fixture) {
  const actual = sha256(fixture.data);
  const expected = FIXTURE_CORPUS.canonicalPixelHashes[id];
  if (!expected || expected.startsWith("PENDING_")) {
    throw new Error(`fixture ${id} has no pinned canonical pixel hash (actual ${actual})`);
  }
  if (actual !== expected) {
    throw new Error(`fixture ${id} canonical pixel hash mismatch: expected ${expected}, got ${actual}`);
  }
  return actual;
}

function parseArgs(argv) {
  const options = { id: "", imageKey: "", outDir: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--id") options.id = argv[++index] ?? "";
    else if (arg === "--image-key") options.imageKey = argv[++index] ?? "";
    else if (arg === "--out") options.outDir = argv[++index] ?? "";
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/adstudio/v2/subject-invariance.mjs --id <template-id> [--image-key <key>] [--out <dir>]",
    "",
    "Renders the fixed mid-grey, grid/gradient, and unrelated-photo corpus through the canonical renderer.",
    "The report separates ad-system likeness evidence from finished-result quality evidence.",
  ].join("\n");
}

function toPixelBox(box, width, height) {
  const left = Math.round(box.x * width);
  const top = Math.round(box.y * height);
  const right = Math.round((box.x + box.width) * width);
  const bottom = Math.round((box.y + box.height) * height);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function expandPixelBox(box, bleedPx, width, height) {
  return {
    left: Math.max(0, box.left - bleedPx),
    top: Math.max(0, box.top - bleedPx),
    right: Math.min(width, box.right + bleedPx),
    bottom: Math.min(height, box.bottom + bleedPx),
    width: Math.min(width, box.right + bleedPx) - Math.max(0, box.left - bleedPx),
    height: Math.min(height, box.bottom + bleedPx) - Math.max(0, box.top - bleedPx),
  };
}

function imageDependencyBoxes(layout, imageKey) {
  const slotBoxes = [];
  const effectBoxes = [];
  const allowedDependencyBoxes = [];
  for (const layer of layout.layers) {
    if (layer.type !== "image_slot" || layer.inputKey !== imageKey) continue;
    const slotBox = toPixelBox(layer.box, layout.width, layout.height);
    slotBoxes.push(slotBox);
    allowedDependencyBoxes.push(slotBox);
    const reflection = layer.effects?.reflection;
    if (reflection) {
      const effectBox = toPixelBox(reflection.box, layout.width, layout.height);
      // Three sigma is a conservative dependency allowance for a Gaussian
      // blur. The current isolated surface clips at its box, but the evidence
      // contract remains correct if the renderer later preserves natural bleed.
      const bleedPx = Math.ceil(reflection.blurPx * 3);
      effectBoxes.push({ ...effectBox, effect: "reflection", blurBleedPx: bleedPx });
      allowedDependencyBoxes.push(expandPixelBox(effectBox, bleedPx, layout.width, layout.height));
    }
  }
  return { slotBoxes, effectBoxes, allowedDependencyBoxes };
}

function isInsideAnyBox(x, y, boxes) {
  return boxes.some((box) => x >= box.left && x < box.right && y >= box.top && y < box.bottom);
}

function updateBounds(bounds, x, y) {
  if (!bounds) return { left: x, top: y, right: x + 1, bottom: y + 1 };
  bounds.left = Math.min(bounds.left, x);
  bounds.top = Math.min(bounds.top, y);
  bounds.right = Math.max(bounds.right, x + 1);
  bounds.bottom = Math.max(bounds.bottom, y + 1);
  return bounds;
}

export function computeDifferenceMetrics(first, second, width, height, boxes = [], threshold = 4) {
  if (first.length !== second.length || first.length !== width * height * 4) {
    throw new Error("difference inputs must be equal-sized RGBA buffers");
  }
  let changedPixels = 0;
  let changedInsideBoxes = 0;
  let changedOutsideBoxes = 0;
  let bounds = null;
  let outsideBounds = null;

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    const delta = Math.max(
      Math.abs(first[offset] - second[offset]),
      Math.abs(first[offset + 1] - second[offset + 1]),
      Math.abs(first[offset + 2] - second[offset + 2]),
      Math.abs(first[offset + 3] - second[offset + 3]),
    );
    if (delta <= threshold) continue;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const inside = isInsideAnyBox(x, y, boxes);
    changedPixels += 1;
    bounds = updateBounds(bounds, x, y);
    if (inside) changedInsideBoxes += 1;
    else {
      changedOutsideBoxes += 1;
      outsideBounds = updateBounds(outsideBounds, x, y);
    }
  }

  return {
    changedPixels,
    changedFraction: changedPixels / (width * height),
    changedInsideBoxes,
    changedOutsideBoxes,
    changedOutsideBoxesFraction: changedPixels === 0 ? 0 : changedOutsideBoxes / changedPixels,
    bounds,
    outsideBounds,
  };
}

function luminance(rgba, pixel) {
  const offset = pixel * 4;
  return rgba[offset] * 0.2126 + rgba[offset + 1] * 0.7152 + rgba[offset + 2] * 0.0722;
}

function gradientAt(rgba, x, y, width) {
  const pixel = y * width + x;
  const right = pixel + 1;
  const below = pixel + width;
  const center = luminance(rgba, pixel);
  return { dx: luminance(rgba, right) - center, dy: luminance(rgba, below) - center };
}

/**
 * Aligned source-pixel leakage detector for one source-sized plate or patch.
 * It only samples the live image-slot boxes. Flat colour coincidences are not
 * enough to fail: the source and asset must also share detailed edge structure.
 */
export function computeAlignedLeakageMetrics(source, asset, width, height, boxes, options = {}) {
  if (source.length !== asset.length || source.length !== width * height * 4) {
    throw new Error("leakage inputs must be equal-sized RGBA buffers");
  }
  const alphaFloor = options.alphaFloor ?? 16;
  const edgeFloor = options.edgeFloor ?? 12;
  const nearRgbThreshold = options.nearRgbThreshold ?? 12;
  const requiredEdgeSamples = options.requiredEdgeSamples ?? 400;
  const edgeMatchFailFraction = options.edgeMatchFailFraction ?? 0.28;
  const fragmentEdgeMatches = options.fragmentEdgeMatches ?? 100;
  const fragmentExactPixels = options.fragmentExactPixels ?? 1_000;
  let sampledPixels = 0;
  let opaquePixels = 0;
  let sourceEdgeSamples = 0;
  let nearSourcePixels = 0;
  let exactSourcePixels = 0;
  let matchingEdges = 0;
  let leakBounds = null;

  for (const box of boxes) {
    const left = Math.max(1, box.left);
    const top = Math.max(1, box.top);
    const right = Math.min(width - 1, box.right);
    const bottom = Math.min(height - 1, box.bottom);
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const pixel = y * width + x;
        const offset = pixel * 4;
        sampledPixels += 1;
        if (asset[offset + 3] < alphaFloor) continue;
        opaquePixels += 1;

        const rgbDelta = Math.max(
          Math.abs(source[offset] - asset[offset]),
          Math.abs(source[offset + 1] - asset[offset + 1]),
          Math.abs(source[offset + 2] - asset[offset + 2]),
        );
        if (rgbDelta === 0) exactSourcePixels += 1;
        if (rgbDelta <= nearRgbThreshold) nearSourcePixels += 1;

        const sourceGradient = gradientAt(source, x, y, width);
        const sourceMagnitude = Math.hypot(sourceGradient.dx, sourceGradient.dy);
        if (sourceMagnitude < edgeFloor) continue;
        sourceEdgeSamples += 1;
        const assetGradient = gradientAt(asset, x, y, width);
        const assetMagnitude = Math.hypot(assetGradient.dx, assetGradient.dy);
        if (assetMagnitude < edgeFloor * 0.5) continue;
        const direction = (
          sourceGradient.dx * assetGradient.dx + sourceGradient.dy * assetGradient.dy
        ) / (sourceMagnitude * assetMagnitude);
        const magnitudeRatio = assetMagnitude / sourceMagnitude;
        if (direction >= 0.92 && magnitudeRatio >= 0.55 && magnitudeRatio <= 1.8) {
          matchingEdges += 1;
          leakBounds = updateBounds(leakBounds, x, y);
        }
      }
    }
  }

  const matchingEdgeFraction = sourceEdgeSamples === 0 ? 0 : matchingEdges / sourceEdgeSamples;
  const broadStructureFail = sourceEdgeSamples >= requiredEdgeSamples && matchingEdgeFraction >= edgeMatchFailFraction;
  const alignedFragmentFail = matchingEdges >= fragmentEdgeMatches && exactSourcePixels >= fragmentExactPixels;
  const hardFail = broadStructureFail || alignedFragmentFail;
  return {
    sampledPixels,
    opaquePixels,
    sourceEdgeSamples,
    matchingEdges,
    matchingEdgeFraction,
    nearSourcePixels,
    nearSourcePixelFraction: opaquePixels === 0 ? 0 : nearSourcePixels / opaquePixels,
    exactSourcePixels,
    exactSourcePixelFraction: opaquePixels === 0 ? 0 : exactSourcePixels / opaquePixels,
    leakBounds,
    failureSignals: { broadStructureFail, alignedFragmentFail },
    hardFail,
    thresholds: {
      alphaFloor,
      edgeFloor,
      nearRgbThreshold,
      requiredEdgeSamples,
      edgeMatchFailFraction,
      fragmentEdgeMatches,
      fragmentExactPixels,
    },
  };
}

/**
 * Conservative fallback when the source and authored layout cannot be aligned
 * (for example a feed source extended into story). A source-free plate/patch
 * under a replaceable image must be neutral/analytic: low chroma and low
 * photographic detail. This does not prove visual likeness; it only proves
 * the static asset is not carrying a photo-like scene in the dependency area.
 */
export function computeNeutralAnalyticMetrics(asset, width, height, boxes, options = {}) {
  if (asset.length !== width * height * 4) {
    throw new Error("neutral/analytic input must be an RGBA buffer");
  }
  const alphaFloor = options.alphaFloor ?? 16;
  const chromaFloor = options.chromaFloor ?? 18;
  const edgeFloor = options.edgeFloor ?? 14;
  const maxHighChromaFraction = options.maxHighChromaFraction ?? 0.04;
  const maxHighDetailFraction = options.maxHighDetailFraction ?? 0.08;
  const maxLuminanceStdDev = options.maxLuminanceStdDev ?? 34;
  let sampledPixels = 0;
  let opaquePixels = 0;
  let highChromaPixels = 0;
  let highDetailPixels = 0;
  let luminanceSum = 0;
  let luminanceSquareSum = 0;

  for (const box of boxes) {
    const left = Math.max(1, box.left);
    const top = Math.max(1, box.top);
    const right = Math.min(width - 1, box.right);
    const bottom = Math.min(height - 1, box.bottom);
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const pixel = y * width + x;
        const offset = pixel * 4;
        sampledPixels += 1;
        if (asset[offset + 3] < alphaFloor) continue;
        opaquePixels += 1;
        const red = asset[offset];
        const green = asset[offset + 1];
        const blue = asset[offset + 2];
        if (Math.max(red, green, blue) - Math.min(red, green, blue) >= chromaFloor) {
          highChromaPixels += 1;
        }
        const value = luminance(asset, pixel);
        luminanceSum += value;
        luminanceSquareSum += value * value;
        const gradient = gradientAt(asset, x, y, width);
        if (Math.hypot(gradient.dx, gradient.dy) >= edgeFloor) highDetailPixels += 1;
      }
    }
  }

  const highChromaFraction = opaquePixels === 0 ? 0 : highChromaPixels / opaquePixels;
  const highDetailFraction = opaquePixels === 0 ? 0 : highDetailPixels / opaquePixels;
  const meanLuminance = opaquePixels === 0 ? 0 : luminanceSum / opaquePixels;
  const luminanceVariance = opaquePixels === 0
    ? 0
    : Math.max(0, luminanceSquareSum / opaquePixels - meanLuminance * meanLuminance);
  const luminanceStdDev = Math.sqrt(luminanceVariance);
  const hardFail = (
    highChromaFraction > maxHighChromaFraction ||
    highDetailFraction > maxHighDetailFraction ||
    luminanceStdDev > maxLuminanceStdDev
  );
  return {
    sampledPixels,
    opaquePixels,
    highChromaPixels,
    highChromaFraction,
    highDetailPixels,
    highDetailFraction,
    meanLuminance,
    luminanceStdDev,
    hardFail,
    thresholds: {
      alphaFloor,
      chromaFloor,
      edgeFloor,
      maxHighChromaFraction,
      maxHighDetailFraction,
      maxLuminanceStdDev,
    },
  };
}

async function rgba(bytes, width, height) {
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .resize(width, height, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * Verify the pinned real-photo corpus artifact against its committed pins.
 * Reads `repoRoot/public/adstudio-samples/photos/int-bedroom.png`, checks the
 * byte SHA-256 AND the decoded RGB pixel hash against FIXTURE_CORPUS, and
 * verifies the procedural fixtures' canonical pixel hashes. This is the
 * clean-checkout regression: a checkout missing the committed fixture (or a
 * candidate root that symlinked instead of copying) fails here before any
 * render work, exactly as the gate requires.
 */
export async function verifyPinnedFixtureCorpus(repoRoot) {
  const results = [];
  for (const id of ["mid-grey", "grid-gradient", "neutral-logo"]) {
    const fixture = buildProceduralFixture(id);
    const pixelHash = verifyCanonicalFixture(id, fixture);
    results.push({ id, canonicalPixelHash: pixelHash, sourceIndependent: true });
  }
  const realPath = join(repoRoot, FIXTURE_CORPUS.realPhoto.path);
  const sourceRealBytes = await readFile(realPath);
  const actualRealHash = sha256(sourceRealBytes);
  if (actualRealHash !== FIXTURE_CORPUS.realPhoto.sha256) {
    throw new Error(`fixed real-photo fixture hash mismatch: expected ${FIXTURE_CORPUS.realPhoto.sha256}, got ${actualRealHash}`);
  }
  const normalizedReal = await sharp(sourceRealBytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const actualRealPixelHash = sha256(normalizedReal.data);
  if (actualRealPixelHash !== FIXTURE_CORPUS.realPhoto.canonicalPixelHash) {
    throw new Error(`fixed real-photo fixture pixel hash mismatch: expected ${FIXTURE_CORPUS.realPhoto.canonicalPixelHash}, got ${actualRealPixelHash}`);
  }
  return {
    version: FIXTURE_CORPUS_VERSION,
    realPhoto: {
      id: FIXTURE_CORPUS.realPhoto.id,
      path: FIXTURE_CORPUS.realPhoto.path,
      byteSha256: actualRealHash,
      canonicalPixelHash: actualRealPixelHash,
    },
    procedural: results,
  };
}

async function fixtureCorpus(repoRoot, outDir) {
  const fixtures = [];
  for (const id of ["mid-grey", "grid-gradient"]) {
    const fixture = buildProceduralFixture(id);
    const canonicalPixelHash = verifyCanonicalFixture(id, fixture);
    const bytes = await encodeFixture(fixture);
    const path = join(outDir, `fixture-${id}.png`);
    await writeFile(path, bytes);
    fixtures.push({ id, bytes, path, byteHash: sha256(bytes), canonicalPixelHash, sourceIndependent: true });
  }

  const realPath = join(repoRoot, FIXTURE_CORPUS.realPhoto.path);
  const sourceRealBytes = await readFile(realPath);
  const actualRealHash = sha256(sourceRealBytes);
  if (actualRealHash !== FIXTURE_CORPUS.realPhoto.sha256) {
    throw new Error(`fixed real-photo fixture hash mismatch: expected ${FIXTURE_CORPUS.realPhoto.sha256}, got ${actualRealHash}`);
  }
  const normalizedReal = await sharp(sourceRealBytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const actualRealPixelHash = sha256(normalizedReal.data);
  if (actualRealPixelHash !== FIXTURE_CORPUS.realPhoto.canonicalPixelHash) {
    throw new Error(`fixed real-photo fixture pixel hash mismatch: expected ${FIXTURE_CORPUS.realPhoto.canonicalPixelHash}, got ${actualRealPixelHash}`);
  }
  // Re-encode from pinned pixels: the original corpus PNG contains metadata a
  // native canvas decoder misclassifies, while the visual pixels are valid.
  const realBytes = await encodeFixture({
    data: normalizedReal.data,
    width: normalizedReal.info.width,
    height: normalizedReal.info.height,
    channels: normalizedReal.info.channels,
  });
  const normalizedRealPath = join(outDir, "fixture-unrelated-real-photo.png");
  await writeFile(normalizedRealPath, realBytes);
  fixtures.push({
    id: FIXTURE_CORPUS.realPhoto.id,
    bytes: realBytes,
    path: normalizedRealPath,
    byteHash: sha256(realBytes),
    sourceByteHash: actualRealHash,
    canonicalPixelHash: actualRealPixelHash,
    sourceIndependent: true,
  });

  const logoFixture = buildProceduralFixture("neutral-logo");
  const logoCanonicalPixelHash = verifyCanonicalFixture("neutral-logo", logoFixture);
  const logoBytes = await encodeFixture(logoFixture);
  const logoPath = join(outDir, "fixture-neutral-logo.png");
  await writeFile(logoPath, logoBytes);

  return {
    fixtures,
    logo: {
      id: "neutral-logo",
      bytes: logoBytes,
      path: logoPath,
      byteHash: sha256(logoBytes),
      canonicalPixelHash: logoCanonicalPixelHash,
      sourceIndependent: true,
    },
  };
}

function buildInstance(doc, templateHash, format, fixtureId) {
  const images = Object.fromEntries(doc.inputs.images.map((input) => [
    input.key,
    { src: `subject-invariance:${input.key}:${fixtureId}` },
  ]));
  const text = Object.fromEntries(doc.inputs.text.map((input) => [input.key, input.sample]));
  return {
    schema: "adstudio.instance.v2",
    templateId: doc.id,
    templateHash,
    format,
    values: { images, text },
    overrides: [],
  };
}

async function scanSourceLeakage({ repoRoot, doc, sourceBytes, imageKey }) {
  const sourceMeta = await sharp(sourceBytes).metadata();
  const assetReports = [];

  for (const [layoutKey, layout] of Object.entries(doc.formats)) {
    if (!layout) continue;
    const sourceAspect = sourceMeta.width / sourceMeta.height;
    const layoutAspect = layout.width / layout.height;
    const aspectDelta = Math.abs(sourceAspect - layoutAspect) / layoutAspect;
    const dependencies = imageDependencyBoxes(layout, imageKey);
    if (dependencies.allowedDependencyBoxes.length === 0) continue;

    const assets = [
      { id: "plate", src: layout.plate.src },
      ...layout.layers
        .filter((layer) => layer.type === "overlay_patch")
        .map((layer) => ({ id: layer.id, src: layer.src })),
    ];
    if (aspectDelta > 0.02) {
      for (const asset of assets) {
        const bytes = await readFile(resolveTemplateAssetPath(repoRoot, asset.src));
        const decoded = (await rgba(bytes, layout.width, layout.height)).data;
        assetReports.push({
          layout: layoutKey,
          assetId: asset.id,
          src: asset.src,
          sha256: sha256(bytes),
          status: "neutral_analytic_fallback_measured",
          reason: `source aspect ${sourceAspect.toFixed(6)} differs from layout aspect ${layoutAspect.toFixed(6)}`,
          dependencyBoxes: dependencies,
          ...computeNeutralAnalyticMetrics(
            decoded,
            layout.width,
            layout.height,
            dependencies.allowedDependencyBoxes,
          ),
        });
      }
      continue;
    }
    const source = (await rgba(sourceBytes, layout.width, layout.height)).data;
    for (const asset of assets) {
      const bytes = await readFile(resolveTemplateAssetPath(repoRoot, asset.src));
      const decoded = (await rgba(bytes, layout.width, layout.height)).data;
      assetReports.push({
        layout: layoutKey,
        assetId: asset.id,
        src: asset.src,
        sha256: sha256(bytes),
        status: "measured",
        sourceAlignment: sourceMeta.width === layout.width && sourceMeta.height === layout.height
          ? "native"
          : `normalized_fill_from_${sourceMeta.width}x${sourceMeta.height}`,
        leakagePolicy: asset.id === "plate"
          ? "broad aligned photo structure; shared analytic card borders are permitted"
          : "broad structure plus strict aligned fragment detection",
        dependencyBoxes: dependencies,
        ...computeAlignedLeakageMetrics(
          source,
          decoded,
          layout.width,
          layout.height,
          dependencies.allowedDependencyBoxes,
          asset.id === "plate"
            ? {
                // A source-free plate intentionally retains the analytic card
                // frame, whose aligned rounded/vertical edges are also in the
                // source ad. Full photographic structure still hard-fails;
                // strict local fragments are owned by overlay-patch scans.
                fragmentEdgeMatches: Number.MAX_SAFE_INTEGER,
                fragmentExactPixels: Number.MAX_SAFE_INTEGER,
              }
            : undefined,
        ),
      });
    }
  }

  const sampleSrc = doc.provenance.sample.imageSrc;
  const samplePath = resolvePublicPath(repoRoot, sampleSrc);
  const sampleBytes = await readFile(samplePath);
  const sampleHash = sha256(sampleBytes);
  const sampleMetadata = await sharp(sampleBytes).metadata();
  const sampleLayout = doc.formats.feed;
  let publicSample;
  if (!sampleLayout) {
    publicSample = {
      src: sampleSrc,
      declaredHash: doc.provenance.sample.contentHash,
      actualHash: sampleHash,
      hardFail: true,
      blockers: ["template has no feed layout for its public sample"],
    };
  } else {
    const dependencies = imageDependencyBoxes(sampleLayout, imageKey);
    const dimensionsPassed = sampleMetadata.width === sampleLayout.width && sampleMetadata.height === sampleLayout.height;
    const hashMatchesProvenance = sampleHash === doc.provenance.sample.contentHash;
    const differsFromSourceHash = sampleHash !== doc.provenance.sourceAd.contentHash;
    let leakageMetrics = null;
    if (dimensionsPassed && dependencies.allowedDependencyBoxes.length > 0) {
      const source = (await rgba(sourceBytes, sampleLayout.width, sampleLayout.height)).data;
      const sample = (await rgba(sampleBytes, sampleLayout.width, sampleLayout.height)).data;
      leakageMetrics = computeAlignedLeakageMetrics(
        source,
        sample,
        sampleLayout.width,
        sampleLayout.height,
        dependencies.allowedDependencyBoxes,
        {
          // The finished sample intentionally shares rounded borders, fades,
          // and typography with the source ad inside this footprint. Those
          // can create small aligned exact fragments without carrying source
          // photo pixels. Plate/patch scans above own the strict fragment
          // gate; the finished sample independently fails on broad aligned
          // photographic structure.
          fragmentEdgeMatches: Number.MAX_SAFE_INTEGER,
          fragmentExactPixels: Number.MAX_SAFE_INTEGER,
        },
      );
    }
    const blockers = [
      ...(!hashMatchesProvenance ? ["public sample hash does not match provenance.sample.contentHash"] : []),
      ...(!differsFromSourceHash ? ["public sample hash equals the private source hash"] : []),
      ...(!dimensionsPassed ? [`public sample is ${sampleMetadata.width}x${sampleMetadata.height}; expected ${sampleLayout.width}x${sampleLayout.height}`] : []),
      ...(leakageMetrics?.hardFail ? ["public sample retains aligned source-photo pixels or edge structure"] : []),
    ];
    publicSample = {
      src: sampleSrc,
      path: relative(repoRoot, samplePath),
      declaredHash: doc.provenance.sample.contentHash,
      actualHash: sampleHash,
      hashMatchesProvenance,
      differsFromSourceHash,
      dimensions: { width: sampleMetadata.width, height: sampleMetadata.height },
      dimensionsPassed,
      dependencyBoxes: dependencies,
      alignedSourceLeakage: leakageMetrics,
      leakagePolicy: "broad aligned photo structure; strict local fragments are owned by the plate/patch asset scans",
      blockers,
      hardFail: blockers.length > 0,
    };
  }

  const failures = [
    ...assetReports.filter((asset) => asset.hardFail),
    ...(publicSample.hardFail ? [{ kind: "public_sample", ...publicSample }] : []),
  ];
  const unmeasured = assetReports.filter((asset) => asset.status === "unmeasured_requires_visual_review");
  return {
    assetReports,
    publicSample,
    failures,
    unmeasured,
    fullyMeasured: unmeasured.length === 0,
    passed: failures.length === 0 && unmeasured.length === 0,
  };
}

async function writeContactSheet(renderRecords, outPath) {
  const thumbWidth = 360;
  const labelHeight = 46;
  const gap = 18;
  const byFormat = new Map();
  for (const record of renderRecords) {
    const entries = byFormat.get(record.format) ?? [];
    entries.push(record);
    byFormat.set(record.format, entries);
  }
  const rows = Array.from(byFormat.values());
  const columns = Math.max(...rows.map((row) => row.length));
  const rowHeights = rows.map((row) => {
    const maxRatio = Math.max(...row.map((entry) => entry.height / entry.width));
    return Math.round(thumbWidth * maxRatio) + labelHeight;
  });
  const width = columns * thumbWidth + (columns + 1) * gap;
  const height = rowHeights.reduce((sum, value) => sum + value, 0) + (rows.length + 1) * gap;
  const composites = [];
  let top = gap;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    for (let column = 0; column < row.length; column += 1) {
      const record = row[column];
      const imageHeight = rowHeights[rowIndex] - labelHeight;
      const resized = await sharp(record.bytes).resize(thumbWidth, imageHeight, { fit: "contain", background: "#111827" }).png().toBuffer();
      const label = Buffer.from(
        `<svg width="${thumbWidth}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg">` +
        `<rect width="100%" height="100%" fill="#111827"/>` +
        `<text x="12" y="29" fill="#f9fafb" font-family="Arial, sans-serif" font-size="17">${record.fixtureId} · ${record.format}</text>` +
        `</svg>`,
      );
      const left = gap + column * (thumbWidth + gap);
      composites.push({ input: resized, left, top });
      composites.push({ input: label, left, top: top + imageHeight });
    }
    top += rowHeights[rowIndex] + gap;
  }
  await sharp({ create: { width, height, channels: 3, background: "#111827" } })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(outPath);
}

function criticRubric(imageKey) {
  return [
    `RUBRIC VERSION: ${SUBJECT_INVARIANCE_RUBRIC_VERSION}`,
    "",
    "Judge the reusable ad, not the subject inside the replaceable customer image.",
    `The replaceable image under review is \`${imageKey}\`.`,
    "",
    "AD-SYSTEM LIKENESS (0–10):",
    "Compare only canvas/card geometry, image-slot bounds/mask/crop behaviour, typography geometry, hierarchy, whitespace, logo anchor, and every template-applied fade, feather, gradient, overlay, shadow, colour transform, blur, glow, duotone, reflection, blend, and overlap.",
    "Exclude the house/room/person/product/scene, architecture, viewpoint, inherent lighting, colours, sharpness, weather, photographic style, and all source/customer pixel similarity.",
    "A source-photo or source-reflection fragment baked into a plate/patch is a hard fail, not likeness.",
    "",
    "RESULT QUALITY (0–10):",
    "Judge each finished ad on clarity, hierarchy, balance, readability, polish, and whether the current customer image is treated cleanly by the template.",
    "Do not compare the current image subject or its intrinsic photographic qualities with the source image.",
    "",
    "Return the two scores separately. If any rationale mentions subject, architecture, viewpoint, intrinsic lighting/colour/sharpness/style, or source/customer pixel similarity, the review is invalid.",
  ].join("\n");
}

export async function runSubjectInvariance({
  repoRoot = REPO_ROOT,
  templateId,
  imageKey: requestedImageKey = "",
  outDir: requestedOutDir = "",
} = {}) {
  if (!templateId) throw new Error("templateId is required");
  const templatePath = join(repoRoot, "src", "lib", "adstudio", "template-gallery-v2", templateId, "template.json");
  const templateBytes = await readFile(templatePath);
  const templateHash = sha256(templateBytes);
  const doc = JSON.parse(templateBytes.toString("utf8"));
  const imageKey = requestedImageKey || doc.inputs.images[0]?.key;
  if (!imageKey || !doc.inputs.images.some((input) => input.key === imageKey)) {
    throw new Error(`template ${templateId} has no image input ${imageKey || "(none)"}`);
  }

  const outDir = resolve(requestedOutDir || join(repoRoot, ".artifacts", "adstudio-subject-invariance", templateId));
  await mkdir(outDir, { recursive: true });
  const corpus = await fixtureCorpus(repoRoot, outDir);
  const sourcePath = join(repoRoot, "meta_ad_candidates", doc.provenance.sourceAd.file);
  const sourceBytes = await readFile(sourcePath);
  const sourceHash = sha256(sourceBytes);
  if (sourceHash !== doc.provenance.sourceAd.contentHash) {
    throw new Error(`source hash mismatch: expected ${doc.provenance.sourceAd.contentHash}, got ${sourceHash}`);
  }

  const formats = [
    ["feed", "4:5"],
    ["story", "9:16"],
  ].filter(([layout]) => doc.formats[layout]);
  const renderRecords = [];
  for (const fixture of corpus.fixtures) {
    for (const [layoutKey, format] of formats) {
      const freshSlotBytes = () => new Map(doc.inputs.images.map((input) => [
        input.key,
        Buffer.from(input.key === imageKey ? fixture.bytes : corpus.logo.bytes),
      ]));
      const instance = buildInstance(doc, templateHash, format, fixture.id);
      // Some native decoders may retain/detach the provided backing store.
      // Fresh buffers make replay determinism independent of decoder internals.
      let bytes;
      let replay;
      try {
        bytes = await renderAdDocToPng(doc, instance, format, { repoRoot, slotBytes: freshSlotBytes() });
        replay = await renderAdDocToPng(doc, instance, format, { repoRoot, slotBytes: freshSlotBytes() });
      } catch (error) {
        throw new Error(`subject-invariance render failed for ${fixture.id}/${layoutKey}: ${error?.message ?? error}`, { cause: error });
      }
      const path = join(outDir, `render-${layoutKey}-${fixture.id}.png`);
      await writeFile(path, bytes);
      const metadata = await sharp(bytes).metadata();
      renderRecords.push({
        layout: layoutKey,
        format,
        fixtureId: fixture.id,
        path,
        bytes,
        sha256: sha256(bytes),
        deterministicReplayHash: sha256(replay),
        deterministicReplayPassed: bytes.equals(replay),
        width: metadata.width,
        height: metadata.height,
      });
    }
  }

  const differenceEvidence = [];
  for (const [layoutKey, format] of formats) {
    const records = renderRecords.filter((record) => record.layout === layoutKey);
    const layout = doc.formats[layoutKey];
    const dependencies = imageDependencyBoxes(layout, imageKey);
    const decoded = new Map();
    for (const record of records) decoded.set(record.fixtureId, (await rgba(record.bytes, layout.width, layout.height)).data);
    for (const [firstId, secondId] of [
      ["mid-grey", "grid-gradient"],
      ["mid-grey", "unrelated-real-photo"],
      ["grid-gradient", "unrelated-real-photo"],
    ]) {
      const first = decoded.get(firstId);
      const second = decoded.get(secondId);
      const allowed = computeDifferenceMetrics(
        first,
        second,
        layout.width,
        layout.height,
        dependencies.allowedDependencyBoxes,
      );
      const slotOnly = computeDifferenceMetrics(
        first,
        second,
        layout.width,
        layout.height,
        dependencies.slotBoxes,
      );
      const effectsOnly = computeDifferenceMetrics(
        first,
        second,
        layout.width,
        layout.height,
        dependencies.effectBoxes,
      );
      const outsideTolerance = Math.max(16, Math.ceil(layout.width * layout.height * 0.00001));
      const expectedLiveEffectPixels = dependencies.effectBoxes.length === 0
        ? 0
        : Math.max(100, Math.ceil(dependencies.effectBoxes.reduce(
          (sum, box) => sum + box.width * box.height,
          0,
        ) * 0.001));
      differenceEvidence.push({
        layout: layoutKey,
        format,
        firstFixture: firstId,
        secondFixture: secondId,
        dependencies,
        ...allowed,
        changedInsideSlot: slotOnly.changedInsideBoxes,
        changedInsideDeclaredEffects: effectsOnly.changedInsideBoxes,
        expectedLiveEffectPixels,
        expectedLiveEffectPassed: dependencies.effectBoxes.length === 0
          ? true
          : effectsOnly.changedInsideBoxes >= expectedLiveEffectPixels,
        outsideDependencyTolerance: outsideTolerance,
        outsideDependencyPassed: allowed.changedOutsideBoxes <= outsideTolerance,
      });
    }
  }

  const sourceLeakage = await scanSourceLeakage({ repoRoot, doc, sourceBytes, imageKey });
  const contactSheetPath = join(outDir, "contact-sheet.png");
  await writeContactSheet(renderRecords, contactSheetPath);
  const rubricPath = join(outDir, "critic-rubric.txt");
  await writeFile(rubricPath, `${criticRubric(imageKey)}\n`);

  const allRendersDeterministic = renderRecords.every((record) => record.deterministicReplayPassed);
  const dimensionsPassed = renderRecords.every((record) => {
    const expected = record.format === "4:5" ? { width: 1080, height: 1350 } : { width: 1080, height: 1920 };
    return record.width === expected.width && record.height === expected.height;
  });
  const substitutionTransferPassed = differenceEvidence.every((evidence) => (
    evidence.changedInsideSlot > 0 &&
    evidence.expectedLiveEffectPassed &&
    evidence.outsideDependencyPassed
  ));
  const report = {
    schema: "adstudio.subject-invariance.evidence.v1",
    templateId,
    templateHash,
    source: {
      path: relative(repoRoot, sourcePath),
      sha256: sourceHash,
      usedOnlyForAssetIsolation: true,
      excludedFromCustomerImageSimilarity: true,
    },
    selectedImageInput: imageKey,
    fixtureCorpus: {
      version: FIXTURE_CORPUS_VERSION,
      lockedBeforeFinalCandidateScoring: true,
      sourceIndependent: true,
      fixtures: corpus.fixtures.map((fixture) => ({
        id: fixture.id,
        path: relative(outDir, fixture.path).startsWith("..") ? relative(repoRoot, fixture.path) : basename(fixture.path),
        byteHash: fixture.byteHash,
        sourceByteHash: fixture.sourceByteHash ?? fixture.byteHash,
        canonicalPixelHash: fixture.canonicalPixelHash,
        sourceIndependent: fixture.sourceIndependent,
      })),
      auxiliaryImages: [{
        id: corpus.logo.id,
        path: basename(corpus.logo.path),
        byteHash: corpus.logo.byteHash,
        canonicalPixelHash: corpus.logo.canonicalPixelHash,
        sourceIndependent: true,
      }],
    },
    adSystemLikeness: {
      score: null,
      scoreStatus: sourceLeakage.failures.length > 0
        ? "invalidated_by_static_source_image_leakage"
        : sourceLeakage.unmeasured.length > 0
          ? "blocked_by_unmeasured_source_isolation"
          : "pending_subject_invariant_visual_review",
      rubricVersion: SUBJECT_INVARIANCE_RUBRIC_VERSION,
      includes: [
        "canvas/card/slot geometry",
        "mask, crop, focal and fit behaviour",
        "template-applied image effects and overlaps",
        "typography geometry, hierarchy, whitespace and logo anchor",
      ],
      excludes: [
        "customer/source image subject or architecture",
        "viewpoint or scene composition",
        "intrinsic image lighting, colour, sharpness, weather or style",
        "source/customer image pixel similarity",
      ],
      sourcePixelIsolation: sourceLeakage,
      fixtureDifferenceEvidence: differenceEvidence,
      substitutionTransfer: {
        passed: substitutionTransferPassed,
        requiresFixtureChangesInsideEveryLiveSlot: true,
        requiresDeclaredEffectsToChangeWithTheCurrentFixture: true,
        requiresChangesOutsideSlotEffectDependenciesWithinTolerance: true,
      },
    },
    resultQuality: {
      score: null,
      scoreStatus: "pending_independent_visual_review",
      rubricVersion: SUBJECT_INVARIANCE_RUBRIC_VERSION,
      reviewArtifact: basename(contactSheetPath),
      reviewPrompt: basename(rubricPath),
      deterministicChecks: { allRendersDeterministic, dimensionsPassed },
      renders: renderRecords.map(({ bytes: _bytes, ...record }) => ({ ...record, path: basename(record.path) })),
      note: "Finished-ad quality is reviewed independently for each fixture; the fixture subject is never compared with the source image.",
    },
    gate: {
      passed: sourceLeakage.passed && substitutionTransferPassed && allRendersDeterministic && dimensionsPassed,
      blockers: [
        ...(sourceLeakage.failures.length > 0 ? ["source-derived or photo-like static pixels remain in plate/patch assets under the live image/effect footprint"] : []),
        ...(!sourceLeakage.fullyMeasured ? ["source isolation is unmeasured for one or more non-aligned layouts; visual review is required"] : []),
        ...(!substitutionTransferPassed ? ["fixture changes did not stay within or activate every declared slot/effect dependency"] : []),
        ...(!allRendersDeterministic ? ["canonical renderer was not byte-deterministic"] : []),
        ...(!dimensionsPassed ? ["one or more renders had incorrect dimensions"] : []),
      ],
      note: "A passing deterministic gate still requires the two independent visual scores. It never manufactures a numeric quality score.",
    },
  };

  const reportPath = join(outDir, "evidence.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { report, reportPath, contactSheetPath, rubricPath };
}

const invokedDirectly = process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(SCRIPT_PATH);
if (invokedDirectly) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    const result = await runSubjectInvariance({
      templateId: options.id,
      imageKey: options.imageKey,
      outDir: options.outDir,
    });
    process.stdout.write(`${JSON.stringify({
      templateId: result.report.templateId,
      passed: result.report.gate.passed,
      adSystemLikeness: result.report.adSystemLikeness.scoreStatus,
      resultQuality: result.report.resultQuality.scoreStatus,
      blockers: result.report.gate.blockers,
      evidence: result.reportPath,
      contactSheet: result.contactSheetPath,
    }, null, 2)}\n`);
    process.exitCode = result.report.gate.passed ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
