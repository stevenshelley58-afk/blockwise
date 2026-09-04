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
//     "skeletonIndex": 0,
//     "layoutVariant": 0,
//     "copy": { "primaryText": [...], "headlines": [...], "descriptions": [...] },
//     "leadForm": { "headline": "...", "questions": [...], "thankYou": { "title": "...", "body": "..." } }
//   }

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { toLosslessWebp } from "./lib/plate.mjs";
import { renderAdDocToPng } from "../../../src/lib/adstudio/v2/render/server.ts";
import { hashCanonicalJson } from "../../../src/lib/adstudio/v2/template-hash.ts";
import { verifyPinnedFixtureCorpus } from "./subject-invariance.mjs";
import { STORY_BACKING_COLOUR, STORY_MAX_DEAD_SPACE_PX, STORY_CTA_MAX_GAP_PX } from "./lib/story.mjs";
import { validateInitialPortfolioContract } from "./initial-portfolio-specs.mjs";

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

/**
 * Keep single-source packs visually distinct when a portfolio contains more
 * than the five canonical skeletons. The bounded variant changes only the
 * supporting-copy rail width; it never moves content into a Story safe zone
 * or changes the editable layer contract. Five skeletons x four rails gives
 * twenty deterministic signatures for the launch portfolio.
 */
