#!/usr/bin/env node
// AdStudio v2 test fixtures — deterministic by construction.
//
// Generates the plates/patches/slot photos the three fixture templates render
// from, computes their sha256s, writes template.json + instance.json for each,
// and validates everything against the live zod schemas before writing. Run it
// twice → identical bytes. No timestamps, no randomness, no network.
//
//   fixture-simple   feed-only draft: 1 rect slot + 2 text layers (measuredLines)
//   fixture-effects  feed-only draft: rounded slot + overlay patch + stroke/shadow/gradient text
//   fixture-story    feed + story, status "ready": exercises every ready implication

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Canvas } from "@napi-rs/canvas";

import {
  adDocInstanceSchema,
  normalizeCanonicalJson,
  templateDocV2Schema,
} from "../../../src/lib/adstudio/v2/template-doc.ts";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "public");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const HEX_64 = (seed) => sha256(`fixture:${seed}`);

function writePng(relative, canvas) {
  const bytes = canvas.toBuffer("image/png");
  const absolute = join(publicDir, relative);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, bytes);
  return { src: `/${relative.replace(/\\/g, "/")}`, sha256: sha256(bytes), bytes };
}

// ─── asset painting (pure fills/gradients → deterministic) ──────────────────

function paintPlate(width, height, recipe) {
  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext("2d");
  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, recipe.top);
  background.addColorStop(1, recipe.bottom);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  for (const band of recipe.bands) {
    ctx.fillStyle = band.color;
    ctx.fillRect(band.x, band.y, band.width, band.height);
  }
  return canvas;
}

