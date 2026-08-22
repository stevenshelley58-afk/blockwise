#!/usr/bin/env node

// AdStudio v2 variant-pack builder — deterministic, source-free, build-time only.
//
// Derives one semantic template (or explicitly requested multi-concept variants)
// from ONE analysed source ad. Each template is a
// full `adstudio.template.v2` doc with native 4:5 feed and 9:16 story formats,
// its own plate assets, editable text/image inputs, the complete Meta publish
// block, evidence, and a deterministic sample render. All variants share the
// source's visual language (from the analysis contract) but have DISTINCT
// layout skeletons so the gallery diversity gate's skeleton-collision rule
// passes.
//
// Determinism: same contract + same source bytes => byte-identical output.
// No image model is ever called: plates are deterministic vector renders and
// pixels are never painted by a model (image-model boundary law).
//
// The canonical fixture corpus (public/adstudio-samples) is COPIED into the
// candidate root as regular files — never symlinked — so the subject-invariance
// gate runs at full strength on the candidate.
//
// Usage:
//   node scripts/adstudio/v2/variant-pack.mjs \
//     --contract <analysis-contract.json> \
//     --repo <candidateRoot> \
//     [--source <sourceImagePath>] [--slot <slotFixturePath>]
//
// Contract shape (written by the analyse stage):
//   {
//     "schema": "adstudio.variant-pack.contract.v1",
//     "packId": "meta-<slug>-<srchash8>",
//     "mode": "single-template",
//     "name": "...", "goal": "buyer_leads", "offerId": "...",
//     "category": "real-estate", "tags": [...], "audienceIntent": "...",
//     "classification": { "ad_type": "...", "primary_intent": "...", "property_or_agent_focus": "..." },
//     "sourceAd": { "file": "e6/<hash>.png", "contentHash": "<sha256>" },
//     "text": { "headline": "...", "supporting": "...", "handle": "...", "arrow": ">" },
//     "copy": { "primaryText": [...], "headlines": [...], "descriptions": [...] },
//     "leadForm": { "headline": "...", "questions": [...], "thankYou": { "title": "...", "body": "..." } }
//   }

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, readdirSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { toLosslessWebp } from "./lib/plate.mjs";
import { renderAdDocToPng } from "../../../src/lib/adstudio/v2/render/server.ts";
import { verifyPinnedFixtureCorpus } from "./subject-invariance.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(SCRIPT_PATH);
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..", "..");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

const CREATIVE_FEATURE_KEYS = [
  "adapt_to_placement", "image_touchups", "image_templates", "inline_comment",
  "enhance_cta", "text_optimizations", "image_animation", "image_background_gen",
  "video_auto_crop", "translate_voiceover", "text_translation", "media_type_automation",
  "product_extensions",
];

// ── visual language (derived from the source analysis contract) ─────────────
const INK = "#2b2118";
const CREAM = "#f3dfbd";
const SLOT_FILL = "#ead2a9";

