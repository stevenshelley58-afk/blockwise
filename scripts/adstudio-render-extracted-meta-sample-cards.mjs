#!/usr/bin/env node
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import {
  resolvableAdStudioTemplates,
  renderDesign,
  resolveTemplateDesignForFormat,
} from "../src/lib/adstudio/index.ts";
import { buildTrialFallbackBrandKit } from "../src/lib/adstudio/trial-brand-kit.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "adstudio-samples", "extracted-meta");
const SAMPLE_PHOTO_DIR = path.join(ROOT, "public", "adstudio-samples", "generated-au-properties");
const FORMAT = "4:5";
const OUTPUT_SIZE = { width: 1080, height: 1350 };

const SAMPLE_PHOTOS = [
  "au-modern-coastal.png",
  "au-federation-bungalow.png",
  "au-limestone-coastal.png",
  "au-urban-townhouse.png",
  "au-family-rendered.png",
  "au-coastal-luxury.jpg",
  "au-riverside-townhouse.jpg",
  "au-character-cottage.jpg",
  "au-brick-family-home.jpg",
];

const PRICE_LINES = [
  "From $895k",
  "Offers invited",
  "Guide $1.25m",
  "Just listed",
  "Sold in 9 days",
  "Market update",
  "Private viewing",
  "New to market",
  "Family home",
  "Coastal living",
];

const COPY_OVERRIDES = {
  meta_002: {
    eyebrow: "BUYER / SELLER GUIDE",
    headline: "Buying or selling in Bicton?",
    body: "Clear local advice before your next move.",
    cta: "Start planning",
    address: "12 Bicton Road",
  },
  meta_021: {
    eyebrow: "NEW LISTING",
    headline: "Fresh to market",
    body: "A standout Fremantle home with the features buyers notice.",
    cta: "View listing",
    address: "31 Fremantle Road",
  },
  meta_040: {
    eyebrow: "LUXURY APARTMENT",
    headline: "North Perth living",
    body: "Premium finishes, natural light, and a simple enquiry path.",
    cta: "View details",
    address: "40 Angove Street",
  },
  meta_044: {
    eyebrow: "OPEN HOME",
    headline: "Open this Saturday",
    body: "Inspect a renovated local home with strong street appeal.",
    cta: "Save the time",
    address: "44 Jarrah Avenue",
  },
  meta_055: {
    eyebrow: "JUST SOLD",
    headline: "Sold in North Perth",
    body: "Use the latest result to plan your next step.",
    cta: "Get the result",
    address: "65 North Perth Road",
  },
  meta_094: {
    eyebrow: "FOR SALE",
    headline: "Modern home for sale",
    body: "Lead with the hero photo, price guide, and a clear CTA.",
    cta: "Enquire now",
    address: "94 Cottesloe Drive",
  },
  meta_142: {
    eyebrow: "LISTING UPDATE",
    headline: "A home worth watching",
    body: "Show the property story clearly across feed and stories.",
    cta: "See the home",
    address: "142 Coastal Road",
  },
  meta_245: {
    eyebrow: "LOCAL AGENT",
    headline: "Looking for an agent?",
    body: "Local guidance for your next property move.",
    cta: "Schedule a call",
    address: "255 Victoria Park Road",
  },
  meta_259: {
    eyebrow: "AGENT PROFILE",
    headline: "Plan your next move",
    body: "A calm, clear way to start the property conversation.",
    cta: "Talk to us",
    address: "259 Maylands Avenue",
  },
  meta_317: {
    eyebrow: "SELLER GUIDE",
    headline: "Ready to sell?",
    body: "A simple checklist for a stronger campaign launch.",
    cta: "Get the guide",
    address: "317 Scarborough Road",
  },
};
const COMMITTED_EXTRACTED_META_SAMPLE_IDS = new Set(Object.keys(COPY_OVERRIDES));

