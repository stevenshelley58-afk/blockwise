#!/usr/bin/env node

// AdStudio has one template model: a safe public sample image plus the image
// and text inputs required to clone it. The private source ad is provenance for
// building the public sample; it is never itself a gallery image.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const galleryDir = resolve(process.env.ADSTUDIO_GALLERY_DIR ?? join(root, "src", "lib", "adstudio", "template-gallery"));
const publicDir = resolve(process.env.ADSTUDIO_PUBLIC_DIR ?? join(root, "public"));
const sourceDir = resolve(process.env.ADSTUDIO_SOURCE_DIR ?? join(root, "meta_ad_candidates"));

const forbiddenKeys = new Set([
  "canvas",
  "editableImage",
  "editableText",
  "fabricJson",
  "gallery",
  "placement",
  "promptHint",
  "templateKey",
  "version",
]);
const knownFormats = {
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
};
const diversityMinCount = 12;
const minDistinctIntents = 5;
const maxIntentShare = 0.5;
const failures = [];
const templates = [];

function fail(id, message) {
  failures.push(`${id}: ${message}`);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function publicPath(src) {
  if (typeof src !== "string" || !src.startsWith("/")) return null;
  return join(publicDir, ...src.slice(1).split("/"));
}

function findForbidden(value, path = "template") {
  if (!value || typeof value !== "object") return [];
  const found = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (forbiddenKeys.has(key)) found.push(childPath);
    found.push(...findForbidden(child, childPath));
  }
  return found;
}

const files = existsSync(galleryDir)
  ? readdirSync(galleryDir).filter((name) => /^meta-.*\.json$/u.test(name)).sort()
  : [];

for (const file of files) {
  try {
    templates.push({ file, template: JSON.parse(readFileSync(join(galleryDir, file), "utf8")) });
  } catch (error) {
    fail(file, `invalid JSON: ${error.message}`);
  }
}

const ids = new Set();
const sources = new Map();
const intentCounts = new Map();

for (const { file, template } of templates) {
  const id = template.id ?? file;
  if (template.id !== file.replace(/\.json$/u, "")) fail(id, "id must equal the file name");
  if (ids.has(template.id)) fail(id, "duplicate id");
  ids.add(template.id);
  if (template.source !== "builtin") fail(id, "source must be builtin");
  if (template.status !== "approved") fail(id, "status must be approved");

  const format = knownFormats[template.format];
  if (!format) fail(id, `unknown format ${template.format}`);
  else if (template.dimensions?.width !== format.width || template.dimensions?.height !== format.height) {
    fail(id, `dimensions must be ${format.width}x${format.height}`);
  }

  for (const path of findForbidden(template)) fail(id, `old template field is forbidden: ${path}`);

  const source = template.sourceAd;
  const sourceKey = source?.creativeId ?? source?.file;
  if (!sourceKey || !/^[a-f0-9]{64}$/iu.test(source?.contentHash ?? "")) {
    fail(id, "sourceAd provenance and SHA-256 contentHash are required");
  } else {
    if (sources.has(sourceKey)) fail(id, `source ad already used by ${sources.get(sourceKey)}`);
    sources.set(sourceKey, id);
    if (source.file) {
      const path = join(sourceDir, source.file);
      if (!existsSync(path)) fail(id, `sourceAd.file not found: ${source.file}`);
      else if (sha256(path) !== source.contentHash.toLowerCase()) fail(id, "sourceAd.contentHash does not match the source file");
    }
  }

  const sample = template.sample;
  if (sample?.generatedBy !== "reference_clone") fail(id, "sample.generatedBy must be reference_clone");
  if (!sample?.imageSrc || sample.thumbnailSrc !== sample.imageSrc || !sample.alt?.trim()) {
    fail(id, "sample image, matching thumbnail, and alt text are required");
  }
  if (!/^[a-f0-9]{64}$/iu.test(sample?.contentHash ?? "")) fail(id, "sample.contentHash must be a SHA-256 hash");
  const sampleFile = publicPath(sample?.imageSrc);
  if (!sampleFile || !existsSync(sampleFile)) fail(id, `sample image not found: ${sample?.imageSrc ?? "<missing>"}`);
  else if (sha256(sampleFile) !== sample.contentHash.toLowerCase()) fail(id, "sample.contentHash does not match the sample file");
  if (sample?.contentHash?.toLowerCase() === source?.contentHash?.toLowerCase()) {
    fail(id, "the public sample must be a generated clone, not the private source ad");
  }

  const images = template.inputs?.images;
  const text = template.inputs?.text;
  if (!Array.isArray(images) || images.length === 0 || !images.some((field) => field.required)) {
    fail(id, "at least one required image input is required");
  }
  if (!Array.isArray(text)) fail(id, "inputs.text must be an array");
  const inputKeys = new Set();
  for (const [kind, fields] of [["image", images ?? []], ["text", text ?? []]]) {
    for (const field of fields) {
      if (!field.key?.trim() || !field.label?.trim()) fail(id, `${kind} inputs need a key and label`);
      if (inputKeys.has(field.key)) fail(id, `duplicate input key: ${field.key}`);
      inputKeys.add(field.key);
      if (kind === "image" && !field.description?.trim()) fail(id, `image input ${field.key} needs a description`);
      if (kind === "text" && (!field.sample?.trim() || !Number.isInteger(field.maxLength) || field.maxLength < 1)) {
        fail(id, `text input ${field.key} needs sample text and a positive maxLength`);
      }
    }
  }

  if (template.meta?.platform !== "meta" || template.meta?.objective !== "OUTCOME_LEADS" || template.meta?.specialAdCategory !== "housing") {
    fail(id, "meta must describe a Meta OUTCOME_LEADS housing ad");
  }
  for (const key of ["ad_type", "primary_intent", "property_or_agent_focus"]) {
    if (!template.classification?.[key]?.trim()) fail(id, `classification.${key} is required`);
  }
  const intent = template.classification?.primary_intent?.trim();
  if (intent && intent !== "other") intentCounts.set(intent, (intentCounts.get(intent) ?? 0) + 1);
}

if (templates.length >= diversityMinCount) {
  if (intentCounts.size < minDistinctIntents) fail("DIVERSITY", `only ${intentCounts.size} distinct primary intents; need at least ${minDistinctIntents}`);
  for (const [intent, count] of intentCounts) {
    if (count > Math.ceil(templates.length * maxIntentShare)) fail("DIVERSITY", `${intent} dominates the gallery (${count}/${templates.length})`);
  }
}

if (failures.length) {
  console.error(`AdStudio template gate FAILED (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`AdStudio template gate passed - ${templates.length} template(s), ${intentCounts.size} distinct primary intent(s).`);