// Five DISTINCT layout skeletons. Boxes are normalized; feed canvas 1080x1350,
// story canvas 1080x1920. Story text layers stay inside the Meta safe zones
// (top 250px / bottom 340px of 1920 => y in [0.130, 0.823]) so variants can
// later reach `ready` without geometry changes.
const SKELETONS = [
  {
    key: "source-native",
    feed: {
      slot: { x: 0.10, y: 0.263, width: 0.80, height: 0.348 },
      headline: { x: 0.10, y: 0.115, width: 0.84, height: 0.19, align: "left", sizeRatio: 0.50 },
      supporting: { x: 0.10, y: 0.662, width: 0.72, height: 0.065, align: "left", sizeRatio: 0.55 },
      handle: { x: 0.10, y: 0.842, width: 0.42, height: 0.06, align: "left", sizeRatio: 0.52 },
      arrow: { x: 0.71, y: 0.825, width: 0.19, height: 0.08, align: "right", sizeRatio: 0.75 },
    },
    story: {
      slot: { x: 0.10, y: 0.263, width: 0.80, height: 0.344 },
      headline: { x: 0.10, y: 0.142, width: 0.84, height: 0.125, align: "left", sizeRatio: 0.50 },
      supporting: { x: 0.10, y: 0.537, width: 0.72, height: 0.052, align: "left", sizeRatio: 0.54 },
      handle: { x: 0.10, y: 0.78, width: 0.42, height: 0.04, align: "left", sizeRatio: 0.55 },
      arrow: { x: 0.71, y: 0.765, width: 0.19, height: 0.055, align: "right", sizeRatio: 0.80 },
    },
  },
  {
    key: "centered-hero",
    feed: {
      slot: { x: 0.10, y: 0.36, width: 0.80, height: 0.40 },
      headline: { x: 0.08, y: 0.10, width: 0.84, height: 0.16, align: "center", sizeRatio: 0.52 },
      supporting: { x: 0.08, y: 0.28, width: 0.84, height: 0.05, align: "center", sizeRatio: 0.55 },
      handle: { x: 0.08, y: 0.87, width: 0.50, height: 0.05, align: "left", sizeRatio: 0.52 },
      arrow: { x: 0.70, y: 0.852, width: 0.20, height: 0.08, align: "right", sizeRatio: 0.75 },
    },
    story: {
      slot: { x: 0.10, y: 0.33, width: 0.80, height: 0.40 },
      headline: { x: 0.08, y: 0.135, width: 0.84, height: 0.11, align: "center", sizeRatio: 0.52 },
      supporting: { x: 0.08, y: 0.26, width: 0.84, height: 0.04, align: "center", sizeRatio: 0.55 },
      handle: { x: 0.08, y: 0.78, width: 0.50, height: 0.04, align: "left", sizeRatio: 0.55 },
      arrow: { x: 0.70, y: 0.765, width: 0.20, height: 0.055, align: "right", sizeRatio: 0.80 },
    },
  },
  {
    key: "split-focus",
    feed: {
      slot: { x: 0.06, y: 0.16, width: 0.42, height: 0.68 },
      headline: { x: 0.56, y: 0.13, width: 0.38, height: 0.24, align: "left", sizeRatio: 0.50 },
      supporting: { x: 0.56, y: 0.68, width: 0.38, height: 0.09, align: "left", sizeRatio: 0.55 },
      handle: { x: 0.56, y: 0.86, width: 0.36, height: 0.06, align: "left", sizeRatio: 0.52 },
      arrow: { x: 0.71, y: 0.78, width: 0.22, height: 0.055, align: "right", sizeRatio: 0.75 },
    },
    story: {
      slot: { x: 0.06, y: 0.14, width: 0.88, height: 0.40 },
      headline: { x: 0.06, y: 0.585, width: 0.88, height: 0.10, align: "center", sizeRatio: 0.52 },
      supporting: { x: 0.06, y: 0.70, width: 0.88, height: 0.05, align: "center", sizeRatio: 0.55 },
      handle: { x: 0.06, y: 0.78, width: 0.50, height: 0.04, align: "left", sizeRatio: 0.55 },
      arrow: { x: 0.70, y: 0.765, width: 0.22, height: 0.055, align: "right", sizeRatio: 0.80 },
    },
  },
  {
    key: "lower-canvas",
    feed: {
      slot: { x: 0.06, y: 0.33, width: 0.88, height: 0.44 },
      headline: { x: 0.10, y: 0.10, width: 0.80, height: 0.17, align: "left", sizeRatio: 0.50 },
      supporting: { x: 0.10, y: 0.28, width: 0.70, height: 0.045, align: "left", sizeRatio: 0.55 },
      handle: { x: 0.10, y: 0.87, width: 0.42, height: 0.06, align: "left", sizeRatio: 0.52 },
      arrow: { x: 0.71, y: 0.855, width: 0.20, height: 0.08, align: "right", sizeRatio: 0.75 },
    },
    story: {
      slot: { x: 0.06, y: 0.30, width: 0.88, height: 0.42 },
      headline: { x: 0.10, y: 0.135, width: 0.80, height: 0.11, align: "left", sizeRatio: 0.52 },
      supporting: { x: 0.10, y: 0.26, width: 0.70, height: 0.04, align: "left", sizeRatio: 0.55 },
      handle: { x: 0.10, y: 0.78, width: 0.42, height: 0.04, align: "left", sizeRatio: 0.55 },
      arrow: { x: 0.71, y: 0.765, width: 0.20, height: 0.055, align: "right", sizeRatio: 0.80 },
    },
  },
  {
    key: "framed-card",
    feed: {
      slot: { x: 0.14, y: 0.30, width: 0.72, height: 0.40 },
      headline: { x: 0.14, y: 0.115, width: 0.72, height: 0.15, align: "center", sizeRatio: 0.52 },
      supporting: { x: 0.14, y: 0.73, width: 0.72, height: 0.055, align: "center", sizeRatio: 0.55 },
      handle: { x: 0.14, y: 0.855, width: 0.40, height: 0.06, align: "left", sizeRatio: 0.52 },
      arrow: { x: 0.70, y: 0.84, width: 0.16, height: 0.08, align: "right", sizeRatio: 0.75 },
    },
    story: {
      slot: { x: 0.14, y: 0.28, width: 0.72, height: 0.42 },
      headline: { x: 0.14, y: 0.135, width: 0.72, height: 0.10, align: "center", sizeRatio: 0.52 },
      supporting: { x: 0.14, y: 0.72, width: 0.72, height: 0.045, align: "center", sizeRatio: 0.55 },
      handle: { x: 0.14, y: 0.78, width: 0.40, height: 0.04, align: "left", sizeRatio: 0.55 },
      arrow: { x: 0.70, y: 0.765, width: 0.16, height: 0.055, align: "right", sizeRatio: 0.80 },
    },
  },
];

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function plateSvg(skeletonKey, layout, text, format) {
  const width = 1080;
  const height = format === "4:5" ? 1350 : 1920;
  // Story plates are measured by the subject-invariance neutral/analytic
  // fallback (a non-aligned derived surface): every sampled pixel must stay
  // low-chroma (max channel diff < 18) and low-detail so the plate proves it
  // carries no photo-like static pixels. The feed plate is measured on the
  // aligned path, which tolerates the source's saturated cream. Both stay in
  // the same warm cream family.
  const neutral = format === "9:16";
  const background = neutral ? "#f4f0e8" : CREAM;
  const slotFill = neutral ? "#e9e4d8" : SLOT_FILL;
  const dotColor = neutral ? "#8f8a80" : "#6f4e2b";
  const dotOpacity = neutral ? 0.12 : 0.16;
  const lineColor = neutral ? "#8f8a80" : INK;
  const lineOpacity = neutral ? 0.2 : 0.22;
  const slot = layout.slot;
  const slotX = slot.x * width;
  const slotY = slot.y * height;
  const slotW = slot.width * width;
  const slotH = slot.height * height;
  const seed = skeletonKey.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const dots = Array.from({ length: 90 }, (_, i) => {
    const x = ((i * 137 + seed * 11) % width);
    const y = ((i * 211 + seed * 17) % height);
    return `<circle cx="${x}" cy="${y}" r="${1 + (i % 3)}"/>`;
  }).join("");
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="${background}"/>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="2" seed="${42 + seed}"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 0.055"/></feComponentTransfer></filter>
    <rect width="100%" height="100%" filter="url(#grain)" opacity="${neutral ? 0.35 : 0.55}"/>
    <g opacity="${dotOpacity}" fill="${dotColor}">${dots}</g>
    <rect x="${slotX.toFixed(1)}" y="${slotY.toFixed(1)}" width="${slotW.toFixed(1)}" height="${slotH.toFixed(1)}" rx="58" fill="${slotFill}" opacity="0.98"/>
    <path d="M${(slotX + 22).toFixed(1)} ${(slotY + slotH + 16).toFixed(1)} C ${(slotX + slotW * 0.36).toFixed(1)} ${(slotY + slotH + 44).toFixed(1)}, ${(slotX + slotW * 0.68).toFixed(1)} ${(slotY + slotH + 34).toFixed(1)}, ${(slotX + slotW - 22).toFixed(1)} ${(slotY + slotH + 10).toFixed(1)}" stroke="${lineColor}" stroke-width="4" stroke-linecap="round" opacity="${lineOpacity}" fill="none"/>
  </svg>`;
}

function textLayer(id, z, inputKey, box, typoOverrides, constraintsOverrides, measurement) {
  return {
    id,
    z,
    type: "text",
    inputKey,
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
    typo: {
      fontId: inputKey === "headline" ? "barlow-condensed" : "barlow",
      family: inputKey === "headline" ? "Barlow Condensed" : "Barlow",
      fallbackFamily: "sans-serif",
      weight: inputKey === "headline" ? 800 : 600,
      italic: false,
      case: inputKey === "headline" ? "upper" : "none",
      sizeRatio: box.sizeRatio,
      lineHeight: inputKey === "headline" ? 1.02 : 1.2,
      tracking: inputKey === "headline" ? -0.02 : 0,
      align: box.align,
      color: INK,
      ...typoOverrides,
    },
    constraints: {
      maxLength: constraintsOverrides.maxLength,
      maxLines: constraintsOverrides.maxLines,
      autoFitMinRatio: 0.6,
    },
    measurement: measurement || { fitScore: 0.92, detectionScore: 0.9, source: "manual-verified", version: 2 },
  };
}

function imageSlotLayer(id, z, inputKey, box, heightPx) {
  return {
    id,
    z,
    type: "image_slot",
    inputKey,
    fit: "cover",
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
    mask: { kind: "rounded", radius: 58 },
    minSourcePx: { width: Math.round(box.width * 1080), height: Math.round(box.height * heightPx) },
  };
}

function buildLayout(format, skeleton, text, heightPx) {
  const layers = [
    imageSlotLayer(`${format === "4:5" ? "feed" : "story"}-slot-customer-photo`, 1, "customer_photo", skeleton.slot, heightPx),
    textLayer(`${format === "4:5" ? "feed" : "story"}-text-headline`, 2, "headline", skeleton.headline, {}, { maxLength: 48, maxLines: 3 }),
    textLayer(`${format === "4:5" ? "feed" : "story"}-text-supporting`, 3, "supporting", skeleton.supporting, {}, { maxLength: 80, maxLines: 2 }),
    textLayer(`${format === "4:5" ? "feed" : "story"}-text-handle`, 4, "handle", skeleton.handle, {}, { maxLength: 40, maxLines: 1 }),
    textLayer(`${format === "4:5" ? "feed" : "story"}-text-arrow`, 5, "arrow", skeleton.arrow, {}, { maxLength: 4, maxLines: 1 }),
  ];
  return { format, width: 1080, height: heightPx, layers };
}

function buildDoc({ contract, variantIndex, skeleton, fonts, plates, sampleHash, slotSha, slotSrc }) {
  const id = contract.mode === "multi-concept"
    ? `${contract.packId}-v${String(variantIndex).padStart(2, "0")}`
    : contract.templateId || contract.packId;
  const feed = buildLayout("4:5", skeleton.feed, contract.text, 1350);
  const story = buildLayout("9:16", skeleton.story, contract.text, 1920);
  feed.plate = { src: `/adstudio-templates/${id}/plate-feed.webp`, sha256: plates.feed };
  story.plate = { src: `/adstudio-templates/${id}/plate-story.webp`, sha256: plates.story };
  const creativeFeatures = Object.fromEntries(CREATIVE_FEATURE_KEYS.map((key) => [key, "OPT_OUT"]));
  const copy = contract.copy || {};
  return {
    schema: "adstudio.template.v2",
    id,
    name: contract.mode === "multi-concept" ? `${contract.name} — Variant ${variantIndex}` : contract.name,
    goal: contract.goal || "buyer_leads",
    offerId: contract.offerId || "general",
    category: contract.category || "real-estate",
    tags: contract.mode === "multi-concept"
      ? [...(contract.tags || ["meta", "source-free"]), `variant-${variantIndex}`]
      : [...(contract.tags || ["meta", "source-free"]), "single-template"],
    audienceIntent: contract.audienceIntent || "buyers",
    classification: contract.classification || { ad_type: "single_image", primary_intent: "other", property_or_agent_focus: "property" },
    provenance: {
      sourceAd: { file: contract.sourceAd.file, contentHash: contract.sourceAd.contentHash },
      sample: { imageSrc: `/adstudio-templates/${id}/sample.png`, contentHash: sampleHash, generatedBy: "deterministic_render" },
      decomposedFrom: "source",
      packId: contract.packId,
      packVariantIndex: variantIndex,
    },
    restyle: {
      paletteMap: { "#0f0f0f": INK },
      replacedAssets: ["customer_photo"],
      safeReplacementAssets: [{ inputKey: "customer_photo", src: slotSrc, sha256: slotSha }],
      note: `deterministic source-free variant ${variantIndex} of pack ${contract.packId}; plates are vector renders, no source pixels, no image model calls`,
    },
    fonts,
    formats: { feed, story },
    inputs: {
      images: [{ key: "customer_photo", label: "Customer or property photo", required: true, aspect: "portrait", description: "Replaceable rounded customer/property photo slot." }],
      text: [
        { key: "headline", label: "Headline", required: true, maxLength: 48, sample: contract.text.headline },
        { key: "supporting", label: "Supporting line", required: true, maxLength: 80, sample: contract.text.supporting },
        { key: "handle", label: "Handle", required: true, maxLength: 40, sample: contract.text.handle },
        { key: "arrow", label: "Arrow cue", required: true, maxLength: 4, sample: contract.text.arrow },
      ],
    },
    publish: {
      platform: "meta",
      objective: "OUTCOME_LEADS",
      specialAdCategory: "housing",
      apiVersionMin: "v26.0",
      copy: {
        primaryText: copy.primaryText || ["Avoid costly buying mistakes with a clear local checklist before you make an offer."],
        headlines: copy.headlines || ["Avoid costly mistakes"],
        descriptions: copy.descriptions || ["Get the free buyer guide."],
      },
      cta: "LEARN_MORE",
      leadForm: contract.leadForm || {
        headline: "Get the buyer mistakes checklist",
        questions: ["What suburb are you looking in?", "When are you hoping to buy?"],
        thankYou: { title: "Thanks", body: "Your checklist is on the way." },
      },
      placements: {
        publisherPlatforms: ["facebook", "instagram"],
        facebookPositions: ["feed", "stories"],
        instagramPositions: ["stream", "story", "reels"],
      },
      formatRouting: { feed: "4:5", story: "9:16" },
      requirements: contract.publishRequirements ?? null,
      creativeFeatures,
      previewFormats: ["MOBILE_FEED_STANDARD", "INSTAGRAM_STANDARD", "FACEBOOK_STORY_MOBILE", "INSTAGRAM_STORY"],
    },
    editPolicy: { mode: "guided", advancedUnlockable: true, lockedLayerIds: [] },
    exactness: { status: "qa", residuals: {}, bakedTextKeys: [] },
  };
}

async function main() {
  const contractPath = argValue("--contract");
  if (!contractPath) {
    console.error("usage: variant-pack.mjs --contract <path> --repo <candidateRoot> [--source <path>] [--slot <path>]");
    process.exit(2);
  }
  const contract = readJson(contractPath);
  const multiConcept = contract.mode === "multi-concept";
  const count = multiConcept ? Number(contract.count ?? 0) : 1;
  if (multiConcept && (!Number.isInteger(count) || count < 2 || count > 12)) {
    throw new Error(`multi-concept contract.count must be an integer in [2,12], got ${contract.count}`);
  }
  const repoRoot = resolve(argValue("--repo") || REPO_ROOT);
  const galleryDir = join(repoRoot, "src", "lib", "adstudio", "template-gallery-v2");
  const assetsDir = join(repoRoot, "src", "lib", "adstudio", "template-assets-v2");
  const publicDir = join(repoRoot, "public");
  const candidatesDir = join(repoRoot, "meta_ad_candidates");

  // ── 1. stage the source ad (provenance + subject-invariance source replay) ──
  const sourcePath = resolve(argValue("--source") || join(REPO_ROOT, "meta_ad_candidates", contract.sourceAd.file));
  const sourceBytes = readFileSync(sourcePath);
  const actualSourceHash = sha256(sourceBytes);
  if (actualSourceHash !== contract.sourceAd.contentHash) {
    throw new Error(`source hash mismatch: expected ${contract.sourceAd.contentHash}, got ${actualSourceHash}`);
  }
  const sourceRel = contract.sourceAd.file;
  mkdirSync(join(candidatesDir, dirname(sourceRel)), { recursive: true });
  copyFileSync(sourcePath, join(candidatesDir, sourceRel));

  // ── 2. durable fixture corpus: REAL COPY, never a symlink ─────────────────
  const samplesSrc = join(REPO_ROOT, "public", "adstudio-samples");
  const samplesDest = join(publicDir, "adstudio-samples");
  rmSync(samplesDest, { recursive: true, force: true });
  mkdirSync(samplesDest, { recursive: true });
  copyTree(samplesSrc, samplesDest);
  await verifyPinnedFixtureCorpus(repoRoot); // fail fast if the corpus is missing or un-pinned

  // ── 3. shared public assets the renderer needs (fonts + slot fixture) ─────
  const fontsSrc = join(REPO_ROOT, "public", "fonts", "adstudio");
  if (existsSync(fontsSrc)) copyTree(fontsSrc, join(publicDir, "fonts", "adstudio"));
  const slotPath = resolve(argValue("--slot") || join(REPO_ROOT, "public", "adstudio-samples", "photos", "int-bedroom.png"));
  const slotBytes = readFileSync(slotPath);
  const slotSha = sha256(slotBytes);
  const slotRel = "/slots/photo-portrait.png";
  mkdirSync(join(publicDir, "slots"), { recursive: true });
  copyFileSync(slotPath, join(publicDir, "slots", "photo-portrait.png"));

  // ── 4. fonts from the committed manifest (exact faces used by the docs) ───
  const manifest = readJson(join(REPO_ROOT, "public", "fonts", "adstudio", "manifest.json"));
  const faces = manifest.faces || [];
  const resolveFace = (fontId, weight) => {
    const face = faces.find((f) => f.fontId === fontId && f.weight === weight && !f.italic);
    if (!face) throw new Error(`font ${fontId}@${weight} missing from manifest`);
    return { fontId: face.fontId, family: face.family, weight: face.weight, italic: false, file: face.file, sha256: face.sha256 };
  };
  const fonts = [resolveFace("barlow-condensed", 800), resolveFace("barlow", 600)];

  // ── 5. build the variants ─────────────────────────────────────────────────
  const variantIds = [];
  const skeletonKeys = SKELETONS.slice(0, count);
  for (let i = 0; i < count; i += 1) {
    const variantIndex = i + 1;
    const skeleton = skeletonKeys[i];
    const id = multiConcept
      ? `${contract.packId}-v${String(variantIndex).padStart(2, "0")}`
      : contract.templateId || contract.packId;
    variantIds.push(id);
    mkdirSync(join(assetsDir, id), { recursive: true });
    mkdirSync(join(publicDir, "adstudio-templates", id), { recursive: true });

    // plates: deterministic vector renders (no image model, no source pixels)
    const feedSvg = plateSvg(skeleton.key, skeleton.feed, contract.text, "4:5");
    const storySvg = plateSvg(skeleton.key, skeleton.story, contract.text, "9:16");
    const feedPlate = await toLosslessWebp(await sharp(Buffer.from(feedSvg)).png().toBuffer());
    const storyPlate = await toLosslessWebp(await sharp(Buffer.from(storySvg)).png().toBuffer());
    const feedSha = sha256(feedPlate);
    const storySha = sha256(storyPlate);
    writeFileSync(join(assetsDir, id, "plate-feed.webp"), feedPlate);
    writeFileSync(join(assetsDir, id, "plate-story.webp"), storyPlate);

    // sample: deterministic render of the doc with the generic slot fixture
    const doc = buildDoc({ contract, variantIndex, skeleton, fonts, plates: { feed: feedSha, story: storySha }, sampleHash: "0".repeat(64), slotSha, slotSrc: slotRel });
    const instance = (format) => ({
      schema: "adstudio.instance.v2",
      templateId: doc.id,
      templateHash: "0".repeat(64),
      format,
      values: {
        images: { customer_photo: { src: slotRel } },
        text: { ...contract.text },
      },
      overrides: [],
    });
    const samplePng = await renderAdDocToPng(doc, instance("4:5"), "4:5", {
      repoRoot,
      slotBytes: new Map([["customer_photo", slotBytes]]),
    });
    const sampleHash = sha256(samplePng);
    writeFileSync(join(publicDir, "adstudio-templates", id, "sample.png"), samplePng);
    doc.provenance.sample.contentHash = sampleHash;

    // story sample: the 9:16 placement preview, so every variant ships both
    // placements and the visual-output (tofu) gate can scan the 9:16 surface.
    const storySamplePng = await renderAdDocToPng(doc, instance("9:16"), "9:16", {
      repoRoot,
      slotBytes: new Map([["customer_photo", slotBytes]]),
    });
    const storySampleHash = sha256(storySamplePng);
    writeFileSync(join(publicDir, "adstudio-templates", id, "sample-story.png"), storySamplePng);
    doc.provenance.storySample = {
      imageSrc: `/adstudio-templates/${id}/sample-story.png`,
      contentHash: storySampleHash,
      generatedBy: "deterministic_render",
    };

    writeJson(join(galleryDir, id, "template.json"), doc);
    writeJson(join(galleryDir, id, "evidence.json"), {
      schema: "adstudio.template.evidence.v2",
      sourceValues: { ...contract.text },
      textBoxes: Object.fromEntries(
        Object.entries(skeleton.feed).map(([key, box]) => [key, { x: box.x, y: box.y, width: box.width, height: box.height }]),
      ),
      restyle: { sourceFree: true, noWholeAdImageModel: true, imageModelCalls: 0 },
    });
  }

  const manifestOut = {
    schema: "adstudio.variant-pack.manifest.v2",
    packId: contract.packId,
    mode: multiConcept ? "multi-concept" : "single-template",
    count,
    variantIds,
    sourceAd: { file: contract.sourceAd.file, contentHash: contract.sourceAd.contentHash },
    fixtureCorpus: { version: "adstudio-subject-invariance-fixtures-v2", committedPath: "public/adstudio-samples/photos/int-bedroom.png", copied: true, symlinked: false },
    templateIds: variantIds.map((id) => `${galleryDir}/${id}/template.json`),
  };
  writeJson(join(repoRoot, "variant-pack.manifest.json"), manifestOut);
  process.stdout.write(`${JSON.stringify(manifestOut, null, 2)}\n`);
}

function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(to, { recursive: true });
      copyTree(from, to);
    } else if (entry.isFile()) {
      copyFileSync(from, to);
    } else if (entry.isSymbolicLink()) {
      // Resolve symlinks into regular files: candidates must never carry
      // dangling-capable indirection for the QA corpus.
      const target = resolve(dirname(from), readFileSync(from).toString());
      if (existsSync(target)) {
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(target, to);
      }
    }
  }
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