function parseArgs(argv) {
  const args = { outDir: OUT_DIR, samplePhotoDir: SAMPLE_PHOTO_DIR, verifyOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--verify-only") {
      args.verifyOnly = true;
    } else if (arg === "--out-dir") {
      args.outDir = path.resolve(argv[++index] ?? "");
    } else if (arg === "--sample-photo-dir") {
      args.samplePhotoDir = path.resolve(argv[++index] ?? "");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  throw new Error(`Unsupported sample photo type: ${filePath}`);
}

async function fileDataUrl(filePath) {
  const bytes = await readFile(filePath);
  return `data:${mimeFor(filePath)};base64,${bytes.toString("base64")}`;
}

function sampleBrandKit() {
  const kit = buildTrialFallbackBrandKit({
    workspaceId: "workspace_adstudio_gallery",
    workspaceName: "Blockwise Realty",
    region: "WA",
  });

  return {
    ...kit,
    contact: {
      ...kit.contact,
      phone: "08 6111 2400",
      email: "hello@blockwise.example",
      socialLinks: ["@blockwiserealty"],
    },
  };
}

function extractedMetaTemplates() {
  return resolvableAdStudioTemplates().filter((template) =>
    COMMITTED_EXTRACTED_META_SAMPLE_IDS.has(template.id),
  );
}

function sampleText(template, index) {
  const style = template.sampleStyle;
  const copy = template.sampleCopy;
  const override = COPY_OVERRIDES[template.id] ?? {};
  const address = style?.address && !/anywhere|12345/i.test(style.address)
    ? style.address
    : `${12 + index * 7} ${["Marine", "Jarrah", "Marmion", "View", "Forrest"][index % 5]} Street, ${style?.sampleSuburb ?? "Perth"}`;
  const headline = override.headline ?? copy?.headline ?? template.name;
  const primary = override.body ?? copy?.primaryText ?? template.promptHint;

  return {
    eyebrow: override.eyebrow ?? style?.resultDetail ?? "Local property update",
    headline,
    subhead: primary,
    body: primary,
    cta: override.cta ?? copy?.cta ?? "View listing",
    price: PRICE_LINES[index % PRICE_LINES.length],
    address: override.address ?? address,
    stat: index % 3 === 0 ? "4 bed / 2 bath" : index % 3 === 1 ? "3 bed / 2 bath" : "2 bed / 2 bath",
    handle: `@${(style?.agencyName ?? "Blockwise Realty").toLowerCase().replace(/[^a-z0-9]+/g, "")}`,
    phone: "08 6111 2400",
  };
}

function imageBindings(design, photos, index) {
  const slots = design.layers.filter((layer) => layer.type === "image_slot");
  const bindings = {};

  slots.forEach((slot, slotIndex) => {
    const offset = slot.role === "primary" ? 0 : slotIndex + 2;
    const image = photos[(index + offset) % photos.length];
    bindings[slot.id] = image;
    bindings[slot.role] = image;
  });

  return bindings;
}

async function loadSamplePhotos(samplePhotoDir) {
  const photos = [];
  for (const fileName of SAMPLE_PHOTOS) {
    const filePath = path.join(samplePhotoDir, fileName);
    photos.push(await fileDataUrl(filePath));
  }
  return photos;
}

async function renderAll(args) {
  const photos = await loadSamplePhotos(args.samplePhotoDir);
  const brandKit = sampleBrandKit();
  const templates = extractedMetaTemplates();

  await mkdir(args.outDir, { recursive: true });

  for (const [index, template] of templates.entries()) {
    const design = resolveTemplateDesignForFormat(template, FORMAT);
    if (!design) throw new Error(`${template.id} does not have a ${FORMAT} TemplateDesign`);

    const creative = renderDesign(design, {
      text: sampleText(template, index),
      images: imageBindings(design, photos, index),
    }, brandKit, {
      creativeId: `gallery_sample:${template.id}:${FORMAT}`,
      campaignId: `gallery_sample:${template.id}`,
      variantId: "gallery_sample",
    });

    const outPath = path.join(args.outDir, `${template.id}.png`);
    await sharp(Buffer.from(creative.previewSvg))
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(outPath);
  }
}

async function verify(args) {
  const templates = extractedMetaTemplates();
  const problems = [];

  for (const template of templates) {
    const filePath = path.join(args.outDir, `${template.id}.png`);
    let metadata;
    try {
      metadata = await sharp(filePath).metadata();
    } catch (error) {
      problems.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    if (metadata.width !== OUTPUT_SIZE.width || metadata.height !== OUTPUT_SIZE.height) {
      problems.push(`${filePath}: ${metadata.width}x${metadata.height}, expected ${OUTPUT_SIZE.width}x${OUTPUT_SIZE.height}`);
    }
  }

  if (problems.length) throw new Error(problems.join("\n"));
  console.log(`Verified ${templates.length} TemplateDesign-rendered extracted Meta gallery samples in ${args.outDir}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.verifyOnly) await renderAll(args);
  await verify(args);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
