#!/usr/bin/env node

// AdStudio has one template model: a safe public sample image plus the image
// and text inputs required to clone it. The private source ad is provenance for
// building the public sample; it is never itself a gallery image.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  MAGIC_LAYER_MIN_FONT_FIT,
  MAGIC_LAYER_MIN_REGION_CONFIDENCE,
} from "../../src/lib/adstudio/magic-layers-config.mjs";

const root = process.cwd();
const galleryDir = resolve(process.env.ADSTUDIO_GALLERY_DIR ?? join(root, "src", "lib", "adstudio", "template-gallery"));
const publicDir = resolve(process.env.ADSTUDIO_PUBLIC_DIR ?? join(root, "public"));
const sourceDir = resolve(process.env.ADSTUDIO_SOURCE_DIR ?? join(root, "meta_ad_candidates"));
const fontManifestPath = join(publicDir, "fonts", "adstudio", "manifest.json");
const fontManifest = existsSync(fontManifestPath)
  ? JSON.parse(readFileSync(fontManifestPath, "utf8"))
  : { faces: [] };
const fontFaces = new Map((fontManifest.faces ?? []).map((face) => [face.file, face]));
const excludedFaces = new Set((fontManifest.excluded ?? []).map(
  (face) => `${face.fontId}:${face.weight}:${face.italic ? "italic" : "normal"}`,
));

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

// Magic Layers typography coverage. Baseline set below the pipeline's
// current empirical result (383/410 regions = 93.4%, see
// scripts/build/font-corpus/adstudio-type-specs.mjs run history) so routine
// noise doesn't fail the gate, while a real regression (a bug that drops
// coverage well below what the pipeline already achieves) does.
const minTypographyCoverage = 0.85;
const lowFitScoreThreshold = 0.15;
let typographyEntries = 0;
let typographyLowFitEntries = 0;
let typographyTextInputTotal = 0;
const deterministicEditingCounts = { legacy: 0, partial: 0, ready: 0 };

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

function isNormalizedBox(box) {
  return Boolean(box)
    && [box.x, box.y, box.width, box.height].every(Number.isFinite)
    && box.x >= 0
    && box.y >= 0
    && box.width > 0
    && box.height > 0
    && box.x + box.width <= 1.001
    && box.y + box.height <= 1.001;
}

function overlapRatio(left, right) {
  const overlapWidth = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const overlapHeight = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  const overlapArea = overlapWidth * overlapHeight;
  const smallerArea = Math.min(left.width * left.height, right.width * right.height);
  return smallerArea > 0 ? overlapArea / smallerArea : 0;
}

/**
 * Deterministic editing is an opt-in release contract. A template without the
 * marker can remain in the staged migration, but one marked ready must cover
 * every declared customer input with offline, trustworthy editor evidence.
 */
