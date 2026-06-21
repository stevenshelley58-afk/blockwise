#!/usr/bin/env node
import { mkdir, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import {
  builtInAdStudioTemplates,
  renderDesign,
  resolveTemplateDesignForFormat,
} from "../src/lib/adstudio/index.ts";
import { GOLD_TEMPLATE_RENDER_SAMPLES } from "../src/lib/adstudio/gold-adstudio-templates.ts";
import { buildTrialFallbackBrandKit } from "../src/lib/adstudio/trial-brand-kit.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "adstudio-samples", "gold");
const SAMPLE_PHOTO_DIR = path.join(ROOT, "public", "adstudio-samples", "generated-au-properties");
const FORMAT = "4:5";
const OUTPUT_SIZE = { width: 1080, height: 1350 };

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

function goldTemplates() {
  return builtInAdStudioTemplates().filter((template) =>
    template.sampleStyle?.sampleCardImagePath?.startsWith("adstudio-samples/gold/"),
  );
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
    workspaceId: "workspace_gold_template_gallery",
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

async function imageBindings(templateId, design, samplePhotoDir) {
  const fileName = GOLD_TEMPLATE_RENDER_SAMPLES[templateId]?.photoFile;
  if (!fileName) throw new Error(`No gold sample photo configured for ${templateId}`);
  const photo = await fileDataUrl(path.join(samplePhotoDir, fileName));
  const bindings = {};
  for (const slot of design.layers.filter((layer) => layer.type === "image_slot")) {
    bindings[slot.id] = photo;
    bindings[slot.role] = photo;
  }
  return bindings;
}

async function renderAll(args) {
  const brandKit = sampleBrandKit();
  const templates = goldTemplates();

  await mkdir(args.outDir, { recursive: true });
  await removeStaleGoldCards(args.outDir, templates);

  for (const template of templates) {
    const design = resolveTemplateDesignForFormat(template, FORMAT);
    if (!design) throw new Error(`${template.id} does not have a ${FORMAT} TemplateDesign`);

    const creative = renderDesign(design, {
      text: GOLD_TEMPLATE_RENDER_SAMPLES[template.id]?.text,
      images: await imageBindings(template.id, design, args.samplePhotoDir),
    }, brandKit, {
      creativeId: `gold_gallery_sample:${template.id}:${FORMAT}`,
      campaignId: `gold_gallery_sample:${template.id}`,
      variantId: "gold_gallery_sample",
    });

    await sharp(Buffer.from(creative.previewSvg))
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(path.join(args.outDir, `${template.id}.png`));
  }
}

async function removeStaleGoldCards(outDir, templates) {
  const expected = new Set(templates.map((template) => `${template.id}.png`));
  let entries = [];
  try {
    entries = await readdir(outDir);
  } catch {
    return;
  }

  await Promise.all(entries
    .filter((entry) => entry.endsWith(".png") && !expected.has(entry))
    .map((entry) => unlink(path.join(outDir, entry))));
}

async function verify(args) {
  const templates = goldTemplates();
  const problems = [];

  const expectedCount = Object.keys(GOLD_TEMPLATE_RENDER_SAMPLES).length;
  if (templates.length !== expectedCount) {
    problems.push(`expected ${expectedCount} gold templates, found ${templates.length}`);
  }

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
  console.log(`Verified ${templates.length} TemplateDesign-rendered gold gallery samples in ${args.outDir}`);
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