function paintPatch(width, height) {
  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext("2d");
  // Rounded badge with alpha — the overlay-patch shape (panel above a slot).
  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.moveTo(24, 0);
  ctx.arc(width - 24, 24, 24, -Math.PI / 2, 0);
  ctx.arc(width - 24, height - 24, 24, 0, Math.PI / 2);
  ctx.arc(24, height - 24, 24, Math.PI / 2, Math.PI);
  ctx.arc(24, 24, 24, Math.PI, (3 * Math.PI) / 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(40, height / 2 - 8, width - 80, 16);
  return canvas;
}

function paintPhoto(width, height, base, accent) {
  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(width * 0.3, height * 0.4, Math.min(width, height) * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(width * 0.55, height * 0.55, width * 0.3, height * 0.2);
  return canvas;
}

// ─── shared doc fragments ────────────────────────────────────────────────────

// alegreya-400 really exists in public/fonts/adstudio with this manifest sha.
const FONTS = [
  {
    fontId: "alegreya",
    family: "Alegreya",
    weight: 400,
    italic: false,
    file: "/fonts/adstudio/alegreya-400.woff2",
    sha256: "fe33a80f1e2f7200d22980bb3838c168f1e7a36262a3e51ff73f47242e79c21f",
  },
];

const TYPO_BASE = {
  fontId: "alegreya",
  family: "Alegreya",
  fallbackFamily: "serif",
  weight: 400,
  italic: false,
  case: "none",
  lineHeight: 1.1,
  tracking: 0,
  align: "left",
};

const MEASUREMENT = { fitScore: 0.92, detectionScore: 0.9, source: "ocr-v2", version: 2 };

function publishBlock({ story }) {
  return {
    platform: "meta",
    objective: "OUTCOME_LEADS",
    specialAdCategory: "housing",
    apiVersionMin: "v26.0",
    copy: {
      primaryText: ["Find your next home with a local expert."],
      headlines: ["Free home appraisal"],
      descriptions: ["Book in 30 seconds."],
    },
    cta: "GET_QUOTE",
    leadForm: {
      headline: "Get your free appraisal",
      questions: ["What is your property worth?"],
      thankYou: { title: "Thanks!", body: "We will be in touch within one business day." },
    },
    placements: {
      publisherPlatforms: ["facebook", "instagram"],
      facebookPositions: ["feed", "story"],
      instagramPositions: ["stream", "story"],
    },
    formatRouting: { feed: "4:5", story: story ? "9:16" : null },
    creativeFeatures: {
      adapt_to_placement: "OPT_OUT",
      image_touchups: "OPT_OUT",
      text_optimizations: "OPT_OUT",
    },
    previewFormats: ["MOBILE_FEED_STANDARD", "INSTAGRAM_STORY"],
  };
}

const PROVENANCE = (id) => ({
  sourceAd: { file: `meta_ad_candidates/${id}-source.png`, contentHash: HEX_64(`${id}:source`) },
  sample: {
    imageSrc: `/adstudio-templates/${id}/sample.png`,
    contentHash: HEX_64(`${id}:sample`),
    generatedBy: "deterministic_render",
  },
  decomposedFrom: "source",
});

const EDIT_POLICY = { mode: "guided", advancedUnlockable: true, lockedLayerIds: [] };

// ─── fixture-simple ──────────────────────────────────────────────────────────

const simplePlate = writePng("plates/fixture-simple-feed.png", paintPlate(1080, 1350, {
  top: "#f1f5f9",
  bottom: "#cbd5e1",
  bands: [{ x: 0, y: 1210, color: "#1e293b", width: 1080, height: 140 }],
}));

const simpleDoc = {
  schema: "adstudio.template.v2",
  id: "meta-fixture-simple",
  name: "Fixture Simple",
  goal: "seller_leads",
  offerId: "fixture-offer",
  category: "fixture",
  tags: ["fixture"],
  audienceIntent: "sellers",
  classification: { ad_type: "single_image", primary_intent: "lead_gen", property_or_agent_focus: "property" },
  provenance: PROVENANCE("meta-fixture-simple"),
  restyle: { paletteMap: {}, replacedAssets: [], note: "draft fixture — restyle recorded at ready time" },
  fonts: FONTS,
  formats: {
    feed: {
      format: "4:5",
      width: 1080,
      height: 1350,
      plate: { src: simplePlate.src, sha256: simplePlate.sha256 },
      layers: [
        {
          id: "slot-photo",
          z: 1,
          type: "image_slot",
          inputKey: "photo",
          fit: "cover",
          box: { x: 0.05, y: 0.05, width: 0.9, height: 0.45 },
          focal: { x: 0.5, y: 0.4 },
          mask: { kind: "rect" },
          minSourcePx: { width: 972, height: 608 },
        },
        {
          id: "text-headline",
          z: 2,
          type: "text",
          inputKey: "headline",
          box: { x: 0.05, y: 0.55, width: 0.9, height: 0.14 },
          typo: {
            ...TYPO_BASE,
            sizeRatio: 0.42,
            color: "#1e293b",
            measuredLines: [
              { text: "Find your", box: { x: 0.05, y: 0.55, width: 0.9, height: 0.07 }, sizeRatio: 0.8 },
              { text: "place", box: { x: 0.05, y: 0.625, width: 0.9, height: 0.055 }, sizeRatio: 0.7 },
            ],
          },
          constraints: { maxLength: 40, maxLines: 2, autoFitMinRatio: 0.85 },
          measurement: MEASUREMENT,
        },
        {
          id: "text-subline",
          z: 3,
          type: "text",
          inputKey: "subline",
          box: { x: 0.05, y: 0.74, width: 0.9, height: 0.1 },
          typo: { ...TYPO_BASE, sizeRatio: 0.34, color: "#475569", align: "left" },
          constraints: { maxLength: 80, maxLines: 2, autoFitMinRatio: 0.85 },
          measurement: MEASUREMENT,
        },
      ],
    },
  },
  inputs: {
    images: [{ key: "photo", label: "Property photo", required: true, aspect: "landscape", description: "A street or facade shot" }],
    text: [
      { key: "headline", label: "Headline", required: true, maxLength: 40, sample: "Find your place" },
      { key: "subline", label: "Supporting line", required: true, maxLength: 80, sample: "Homes matched to you" },
    ],
  },
  publish: publishBlock({ story: false }),
  editPolicy: EDIT_POLICY,
  exactness: { status: "draft", residuals: {}, bakedTextKeys: [] },
};

// ─── fixture-effects ─────────────────────────────────────────────────────────

const effectsPlate = writePng("plates/fixture-effects-feed.png", paintPlate(1080, 1350, {
  top: "#0f172a",
  bottom: "#1e3a5f",
  bands: [{ x: 0, y: 0, color: "#f59e0b", width: 1080, height: 24 }],
}));
const effectsPatch = writePng("patches/fixture-effects-badge.png", paintPatch(324, 160));

const effectsDoc = {
  schema: "adstudio.template.v2",
  id: "meta-fixture-effects",
  name: "Fixture Effects",
  goal: "appraisal_bookings",
  offerId: "fixture-offer",
  category: "fixture",
  tags: ["fixture"],
  audienceIntent: "sellers",
  classification: { ad_type: "single_image", primary_intent: "lead_gen", property_or_agent_focus: "agent" },
  provenance: PROVENANCE("meta-fixture-effects"),
  restyle: { paletteMap: {}, replacedAssets: [] },
  fonts: FONTS,
  formats: {
    feed: {
      format: "4:5",
      width: 1080,
      height: 1350,
      plate: { src: effectsPlate.src, sha256: effectsPlate.sha256 },
      layers: [
        {
          id: "slot-photo",
          z: 1,
          type: "image_slot",
          inputKey: "photo",
          fit: "cover",
          box: { x: 0.08, y: 0.22, width: 0.84, height: 0.4 },
          mask: { kind: "rounded", radius: 40 },
        },
        {
          id: "patch-badge",
          z: 2,
          type: "overlay_patch",
          box: { x: 0.35, y: 0.04, width: 0.3, height: 0.1185 },
          src: effectsPatch.src,
          sha256: effectsPatch.sha256,
        },
        {
          id: "text-headline",
          z: 3,
          type: "text",
          inputKey: "headline",
          box: { x: 0.08, y: 0.68, width: 0.84, height: 0.12 },
          typo: {
            ...TYPO_BASE,
            sizeRatio: 0.5,
            align: "center",
            case: "upper",
            color: "#f8fafc",
            effects: {
              stroke: { color: "#0f172a", widthRatio: 0.02 },
              shadow: { color: "#000000", blurRatio: 0.12, dx: 0.02, dy: 0.03 },
            },
          },
          constraints: { maxLength: 32, maxLines: 2, autoFitMinRatio: 0.85 },
          measurement: MEASUREMENT,
        },
        {
          id: "text-cta",
          z: 4,
          type: "text",
          inputKey: "ctaLine",
          box: { x: 0.08, y: 0.84, width: 0.84, height: 0.08 },
          typo: {
            ...TYPO_BASE,
            sizeRatio: 0.4,
            align: "center",
            color: "#f59e0b",
            effects: {
              gradientFill: { from: "#f59e0b", to: "#ef4444", angleDeg: 0 },
            },
          },
          constraints: { maxLength: 40, maxLines: 1, autoFitMinRatio: 0.85 },
          measurement: MEASUREMENT,
        },
      ],
    },
  },
  inputs: {
    images: [{ key: "photo", label: "Property photo", required: true, aspect: "landscape", description: "Facade or interior" }],
    text: [
      { key: "headline", label: "Headline", required: true, maxLength: 32, sample: "Book an appraisal" },
      { key: "ctaLine", label: "CTA line", required: true, maxLength: 40, sample: "Free this month" },
    ],
  },
  publish: publishBlock({ story: false }),
  editPolicy: EDIT_POLICY,
  exactness: { status: "draft", residuals: {}, bakedTextKeys: [] },
};

// ─── fixture-story (ready) ───────────────────────────────────────────────────

const storyFeedPlate = writePng("plates/fixture-story-feed.png", paintPlate(1080, 1350, {
  top: "#ecfdf5",
  bottom: "#a7f3d0",
  bands: [{ x: 0, y: 1180, color: "#065f46", width: 1080, height: 170 }],
}));
const storyStoryPlate = writePng("plates/fixture-story-story.png", paintPlate(1080, 1920, {
  top: "#ecfdf5",
  bottom: "#a7f3d0",
  bands: [{ x: 0, y: 1700, color: "#065f46", width: 1080, height: 220 }],
}));

const storyDoc = {
  schema: "adstudio.template.v2",
  id: "meta-fixture-story",
  name: "Fixture Story",
  goal: "buyer_leads",
  offerId: "fixture-offer",
  category: "fixture",
  tags: ["fixture", "story"],
  audienceIntent: "buyers",
  classification: { ad_type: "single_image", primary_intent: "lead_gen", property_or_agent_focus: "property" },
  provenance: PROVENANCE("meta-fixture-story"),
  restyle: {
    paletteMap: { "#e11d48": "#1d4ed8" },
    replacedAssets: ["photo"],
    note: "fixture restyle: palette remap + generic photo",
  },
  fonts: FONTS,
  formats: {
    feed: {
      format: "4:5",
      width: 1080,
      height: 1350,
      plate: { src: storyFeedPlate.src, sha256: storyFeedPlate.sha256 },
      layers: [
        {
          id: "feed-slot-photo",
          z: 1,
          type: "image_slot",
          inputKey: "photo",
          fit: "cover",
          box: { x: 0.06, y: 0.06, width: 0.88, height: 0.5 },
          mask: { kind: "ellipse" },
        },
        {
          id: "feed-text-headline",
          z: 2,
          type: "text",
          inputKey: "headline",
          box: { x: 0.06, y: 0.62, width: 0.88, height: 0.12 },
          typo: { ...TYPO_BASE, sizeRatio: 0.45, color: "#065f46", align: "center" },
          constraints: { maxLength: 36, maxLines: 2, autoFitMinRatio: 0.85 },
          measurement: MEASUREMENT,
        },
      ],
    },
    story: {
      format: "9:16",
      width: 1080,
      height: 1920,
      plate: { src: storyStoryPlate.src, sha256: storyStoryPlate.sha256 },
      layers: [
        {
          id: "story-slot-photo",
          z: 1,
          type: "image_slot",
          inputKey: "photo",
          fit: "cover",
          box: { x: 0.1, y: 0.2, width: 0.8, height: 0.35 },
          mask: { kind: "rect" },
        },
        {
          id: "story-text-headline",
          z: 2,
          type: "text",
          inputKey: "headline",
          // Inside Meta's story safe zones: below 250px, above the 340px band.
          box: { x: 0.1, y: 0.6, width: 0.8, height: 0.1 },
          typo: { ...TYPO_BASE, sizeRatio: 0.45, color: "#065f46", align: "center" },
          constraints: { maxLength: 36, maxLines: 2, autoFitMinRatio: 0.85 },
          measurement: MEASUREMENT,
        },
      ],
    },
  },
  inputs: {
    images: [{ key: "photo", label: "Property photo", required: true, aspect: "landscape", description: "Street shot" }],
    text: [{ key: "headline", label: "Headline", required: true, maxLength: 36, sample: "Your next address" }],
  },
  publish: publishBlock({ story: true }),
  editPolicy: EDIT_POLICY,
  exactness: {
    status: "ready",
    residuals: {
      "feed-text-headline": 0.05,
      "story-text-headline": 0.06,
    },
    bakedTextKeys: [],
    qaBy: "fixture-qa",
    qaAt: "2026-08-05T00:00:00.000Z",
  },
};

// ─── instances ───────────────────────────────────────────────────────────────

function instanceFor(doc, format, overrides = []) {
  return {
    schema: "adstudio.instance.v2",
    templateId: doc.id,
    templateHash: sha256(normalizeCanonicalJson(doc)),
    format,
    values: {
      images: { photo: { src: "fixture:/slots/photo-landscape.png", focal: { x: 0.5, y: 0.5 }, zoom: 1 } },
      text: Object.fromEntries(
        doc.inputs.text.map((input) => [input.key, input.sample]),
      ),
    },
    overrides,
  };
}

const fixtures = [
  { doc: simpleDoc, instances: [{ name: "feed", instance: instanceFor(simpleDoc, "4:5") }] },
  {
    doc: effectsDoc,
    instances: [{
      name: "feed",
      instance: instanceFor(effectsDoc, "4:5", [
        { layerId: "text-headline", op: "color", color: "#fbbf24" },
        { layerId: "text-cta", op: "align", align: "left" },
      ]),
    }],
  },
  {
    doc: storyDoc,
    instances: [
      { name: "feed", instance: instanceFor(storyDoc, "4:5") },
      {
        name: "story",
        instance: instanceFor(storyDoc, "9:16", [
          { layerId: "story-text-headline", op: "move", box: { x: 0.1, y: 0.62, width: 0.8, height: 0.1 } },
        ]),
      },
    ],
  },
];

// ─── slot photos (customer-side test inputs) ─────────────────────────────────

writePng("slots/photo-landscape.png", paintPhoto(1600, 1000, "#7c8db0", "#f8fafc"));
writePng("slots/photo-portrait.png", paintPhoto(1000, 1600, "#b08d7c", "#f8fafc"));
writePng("slots/photo-square.png", paintPhoto(1200, 1200, "#7cb08d", "#f8fafc"));

// ─── validate + write ────────────────────────────────────────────────────────

for (const { doc, instances } of fixtures) {
  templateDocV2Schema.parse(doc);
  mkdirSync(join(here, doc.id), { recursive: true });
  writeFileSync(join(here, doc.id, "template.json"), `${JSON.stringify(doc, null, 2)}\n`);
  for (const { name, instance } of instances) {
    adDocInstanceSchema.parse(instance);
    writeFileSync(join(here, doc.id, `instance-${name}.json`), `${JSON.stringify(instance, null, 2)}\n`);
  }
}

console.log(`fixtures written: ${fixtures.map((f) => f.doc.id).join(", ")}`);