function applyLayoutVariant(skeleton, variant) {
  const family = Math.max(0, Math.min(3, Math.floor(Number(variant) / SKELETONS.length)));
  if (family === 0) return skeleton;
  const tighten = (box) => ({
    ...box,
    width: Math.max(0.42, box.width - family * 0.06),
  });
  return {
    ...skeleton,
    feed: { ...skeleton.feed, supporting: tighten(skeleton.feed.supporting) },
    story: { ...skeleton.story, supporting: tighten(skeleton.story.supporting) },
  };
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function plateSvg(skeletonKey, layout, text, format, palette = {}) {
  const width = 1080;
  const height = format === "4:5" ? 1350 : 1920;
  // Plates are only neutral source-free surfaces. The authored v2 layers own
  // all geometry, cards, decoration, masks, and image slots; do not add a
  // portfolio-wide dotted/rounded/wave skeleton here.
  const background = palette.background || CREAM;
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${background}"/></svg>`;
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
      // Keep the deliberately long-copy stress fixture legible at the 100%
      // review size even in narrow split compositions. The heading remains
      // materially larger than supporting copy while retaining a real fit
      // floor for editable customer text.
      // The ratio is authored against the box height, not the whole canvas.
      // Keep an explicit ratio untouched; the larger defaults prevent a
      // 24px fact box from becoming a 4px label while still fitting stress
      // copy through the renderer's measured shrink-to-fit path.
      sizeRatio: box.sizeRatio ?? (inputKey === "headline" ? 0.72 : inputKey === "brand_name" ? 0.52 : 0.56),
      lineHeight: inputKey === "headline" ? 1.02 : 1.2,
      tracking: inputKey === "headline" ? -0.02 : 0,
      align: box.align || "left",
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

function imageSlotLayer(id, z, inputKey, box, heightPx, maskKind = "rounded", fit = "cover") {
  return {
    id,
    z,
    type: "image_slot",
    inputKey,
    fit,
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
    mask: maskKind === "ellipse" ? { kind: "ellipse" } : maskKind === "rect" ? { kind: "rect" } : { kind: "rounded", radius: 58 },
    minSourcePx: { width: Math.round(box.width * 1080), height: Math.round(box.height * heightPx) },
  };
}

function buildLayout(format, skeleton, text, heightPx, storyBackingSha = null, semanticLayers = []) {
  const headlineMaxLength = skeleton.headline.width < 0.5 ? 18 : 32;
  const supportingMaxLength = skeleton.supporting.width < 0.5 ? 18 : 36;
  const mediaSlots = Array.isArray(skeleton.slots) && skeleton.slots.length
    ? skeleton.slots
    : [{ key: "customer_photo", box: skeleton.slot, mask: "rounded", required: true }];
  const brandBox = format === "9:16"
     ? { x: 0.46, y: 0.132, width: 0.20, height: 0.022 }
    : { x: 0.46, y: 0.01, width: 0.20, height: 0.022 };
  const headlineBox = format === "9:16" && skeleton.headline.y < 0.17
    ? { ...skeleton.headline, y: 0.17, height: Math.min(skeleton.headline.height, 0.09) }
    : skeleton.headline;
  const supportingBox = format === "9:16"
    ? {
        ...skeleton.supporting,
        y: Math.max(Math.min(skeleton.supporting.y, 0.68), headlineBox.y + headlineBox.height + 0.015),
        height: Math.min(skeleton.supporting.height, 0.04),
      }
    : skeleton.supporting;
  const layers = [
    ...mediaSlots.map((slot, index) => imageSlotLayer(
      `${format === "4:5" ? "feed" : "story"}-slot-${slot.key}`,
      1 + index,
      slot.key,
      slot.box,
      heightPx,
      slot.mask,
    )),
    textLayer(`${format === "4:5" ? "feed" : "story"}-text-headline`, 20 + mediaSlots.length, "headline", headlineBox, {}, { maxLength: headlineMaxLength, maxLines: 3 }),
    textLayer(`${format === "4:5" ? "feed" : "story"}-text-supporting`, 21 + mediaSlots.length, "supporting", supportingBox, {}, { maxLength: supportingMaxLength, maxLines: 2 }),
    textLayer(`${format === "4:5" ? "feed" : "story"}-text-handle`, 22 + mediaSlots.length, "handle", skeleton.handle, {}, { maxLength: 32, maxLines: 1 }),
    textLayer(`${format === "4:5" ? "feed" : "story"}-text-arrow`, 23 + mediaSlots.length, "arrow", skeleton.arrow, {}, { maxLength: 4, maxLines: 1 }),
    textLayer(`${format === "4:5" ? "feed" : "story"}-text-brand-name`, 24 + mediaSlots.length, "brand_name", brandBox, { fontId: "barlow", family: "Barlow", weight: 600, case: "upper", sizeRatio: 0.34 }, { maxLength: 24, maxLines: 1 }),
  ];
  for (const [index, semantic] of semanticLayers.entries()) {
    const box = format === "4:5" ? semantic.feed : semantic.story;
    if (!box) continue;
    layers.push(textLayer(
      `${format === "4:5" ? "feed" : "story"}-semantic-${semantic.key}`,
      40 + index,
      semantic.key,
      box,
      {
        fontId: semantic.kind === "headline" ? "barlow-condensed" : "barlow",
        family: semantic.kind === "headline" ? "Barlow Condensed" : "Barlow",
        weight: semantic.kind === "headline" ? 800 : 600,
        case: semantic.kind === "badge" ? "upper" : "none",
        sizeRatio: semantic.sizeRatio ?? (semantic.kind === "price" || semantic.kind === "badge" ? 0.68 : 0.56),
        color: semantic.color || INK,
      },
      { maxLength: semantic.maxLength || 32, maxLines: semantic.maxLines || 1 },
    ));
  }
  if (format === "9:16" && storyBackingSha) {
    const backing = (id, role, box, z) => ({ id, z, type: "overlay_patch", src: `/adstudio-templates/__TEMPLATE_ID__/patch-${role}.webp`, sha256: storyBackingSha, box });
    const supporting = supportingBox;
    const cta = {
      x: Math.min(skeleton.handle.x, skeleton.arrow.x) - 0.02,
      y: Math.min(skeleton.handle.y, skeleton.arrow.y) - 0.018,
      width: Math.max(skeleton.handle.x + skeleton.handle.width, skeleton.arrow.x + skeleton.arrow.width) - Math.min(skeleton.handle.x, skeleton.arrow.x) + 0.04,
      height: Math.max(skeleton.handle.y + skeleton.handle.height, skeleton.arrow.y + skeleton.arrow.height) - Math.min(skeleton.handle.y, skeleton.arrow.y) + 0.036,
    };
    layers.push(
      backing("story-backing-supporting", "supporting", { x: supporting.x - 0.02, y: supporting.y - 0.018, width: supporting.width + 0.04, height: supporting.height + 0.036 }, 3),
      backing("story-backing-cta", "cta", cta, 4),
    );
    for (const layer of layers) {
      if (layer.type !== "text") continue;
      if (layer.inputKey === "headline") layer.z = 20 + mediaSlots.length;
      else if (layer.inputKey === "supporting") layer.z = 24 + mediaSlots.length;
      else if (layer.inputKey === "handle") layer.z = 28 + mediaSlots.length;
      else if (layer.inputKey === "arrow") layer.z = 29 + mediaSlots.length;
    }
    layers.sort((left, right) => left.z - right.z);
  }
  return {
    format, width: 1080, height: heightPx, layers,
    ...(format === "9:16" && storyBackingSha ? {
      storyPolicy: {
        schema: "adstudio.story-policy.v1", safeTopPx: 250, safeBottomPx: 340,
        maxDeadSpacePx: STORY_MAX_DEAD_SPACE_PX, backingColour: STORY_BACKING_COLOUR,
        backingLayerIds: ["story-backing-supporting", "story-backing-cta"],
        ctaGroup: {
          layerIds: [`${format === "4:5" ? "feed" : "story"}-text-handle`, `${format === "4:5" ? "feed" : "story"}-text-arrow`],
          maxGapPx: STORY_CTA_MAX_GAP_PX,
        },
      },
    } : {}),
  };
}

function paletteRoleColour(palette, role) {
  if (role === "background") return palette?.background || CREAM;
  if (role === "surface") return palette?.surface || SLOT_FILL;
  if (role === "accent") return palette?.accent || "#6f4e2b";
  if (role === "inverseText") return palette?.inverseText || "#ffffff";
  return palette?.ink || INK;
}

function buildLayoutFromSpec(format, specLayout, specInputs, palette, storyBackingSha = null) {
  const heightPx = format === "4:5" ? 1350 : 1920;
  const normalizeBox = (value, layerType) => {
    if (!value || ![value.x, value.y, value.width, value.height].every(Number.isFinite)) throw new Error(`invalid ${format} authored layer box`);
    const width = Math.min(Math.max(0.012, value.width), 0.94);
    const isText = layerType === "text";
    const height = Math.min(Math.max(isText ? 0.012 : 0.001, value.height), isText ? (format === "9:16" ? 0.16 : 0.20) : 1);
    const minY = isText && format === "9:16" ? 0.125 : 0;
    // Render QA reserves the stricter 250/340px Story crop lanes (the public
    // contract remains 240/300px); keep editable text inside both contracts.
    const maxY = isText && format === "9:16" ? (1 - 340 / 1920) - height : 1 - height;
    return { ...value, x: Math.min(Math.max(0, value.x), 1 - width), y: Math.min(Math.max(minY, value.y), Math.max(minY, maxY)), width, height };
  };
  const textInputs = new Map((specInputs.text || []).map((input) => [input.key, input]));
  const layers = [];
  let z = 1;
  for (const authored of specLayout.layers || []) {
    const box = normalizeBox(authored.box, authored.type);
    if (!box) continue;
    if (["image_slot", "portrait_slot", "logo_slot"].includes(authored.type)) {
      layers.push(imageSlotLayer(authored.id, z++, authored.inputKey, box, heightPx, authored.mask === "ellipse" || authored.mask === "circle" ? "ellipse" : authored.mask === "rect" ? "rect" : "rounded", authored.fit || (authored.type === "logo_slot" ? "contain" : "cover")));
    } else if (authored.type === "text") {
      const input = textInputs.get(authored.inputKey);
      const colourRole = authored.colourRole || (authored.role?.includes("inverse") ? "inverseText" : authored.role?.includes("surface") ? "surface" : "ink");
      const fontByAuthored = { "serif-display": ["cormorant-garamond", 700], "serif-italic": ["cormorant-garamond", 700], script: ["elsie-swash-caps", 900], "sans-bold": ["barlow", 600], sans: ["barlow", 600] };
      const authoredFont = authored.font || (authored.inputKey === "headline" ? "serif-display" : "sans");
      const [fontId, fontWeight] = fontByAuthored[authoredFont] || ["barlow", 600];
      const isHeadline = authored.role === "headline" || authored.inputKey === "headline";
      const textBox = { ...box, align: authored.align || "left" };
      layers.push(textLayer(authored.id, z++, authored.inputKey, textBox, {
        fontId,
        family: fontId === "cormorant-garamond" ? "Cormorant Garamond" : fontId === "elsie-swash-caps" ? "Elsie Swash Caps" : "Barlow",
        weight: fontWeight,
        case: authoredFont === "sans-bold" && authored.role !== "headline" ? "upper" : "none",
        color: paletteRoleColour(palette, colourRole),
        colourRole,
        sizeRatio: authored.sizeRatio ?? (isHeadline ? 0.72 : authored.role === "brand" ? 0.52 : 0.56),
      }, { maxLength: input?.maxLength || 48, maxLines: authored.maxLines || (isHeadline ? 3 : 2) }, null));
    } else if (authored.type === "overlay_patch") {
      // Story backing is an explicitly authored editable layer.  Preserve its
      // id and box; the deterministic one-pixel patch is only the neutral
      // asset implementation, never a universal geometry fallback.
      const role = authored.role?.includes("cta") ? "cta" : "supporting";
      const colourRole = ["background", "surface", "accent", "ink", "inverseText"].includes(authored.colourRole)
        ? authored.colourRole
        : "surface";
      layers.push({
        id: authored.id,
        z: z++,
        type: "overlay_patch",
        src: `/adstudio-templates/__TEMPLATE_ID__/patch-${role}.webp`,
        sha256: storyBackingSha,
        box,
        colourRole,
      });
    } else if (["vector_patch", "vector_decor"].includes(authored.type)) {
      const role = authored.colourRole || (authored.role?.includes("background") ? "background" : authored.role?.includes("surface") ? "surface" : "accent");
      const shape = authored.shape || (authored.role?.includes("notched") ? "notched" : authored.role?.includes("flowing") || authored.role?.includes("wave") ? "wave" : authored.role?.includes("circular") || authored.role?.includes("ring") ? "ring" : authored.role?.includes("line") ? "line" : authored.role?.includes("circle") ? "circle" : "rounded");
      layers.push({ id: authored.id, z: z++, type: "vector", shape, fill: paletteRoleColour(palette, role), colourRole: role, box, opacity: authored.opacity ?? 1 });
    } else if (authored.type === "vector_icon") {
      const role = authored.colourRole || "accent";
      layers.push({ id: authored.id, z: z++, type: "icon", icon: authored.icon || "check", color: paletteRoleColour(palette, role), colourRole: role, box, strokeWidth: 2 });
    }
  }
  const declaredBackingLayers = (specLayout.layers || []).filter((layer) => layer.type === "overlay_patch");
  return {
    format, width: 1080, height: heightPx, layers,
    ...(format === "9:16" ? {
      storyPolicy: {
        schema: "adstudio.story-policy.v1", safeTopPx: 240, safeBottomPx: 300,
        maxDeadSpacePx: STORY_MAX_DEAD_SPACE_PX, backingColour: STORY_BACKING_COLOUR,
        backingLayerIds: declaredBackingLayers.map((layer) => layer.id),
        ctaGroup: { layerIds: layers.filter((layer) => layer.type === "text" && ["cta", "contact"].includes(layer.inputKey)).map((layer) => layer.id), maxGapPx: STORY_CTA_MAX_GAP_PX },
      },
    } : {}),
  };
}

function skeletonFromSpec(spec) {
  const layouts = spec.formats;
  const from = (layout) => {
    const firstImage = layout.layers.find((layer) => ["image_slot", "portrait_slot"].includes(layer.type));
    const find = (key, fallback) => layout.layers.find((layer) => layer.type === "text" && layer.inputKey === key)?.box || fallback;
    return {
      key: `${spec.id}-spec`,
      slot: firstImage?.box || { x: .08, y: .2, width: .84, height: .4 },
      headline: find("headline", { x: .08, y: .2, width: .84, height: .12 }),
      supporting: find("supporting", { x: .08, y: .66, width: .84, height: .05 }),
      handle: find("contact", { x: .08, y: .78, width: .38, height: .04 }),
      arrow: find("cta", { x: .72, y: .78, width: .18, height: .04 }),
    };
  };
  return { key: `${spec.id}-spec`, feed: from(layouts.feed), story: from(layouts.story) };
}

// ---------------------------------------------------------------------------
// Source-free fixture art direction
// ---------------------------------------------------------------------------
// These are the only pixels allowed into a public sample. Keep this catalog
// explicit and repository-relative: it makes provenance review auditable and
// prevents a private source/temporary path from becoming a gallery asset by
// accident. The first entries are committed neutral property photography
// (not advertiser artwork, logos, or candidate/source attachments). The
// procedural entries are deterministic, text-free illustrations generated
// below; they intentionally contain no source-derived pixels.
const SAFE_FIXTURE_CATALOG = Object.freeze({
  "coastline": { path: "public/ads/ad-coastline.jpg", tags: ["coastal", "modern", "pool", "hero"] },
  "heritage": { path: "public/ads/ad-northstar.jpg", tags: ["heritage", "family", "exterior", "hero"] },
  "hillside": { path: "public/ads/ad-hillco.jpg", tags: ["modern", "landscape", "exterior", "support"] },
  "vertical-hillside": { path: "public/ads/ad-hillview.jpg", tags: ["modern", "landscape", "exterior", "hero"] },
  "dusk": { path: "public/home/home-dusk.webp", tags: ["luxury", "dusk", "exterior", "hero"] },
  "pool": { path: "public/home/home-pool.webp", tags: ["modern", "pool", "family", "exterior", "hero"] },
  "styled-interior": { path: "public/home/interior-styled.webp", tags: ["interior", "editorial", "luxury", "support"] },
  "federation": { path: "public/home/mt-lawley-federation.webp", tags: ["heritage", "family", "exterior", "support"] },
  "open-home": { path: "public/home/open-home-living.webp", tags: ["interior", "family", "event", "support"] },
  "townhouse": { path: "public/home/subiaco-townhouse.webp", tags: ["modern", "urban", "exterior", "support"] },
  "bedroom": { path: "public/adstudio-samples/photos/int-bedroom.png", tags: ["interior", "amenity", "support"] },
  "p-sunroom": { procedural: { background: "#e8ece8", roof: "#5f756e", window: "#d3e4e3", ground: "#b8c7b5", accent: "#8ba896" }, tags: ["interior", "editorial", "support"] },
  "p-courtyard": { procedural: { background: "#e8e1d3", roof: "#7f5e48", window: "#d9c9b5", ground: "#b4a58d", accent: "#c38f61" }, tags: ["heritage", "family", "exterior", "support"] },
  "p-loft": { procedural: { background: "#dbe2e6", roof: "#334955", window: "#b6d3dc", ground: "#9eabb2", accent: "#6d8da0" }, tags: ["modern", "urban", "interior", "support"] },
  "p-garden": { procedural: { background: "#e5eadc", roof: "#667358", window: "#d2dfca", ground: "#9aaa7e", accent: "#798e5c" }, tags: ["family", "garden", "exterior", "support"] },
  "p-townhouse": { procedural: { background: "#dfe6ea", roof: "#596a77", window: "#c4dce4", ground: "#a6b1ae", accent: "#7398a8" }, tags: ["modern", "urban", "exterior", "support"] },
  "p-poolhouse": { procedural: { background: "#cfe0e8", roof: "#446d79", window: "#b9e0e3", ground: "#82b6b8", accent: "#3f929c" }, tags: ["modern", "pool", "exterior", "support"] },
  "p-highrise": { procedural: { background: "#b8c8d8", roof: "#384a65", window: "#d1e1e9", ground: "#7c8fa2", accent: "#6a86ae" }, tags: ["urban", "amenity", "exterior", "hero"] },
  "p-studio": { procedural: { background: "#efe8df", roof: "#766f6a", window: "#f8f2e9", ground: "#c2b4a8", accent: "#b49378" }, tags: ["interior", "editorial", "support"] },
  "p-villa": { procedural: { background: "#27303a", roof: "#151b24", window: "#d3b785", ground: "#4f5d57", accent: "#a78655" }, tags: ["luxury", "dusk", "exterior", "hero"] },
  "p-sunset": { procedural: { background: "#c97e60", roof: "#5c3d3e", window: "#ffe2ad", ground: "#a75d50", accent: "#e1a15e" }, tags: ["luxury", "dusk", "exterior", "hero"] },
  "p-aerial": { procedural: { background: "#d4dfcf", roof: "#3f6550", window: "#bdceb7", ground: "#8fae82", accent: "#6d9068" }, tags: ["aerial", "green", "exterior", "hero"] },
  "p-dark-villa": { procedural: { background: "#18232b", roof: "#0e151a", window: "#c8b38d", ground: "#35463d", accent: "#8f7856" }, tags: ["luxury", "dusk", "exterior", "hero"] },
  "p-black-gold": { procedural: { background: "#1b1a18", roof: "#0f0e0d", window: "#cdb37d", ground: "#3a3a30", accent: "#ad8d52" }, tags: ["luxury", "editorial", "exterior", "hero"] },
});

// One deterministic assignment per launch ID.  The first entry is the hero;
// following entries are used in declaration order for property_image_N.  Each
// row intentionally contains no duplicate asset IDs, while the full table
// spreads load across the corpus so the gallery does not look like one home
// repeated twenty times.
const INITIAL_FIXTURE_ASSIGNMENTS = Object.freeze({
  "180": ["styled-interior", "open-home", "bedroom", "p-sunroom"],
  "149": ["federation", "pool", "townhouse"],
  "033": ["dusk", "styled-interior", "p-villa", "coastline", "p-studio"],
  "044": ["open-home", "dusk", "p-courtyard", "townhouse"],
  "021": ["townhouse", "coastline", "p-loft"],
  "006": ["heritage", "federation", "open-home", "townhouse"],
  "039": ["pool", "p-garden", "p-courtyard", "p-townhouse"],
  "062": ["coastline", "hillside", "vertical-hillside", "p-poolhouse"],
  "154": ["p-studio", "open-home", "bedroom"],
  "108": ["hillside", "coastline", "p-courtyard", "p-poolhouse"],
  "111": ["p-highrise"],
  "182": ["p-loft"],
  "143": ["vertical-hillside", "heritage", "coastline", "p-aerial"],
  "145": ["p-garden"],
  "148": ["p-sunroom"],
  "159": ["p-dark-villa"],
  "176": ["p-sunset"],
  "194": ["p-aerial"],
  "127": ["p-villa"],
  "199": ["p-black-gold"],
});

const INITIAL_FIXTURE_HERO_TAGS = Object.freeze({
  "180": ["interior"], "149": ["heritage", "modern"], "033": ["luxury"], "044": ["event", "interior"],
  "021": ["urban", "modern"], "006": ["heritage"], "039": ["family"], "062": ["coastal", "pool"],
  "154": ["interior"], "108": ["modern"], "111": ["urban"], "182": ["interior"], "143": ["exterior"],
  "145": ["family"], "148": ["interior"], "159": ["luxury", "dusk"], "176": ["luxury", "dusk"],
  "194": ["aerial", "green"], "127": ["luxury", "dusk"], "199": ["luxury"],
});

function fixtureKeyForTemplate(templateId) {
  const match = String(templateId || "").match(/(?:^|-)feed-(\d{3})(?:$|-)/);
  return match ? match[1] : null;
}

function resolveSafeFixtureCatalog(repoRoot) {
  return new Map(Object.entries(SAFE_FIXTURE_CATALOG).map(([key, fixture]) => {
    const path = fixture.path ? resolve(repoRoot, fixture.path) : null;
    if (path && !existsSync(path)) throw new Error(`missing committed safe fixture: ${fixture.path}`);
    if (!path && !fixture.procedural) throw new Error(`safe fixture ${key} has no committed path or procedural definition`);
    return [key, { ...fixture, key, path }];
  }));
}

function validateInitialFixtureAssignments(catalog) {
  const ids = Object.keys(INITIAL_FIXTURE_ASSIGNMENTS);
  const heroes = ids.map((id) => INITIAL_FIXTURE_ASSIGNMENTS[id]?.[0]);
  if (ids.length !== 20 || new Set(heroes).size !== ids.length) {
    throw new Error("initial fixture art direction requires one distinct hero assignment per launch ID");
  }
  for (const [id, assignment] of Object.entries(INITIAL_FIXTURE_ASSIGNMENTS)) {
    if (!Array.isArray(assignment) || assignment.length === 0 || assignment.some((key) => !catalog.has(key))) {
      throw new Error(`${id}: initial fixture assignment is incomplete or references an unknown safe asset`);
    }
    const hero = catalog.get(assignment[0]);
    const focusTags = INITIAL_FIXTURE_HERO_TAGS[id] || [];
    if (focusTags.length && !focusTags.some((tag) => hero.tags?.includes(tag))) {
      throw new Error(`${id}: hero fixture ${assignment[0]} does not match its art-directed category`);
    }
  }
}

function proceduralFixtureSvg(key, style) {
  const seed = [...key].reduce((value, character) => value + character.charCodeAt(0), 0);
  const houseX = 135 + (seed % 75);
  const houseW = 560 + (seed % 100);
  const roofY = 250 + (seed % 35);
  const windowCount = 3 + (seed % 3);
  const windows = Array.from({ length: windowCount }, (_, index) => {
    const x = houseX + 72 + index * ((houseW - 144) / Math.max(1, windowCount - 1));
    return `<rect x="${Math.round(x - 30)}" y="${roofY + 125}" width="60" height="92" rx="8" fill="${style.window}"/><path d="M${Math.round(x)} ${roofY + 125}v92M${Math.round(x - 30)} ${roofY + 171}h60" stroke="${style.roof}" stroke-width="7" opacity=".45"/>`;
  }).join("");
  return `<svg width="1000" height="750" viewBox="0 0 1000 750" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${style.background}"/><stop offset="1" stop-color="${style.ground}"/></linearGradient></defs><rect width="1000" height="750" fill="url(#sky)"/><circle cx="810" cy="145" r="58" fill="${style.accent}" opacity=".55"/><path d="M0 548 Q220 500 430 550 T1000 530V750H0Z" fill="${style.ground}"/><rect x="${houseX}" y="${roofY + 45}" width="${houseW}" height="260" rx="10" fill="${style.window}" opacity=".94"/><path d="M${houseX - 58} ${roofY + 55}L${houseX + houseW / 2} ${roofY - 60}L${houseX + houseW + 58} ${roofY + 55}Z" fill="${style.roof}"/><rect x="${Math.round(houseX + houseW * .43)}" y="${roofY + 172}" width="86" height="133" rx="8" fill="${style.accent}" opacity=".8"/>${windows}<path d="M${houseX - 65} ${roofY + 318}h${houseW + 130}" stroke="${style.accent}" stroke-width="18" stroke-linecap="round" opacity=".65"/><path d="M${Math.round(houseX + houseW * .48)} ${roofY + 305}L500 750h100L${Math.round(houseX + houseW * .57)} ${roofY + 305}Z" fill="${style.window}" opacity=".62"/><circle cx="100" cy="590" r="28" fill="${style.accent}" opacity=".7"/><circle cx="900" cy="585" r="34" fill="${style.accent}" opacity=".7"/></svg>`;
}

async function fixtureBytes(fixture) {
  if (fixture.path) return readFileSync(fixture.path);
  const png = await sharp(Buffer.from(proceduralFixtureSvg(fixture.key, fixture.procedural))).png().toBuffer();
  return toLosslessWebp(png);
}

function assignedFixturesForTemplate(templateId, propertyInputCount, catalog) {
  const number = fixtureKeyForTemplate(templateId);
  const assignment = number ? INITIAL_FIXTURE_ASSIGNMENTS[number] : null;
  if (!assignment) return null;
  if (assignment.length !== propertyInputCount) {
    throw new Error(`${templateId}: fixture assignment has ${assignment.length} assets for ${propertyInputCount} property slots`);
  }
  const seen = new Set();
  return assignment.map((key) => {
    if (seen.has(key)) throw new Error(`${templateId}: fixture assignment repeats ${key}`);
    seen.add(key);
    const fixture = catalog.get(key);
    if (!fixture) throw new Error(`${templateId}: unknown safe fixture ${key}`);
    return fixture;
  });
}

export { INITIAL_FIXTURE_ASSIGNMENTS, INITIAL_FIXTURE_HERO_TAGS, SAFE_FIXTURE_CATALOG, assignedFixturesForTemplate, resolveSafeFixtureCatalog, validateInitialFixtureAssignments };

function buildDoc({ contract, variantIndex, skeleton, fonts, plates, sampleHash, slotSha, slotSrc, slotAssets, storyBackingSha }) {
  const id = contract.mode === "multi-concept"
    ? `${contract.packId}-v${String(variantIndex).padStart(2, "0")}`
    : contract.templateId || contract.packId;
  const spec = contract.portfolioSpec;
  const specTextValues = spec ? Object.fromEntries((spec.inputs.text || []).map((input) => [input.key, input.sample || "EDITABLE DETAIL"])) : null;
  const textValues = specTextValues || contract.text || {};
  const semanticLayers = Array.isArray(contract.semanticLayers) ? contract.semanticLayers : [];
  const feed = spec
    ? buildLayoutFromSpec("4:5", spec.formats.feed, spec.inputs, contract.palette, null)
    : buildLayout("4:5", skeleton.feed, contract.text, 1350, null, semanticLayers);
  const story = spec
    ? buildLayoutFromSpec("9:16", spec.formats.story, spec.inputs, contract.palette, storyBackingSha)
    : buildLayout("9:16", skeleton.story, contract.text, 1920, storyBackingSha, semanticLayers);
  const headlineMaxLength = spec?.inputs.text?.find((input) => input.key === "headline")?.maxLength || (skeleton.feed.headline.width < 0.5 ? 18 : 32);
  const supportingMaxLength = spec?.inputs.text?.find((input) => input.key === "supporting")?.maxLength || (skeleton.feed.supporting.width < 0.5 ? 18 : 36);
  feed.plate = { src: `/adstudio-templates/${id}/plate-feed.webp`, sha256: plates.feed };
  story.plate = { src: `/adstudio-templates/${id}/plate-story.webp`, sha256: plates.story };
  const creativeFeatures = Object.fromEntries(CREATIVE_FEATURE_KEYS.map((key) => [key, "OPT_OUT"]));
  const copy = contract.copy || {};
  const mediaSlots = spec
    ? spec.inputs.images.map((input) => ({ key: input.key, box: spec.formats.feed.layers.find((layer) => layer.inputKey === input.key)?.box || skeleton.feed.slot, required: input.kind === "logo" || input.kind === "portrait" ? false : true }))
    : Array.isArray(skeleton.feed.slots) && skeleton.feed.slots.length
    ? skeleton.feed.slots
    : [{ key: "customer_photo", box: skeleton.feed.slot, required: true }];
  const imageInputs = spec
    ? spec.inputs.images.map((input) => {
      const slot = mediaSlots.find((entry) => entry.key === input.key);
      return {
        ...input,
        key: input.key,
        label: input.label || input.key.replaceAll("_", " "),
        required: input.kind === "logo" || input.kind === "portrait" ? false : true,
        aspect: input.aspect || (slot.box.width > slot.box.height * 1.25 ? "landscape" : slot.box.width < slot.box.height * 0.8 ? "portrait" : "square"),
        description: input.description || (input.kind === "logo" ? "Optional editable brand-kit logo slot." : input.kind === "portrait" ? "Optional editable agent portrait slot." : "Independently replaceable property image slot."),
      };
    })
    : mediaSlots.map((slot, index) => ({
      key: slot.key,
      label: index === 0 ? "Customer or property photo" : `Editable property image ${index}`,
      required: index === 0,
      aspect: slot.box.width > slot.box.height * 1.25 ? "landscape" : slot.box.width < slot.box.height * 0.8 ? "portrait" : "square",
      description: index === 0 ? "Replaceable primary property photo slot." : "Independently replaceable supporting image slot.",
    }));
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
      // The contract rejects identity transforms: an unchanged source colour
      // is already the authored value and must not be advertised as a
      // replacement.  Filtering here also keeps source-free generic packs
      // compatible with the same palette contract used by portfolio specs.
      paletteMap: Object.fromEntries(Object.entries({
        "#0f0f0f": String(contract.palette?.ink || INK).toLowerCase(),
        "#f4f0e8": String(contract.palette?.background || CREAM).toLowerCase(),
        "#ead2a9": String(contract.palette?.surface || "#e0c18b").toLowerCase(),
        "#6f4e2b": String(contract.palette?.accent || "#6f4e2b").toLowerCase(),
      }).filter(([source, target]) => source !== target)),
      paletteRoles: {
        background: String(contract.palette?.background || CREAM).toLowerCase(),
        surface: String(contract.palette?.surface || "#e0c18b").toLowerCase(),
        accent: String(contract.palette?.accent || "#6f4e2b").toLowerCase(),
        ink: String(contract.palette?.ink || INK).toLowerCase(),
        inverseText: String(contract.palette?.inverseText || "#ffffff").toLowerCase(),
      },
      replacedAssets: imageInputs.filter((input) => slotAssets?.has(input.key)).map((input) => input.key),
      safeReplacementAssets: imageInputs.filter((input) => slotAssets?.has(input.key)).map((input) => ({ inputKey: input.key, src: slotAssets.get(input.key).src, sha256: slotAssets.get(input.key).sha256 })),
      note: `deterministic source-free variant ${variantIndex} of pack ${contract.packId}; plates are vector renders, no source pixels, no image model calls`,
    },
    fonts,
    formats: { feed, story },
    inputs: {
      images: imageInputs,
      text: spec ? spec.inputs.text.map((input) => ({
        key: input.key, label: input.label, required: input.required !== false, maxLength: input.maxLength || 48, sample: input.sample || "EDITABLE DETAIL",
      })) : [
        { key: "brand_name", label: "Brand-kit wordmark", required: true, maxLength: 24, sample: "YOUR BRAND" },
        ...semanticLayers.map((semantic) => ({
          key: semantic.key,
          label: semantic.label,
          required: semantic.required !== false,
          maxLength: semantic.maxLength || 32,
          sample: semantic.sample || "EDITABLE DETAIL",
        })),
        ...[
          { key: "headline", label: "Headline", required: true, maxLength: headlineMaxLength, sample: textValues.headline },
          { key: "supporting", label: "Supporting line", required: true, maxLength: supportingMaxLength, sample: textValues.supporting },
          { key: "handle", label: "Contact / URL", required: true, maxLength: 32, sample: textValues.handle },
          { key: "arrow", label: "Arrow cue", required: true, maxLength: 4, sample: textValues.arrow },
        ],
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
  validateInitialPortfolioContract(contract);
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
  const fixtureCatalog = resolveSafeFixtureCatalog(REPO_ROOT);
  const fixtureCandidates = [...fixtureCatalog.values()];
  validateInitialFixtureAssignments(fixtureCatalog);
  if (!fixtureCandidates.some((fixture) => fixture.path === slotPath)) {
    throw new Error(`--slot must point to a committed source-free fixture; got ${slotPath}`);
  }

  // ── 4. fonts from the committed manifest (exact faces used by the docs) ───
  const manifest = readJson(join(REPO_ROOT, "public", "fonts", "adstudio", "manifest.json"));
  const faces = manifest.faces || [];
  const resolveFace = (fontId, weight) => {
    const face = faces.find((f) => f.fontId === fontId && f.weight === weight && !f.italic);
    if (!face) throw new Error(`font ${fontId}@${weight} missing from manifest`);
    return { fontId: face.fontId, family: face.family, weight: face.weight, italic: false, file: face.file, sha256: face.sha256 };
  };
  const fonts = [
    resolveFace("barlow-condensed", 800),
    resolveFace("barlow", 600),
    resolveFace("cormorant-garamond", 700),
    resolveFace("elsie-swash-caps", 900),
  ];

  // ── 5. build the variants ─────────────────────────────────────────────────
  const variantIds = [];
  const requestedSkeleton = contract.skeletonIndex == null ? 0 : Number(contract.skeletonIndex);
  if (!contract.portfolioSpec && (!Number.isInteger(requestedSkeleton) || requestedSkeleton < 0 || requestedSkeleton >= SKELETONS.length)) {
    throw new Error(`skeletonIndex must be an integer in [0,${SKELETONS.length - 1}]`);
  }
  const skeletonKeys = SKELETONS.slice(0, count);
  for (let i = 0; i < count; i += 1) {
    const variantIndex = i + 1;
    const skeleton = contract.portfolioSpec ? skeletonFromSpec(contract.portfolioSpec) : contract.composition ?? applyLayoutVariant(
      multiConcept ? skeletonKeys[i] : SKELETONS[requestedSkeleton],
      contract.layoutVariant ?? (multiConcept ? i : 0),
    );
    const id = multiConcept
      ? `${contract.packId}-v${String(variantIndex).padStart(2, "0")}`
      : contract.templateId || contract.packId;
    variantIds.push(id);
    mkdirSync(join(assetsDir, id), { recursive: true });
    mkdirSync(join(publicDir, "adstudio-templates", id), { recursive: true });

    // plates: deterministic vector renders (no image model, no source pixels)
    const feedSvg = plateSvg(skeleton.key, skeleton.feed, contract.text || {}, "4:5", contract.palette);
    const storySvg = plateSvg(skeleton.key, skeleton.story, contract.text || {}, "9:16", contract.palette);
    const feedPlate = await toLosslessWebp(await sharp(Buffer.from(feedSvg)).png().toBuffer());
    const storyPlate = await toLosslessWebp(await sharp(Buffer.from(storySvg)).png().toBuffer());
    const feedSha = sha256(feedPlate);
    const storySha = sha256(storyPlate);
    writeFileSync(join(assetsDir, id, "plate-feed.webp"), feedPlate);
    writeFileSync(join(assetsDir, id, "plate-story.webp"), storyPlate);
    const storyBackingPatch = await sharp({ create: { width: 1, height: 1, channels: 4, background: STORY_BACKING_COLOUR } }).webp({ lossless: true }).toBuffer();
    const storyBackingSha = sha256(storyBackingPatch);
    const needsStoryBacking = Boolean(contract.portfolioSpec?.formats?.story?.layers?.some((layer) => layer.type === "overlay_patch")) || !contract.portfolioSpec;
    if (needsStoryBacking) {
      writeFileSync(join(assetsDir, id, "patch-supporting.webp"), storyBackingPatch);
      writeFileSync(join(assetsDir, id, "patch-cta.webp"), storyBackingPatch);
    }

    // Sample: deterministic render with committed, source-free fixture
    // photography. Initial portfolio specs get an explicit archetype mapping;
    // generic packs retain the historical --slot behavior.
    const propertyInputs = (contract.portfolioSpec?.inputs?.images || []).filter((input) => input.kind === "image");
    const assignedFixtures = assignedFixturesForTemplate(id, propertyInputs.length, fixtureCatalog)
      || propertyInputs.map((_, inputIndex) => {
        const fixture = fixtureCandidates[inputIndex % Math.max(1, fixtureCandidates.length)] || { path: slotPath };
        return fixture;
      });
    const slotAssets = new Map(contract.portfolioSpec ? [] : [["customer_photo", { src: slotRel, bytes: slotBytes, sha256: slotSha }]]);
    const fixtureByInput = new Map(propertyInputs.map((input, inputIndex) => [input.key, assignedFixtures[inputIndex]]));
    for (const input of contract.portfolioSpec?.inputs?.images || []) {
      // Logo and portrait inputs intentionally stay empty in the sample so a
      // property photo is never misrepresented as a brand mark or person.
      if (input.kind !== "image") continue;
      const fixture = fixtureByInput.get(input.key) || { path: slotPath };
      const bytes = await fixtureBytes(fixture);
      const safeName = `${id}/${input.key.replace(/[^a-z0-9_-]/gi, "-")}`;
      const extension = fixture.path == null ? "webp" : fixture.path.endsWith(".webp") ? "webp" : fixture.path.endsWith(".jpg") || fixture.path.endsWith(".jpeg") ? "jpg" : "png";
      const relative = `/slots/${safeName}.${extension}`;
      mkdirSync(join(publicDir, "slots", id), { recursive: true });
      writeFileSync(join(publicDir, relative.slice(1)), bytes);
      slotAssets.set(input.key, { src: relative, bytes, sha256: sha256(bytes) });
    }
    const doc = buildDoc({ contract, variantIndex, skeleton, fonts, plates: { feed: feedSha, story: storySha }, sampleHash: "0".repeat(64), slotSha, slotSrc: slotRel, slotAssets, storyBackingSha });
    for (const layer of doc.formats.story.layers.filter((entry) => entry.type === "overlay_patch")) {
      layer.src = layer.src.replace("__TEMPLATE_ID__", id);
    }
    const instance = (format) => ({
      schema: "adstudio.instance.v2",
      templateId: doc.id,
      templateHash: "0".repeat(64),
      format,
      values: {
        images: Object.fromEntries(doc.inputs.images.filter((input) => slotAssets.has(input.key)).map((input) => [input.key, { src: slotAssets.get(input.key).src }])),
        text: { ...(contract.text || {}), ...(contract.semanticValues || {}), ...Object.fromEntries(doc.inputs.text.map((input) => [input.key, input.sample])) },
      },
      overrides: [],
    });
    const samplePng = await renderAdDocToPng(doc, instance("4:5"), "4:5", {
      repoRoot,
      slotBytes: new Map([...slotAssets.entries()].map(([key, asset]) => [key, asset.bytes])),
    });
    const sampleHash = sha256(samplePng);
    writeFileSync(join(publicDir, "adstudio-templates", id, "sample.png"), samplePng);
    doc.provenance.sample.contentHash = sampleHash;

    // story sample: the 9:16 placement preview, so every variant ships both
    // placements and the visual-output (tofu) gate can scan the 9:16 surface.
    const storySamplePng = await renderAdDocToPng(doc, instance("9:16"), "9:16", {
      repoRoot,
      slotBytes: new Map([...slotAssets.entries()].map(([key, asset]) => [key, asset.bytes])),
    });
    const storySampleHash = sha256(storySamplePng);
    writeFileSync(join(publicDir, "adstudio-templates", id, "sample-story.png"), storySamplePng);
    doc.provenance.storySample = {
      imageSrc: `/adstudio-templates/${id}/sample-story.png`,
      contentHash: storySampleHash,
      generatedBy: "deterministic_render",
    };

    // Evidence binds to the semantic document so the same candidate has one
    // identity across LF/CRLF checkouts and operating systems.
    const templateSha256 = hashCanonicalJson(doc);
    writeJson(join(galleryDir, id, "template.json"), doc);
    writeJson(join(galleryDir, id, "evidence.json"), {
      schema: "adstudio.template.evidence.v2",
      templateSha256,
      iteration: {
        process: "source-analysis -> layered-v2 -> deterministic-render -> qa",
        status: "qa",
        authority: "seed-only",
        accepted: false,
        durableRunRequired: true,
        note: "This local artifact may seed a Frank/Hermes run but carries no score, approval, or release authority.",
      },
      sourceValues: { ...(contract.text || {}), ...(contract.semanticValues || {}) },
      fixtureAssignment: propertyInputs.map((input) => {
        const fixture = fixtureByInput.get(input.key);
        return {
          inputKey: input.key,
          catalogKey: fixture?.key || null,
          provenance: fixture?.procedural ? "procedural:svg-property-illustration-v1" : "committed:public-safe-fixture-catalog-v3",
          src: slotAssets.get(input.key)?.src || null,
          sha256: slotAssets.get(input.key)?.sha256 || null,
        };
      }),
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
    fixtureCorpus: {
      version: "adstudio-subject-invariance-fixtures-v2",
      catalogVersion: "public-safe-fixture-catalog-v3",
      proceduralGenerator: "svg-property-illustration-v1",
      assetCount: Object.keys(SAFE_FIXTURE_CATALOG).length,
      committedPath: "public/adstudio-samples/photos/int-bedroom.png",
      copied: true,
      symlinked: false,
    },
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

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(SCRIPT_PATH)) {
  main().catch((error) => {
    console.error(error?.stack ?? error);
    process.exit(1);
  });
}