function verifyDeterministicEditing(template, id, images, text) {
  const editing = template.deterministicEditing;
  const hasOfflineEvidence = editing !== undefined || template.typography !== undefined;
  if (!editing) {
    deterministicEditingCounts[hasOfflineEvidence ? "partial" : "legacy"] += 1;
    return;
  }
  if (!(editing.status === "partial" || editing.status === "ready")) {
    deterministicEditingCounts.partial += 1;
    fail(id, "deterministicEditing.status must be partial or ready");
    return;
  }

  const issues = [];
  const textKeys = new Set((text ?? []).map((field) => field.key));
  for (const field of text ?? []) {
    const spec = template.typography?.[field.key];
    if (!spec) {
      issues.push(`text input ${field.key} has no typography spec`);
      continue;
    }
    if (!isNormalizedBox(spec.sampleBox)) issues.push(`text input ${field.key} has no valid sampleBox`);
    if (!Number.isFinite(spec.measurementVersion) || spec.measurementVersion < 2) {
      issues.push(`text input ${field.key} uses a legacy typography measurement`);
    }
    if (spec.measurementSource !== "ocr-v2" && spec.measurementSource !== "manual-verified") {
      issues.push(`text input ${field.key} has no verified measurement provenance`);
    }
    if (
      !Array.isArray(spec.measuredLines)
      || spec.measuredLines.length !== Math.max(1, spec.sampleLineCount)
      || spec.measuredLines.some((line) => (
        typeof line?.text !== "string"
        || !line.text.trim()
        || !isNormalizedBox(line.sampleBox)
        || !Number.isFinite(line.sizeRatio)
        || line.sizeRatio <= 0
      ))
    ) {
      issues.push(`text input ${field.key} has no valid per-line typography evidence`);
    }
    if (spec.fitScore < MAGIC_LAYER_MIN_FONT_FIT || spec.detectionScore < MAGIC_LAYER_MIN_REGION_CONFIDENCE) {
      issues.push(`text input ${field.key} does not meet the confidence threshold`);
    }
    if (!spec.fontFile?.trim()) issues.push(`text input ${field.key} has no self-hosted fontFile`);
  }
  for (const key of Object.keys(template.typography ?? {})) {
    if (!textKeys.has(key)) issues.push(`typography.${key} does not match a declared text input`);
  }
  const textBoxes = (text ?? []).flatMap((field) => {
    const box = template.typography?.[field.key]?.sampleBox;
    return isNormalizedBox(box) ? [{ key: field.key, box }] : [];
  });
  for (let left = 0; left < textBoxes.length; left += 1) {
    for (let right = left + 1; right < textBoxes.length; right += 1) {
      if (overlapRatio(textBoxes[left].box, textBoxes[right].box) > 0.05) {
        issues.push(`text inputs ${textBoxes[left].key} and ${textBoxes[right].key} have overlapping editor boxes`);
      }
    }
  }

  const imageKeys = new Set((images ?? []).map((field) => field.key));
  for (const field of images ?? []) {
    if (!isNormalizedBox(editing.imageBoxes?.[field.key])) {
      issues.push(`image input ${field.key} has no valid editor hitbox`);
    }
  }
  for (const key of Object.keys(editing.imageBoxes ?? {})) {
    if (!imageKeys.has(key)) issues.push(`deterministicEditing.imageBoxes.${key} does not match a declared image input`);
  }

  if (editing.status === "partial") {
    deterministicEditingCounts.partial += 1;
    for (const [key, box] of Object.entries(editing.imageBoxes ?? {})) {
      if (imageKeys.has(key) && !isNormalizedBox(box)) {
        fail(id, `deterministic editing: image input ${key} has no valid editor hitbox`);
      }
    }
    return;
  }

  if (issues.length) {
    deterministicEditingCounts.partial += 1;
    for (const issue of issues) fail(id, `deterministic editing: ${issue}`);
  } else {
    deterministicEditingCounts.ready += 1;
  }
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

  verifyDeterministicEditing(template, id, images, text);

  if (template.meta?.platform !== "meta" || template.meta?.objective !== "OUTCOME_LEADS" || template.meta?.specialAdCategory !== "housing") {
    fail(id, "meta must describe a Meta OUTCOME_LEADS housing ad");
  }
  for (const key of ["ad_type", "primary_intent", "property_or_agent_focus"]) {
    if (!template.classification?.[key]?.trim()) fail(id, `classification.${key} is required`);
  }
  const intent = template.classification?.primary_intent?.trim();
  if (intent && intent !== "other") intentCounts.set(intent, (intentCounts.get(intent) ?? 0) + 1);

  // Magic Layers typography (scripts/build/font-corpus/adstudio-type-specs.mjs
  // output). Optional per-template and per-region — the offline build can't
  // always find/measure a region (see docs/plans/2026-07-27-adstudio-magic-
  // layers-editor.md §7) — but whatever IS present must be well-formed and
  // keyed to a real text input, and coverage overall must not silently regress.
  if (template.typography !== undefined) {
    if (typeof template.typography !== "object" || template.typography === null || Array.isArray(template.typography)) {
      fail(id, "typography must be an object keyed by text input key");
    } else {
      const textKeys = new Set((text ?? []).map((field) => field.key));
      for (const [key, spec] of Object.entries(template.typography)) {
        typographyEntries += 1;
        if (!textKeys.has(key)) { fail(id, `typography.${key} does not match any inputs.text key`); continue; }
        if (!spec || typeof spec !== "object") { fail(id, `typography.${key} must be an object`); continue; }
        if (!spec.fontId?.trim() || !spec.family?.trim()) fail(id, `typography.${key}.fontId/family are required`);
        if (!["serif", "sans-serif", "monospace", "cursive"].includes(spec.fallbackFamily)) {
          fail(id, `typography.${key}.fallbackFamily must be a CSS generic family`);
        }
        if (!Number.isFinite(spec.weight) || spec.weight < 100 || spec.weight > 900) {
          fail(id, `typography.${key}.weight must be a CSS weight 100-900`);
        }
        if (typeof spec.italic !== "boolean") fail(id, `typography.${key}.italic must be boolean`);
        if (!["upper", "lower", "mixed", "none"].includes(spec.case)) fail(id, `typography.${key}.case is invalid`);
        if (!Number.isFinite(spec.sizeRatio) || spec.sizeRatio <= 0) fail(id, `typography.${key}.sizeRatio must be a positive number`);
        if (!Number.isFinite(spec.lineHeight) || spec.lineHeight <= 0) fail(id, `typography.${key}.lineHeight must be a positive number`);
        if (!Number.isFinite(spec.tracking)) fail(id, `typography.${key}.tracking must be a number`);
        if (!["left", "center", "right"].includes(spec.align)) fail(id, `typography.${key}.align is invalid`);
        if (!/^#[0-9a-f]{6}$/iu.test(spec.color ?? "")) fail(id, `typography.${key}.color must be a #rrggbb hex string`);
        if (!Number.isFinite(spec.fitScore) || spec.fitScore < 0 || spec.fitScore > 1) {
          fail(id, `typography.${key}.fitScore must be between 0 and 1`);
        } else if (spec.fitScore < lowFitScoreThreshold) {
          typographyLowFitEntries += 1;
        }
        const box = spec.sampleBox;
        if (
          !box
          || ![box.x, box.y, box.width, box.height].every((value) => Number.isFinite(value))
          || box.x < 0
          || box.y < 0
          || box.width <= 0
          || box.height <= 0
          || box.x + box.width > 1.001
          || box.y + box.height > 1.001
        ) {
          fail(id, `typography.${key}.sampleBox must be a valid normalized box`);
        }
        if (!Number.isInteger(spec.sampleLineCount) || spec.sampleLineCount < 1) {
          fail(id, `typography.${key}.sampleLineCount must be a positive integer`);
        }
        if (!Number.isFinite(spec.detectionScore) || spec.detectionScore < 0 || spec.detectionScore > 1) {
          fail(id, `typography.${key}.detectionScore must be between 0 and 1`);
        }
        const shouldBeLive = spec.fitScore >= MAGIC_LAYER_MIN_FONT_FIT
          && spec.detectionScore >= MAGIC_LAYER_MIN_REGION_CONFIDENCE;
        const faceKey = `${spec.fontId}:${spec.weight}:${spec.italic ? "italic" : "normal"}`;
        if (shouldBeLive && !spec.fontFile && !excludedFaces.has(faceKey)) {
          fail(id, `typography.${key} passed the live gates but has no self-hosted fontFile`);
        }
        if (spec.fontFile) {
          const face = fontFaces.get(spec.fontFile);
          const fontPath = publicPath(spec.fontFile);
          if (!face) fail(id, `typography.${key}.fontFile is missing from the font manifest`);
          if (!fontPath || !existsSync(fontPath)) {
            fail(id, `typography.${key}.fontFile does not exist: ${spec.fontFile}`);
          } else if (face?.sha256 !== sha256(fontPath)) {
            fail(id, `typography.${key}.fontFile hash does not match the manifest`);
          }
          if (face && (face.fontId !== spec.fontId || face.weight !== spec.weight || face.italic !== spec.italic)) {
            fail(id, `typography.${key}.fontFile does not match its declared face`);
          }
        }
      }
    }
  }
  typographyTextInputTotal += (text ?? []).length;
}

if (templates.length >= diversityMinCount) {
  if (intentCounts.size < minDistinctIntents) fail("DIVERSITY", `only ${intentCounts.size} distinct primary intents; need at least ${minDistinctIntents}`);
  for (const [intent, count] of intentCounts) {
    if (count > Math.ceil(templates.length * maxIntentShare)) fail("DIVERSITY", `${intent} dominates the gallery (${count}/${templates.length})`);
  }
}

// Only assert typography coverage once the offline build has actually run
// against this gallery at least once — a from-scratch checkout with no
// typeSpecs yet (typography omitted everywhere) is a valid, un-built state,
// not a regression, and shouldn't fail this gate.
const typographyCoverage = typographyTextInputTotal > 0 ? typographyEntries / typographyTextInputTotal : 0;
if (typographyCoverage < minTypographyCoverage) {
  fail(
    "TYPOGRAPHY",
    `coverage regressed to ${(typographyCoverage * 100).toFixed(1)}% (${typographyEntries}/${typographyTextInputTotal}); minimum is ${(minTypographyCoverage * 100).toFixed(0)}%`,
  );
}

if (failures.length) {
  console.error(`AdStudio template gate FAILED (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

const typographyNote = typographyEntries > 0
  ? `, typography ${typographyEntries}/${typographyTextInputTotal} regions (${(typographyCoverage * 100).toFixed(1)}%, ${typographyLowFitEntries} below fitScore ${lowFitScoreThreshold})`
  : "";
console.log(
  `AdStudio template gate passed - ${templates.length} template(s), ${intentCounts.size} distinct primary intent(s)${typographyNote}; deterministic editing ${deterministicEditingCounts.ready} ready, ${deterministicEditingCounts.partial} partial, ${deterministicEditingCounts.legacy} legacy.`,
);
