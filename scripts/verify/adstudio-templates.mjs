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
const qualityLocksPath = join(galleryDir, "quality-locks.json");
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
const qualityRubricVersion = "adstudio-subject-invariant-clone-v1";
const minAdSystemLikeness = 9.5;
const minStandaloneAdQuality = 9;
const failures = [];
const warnings = [];
const templates = [];
const referencedPublicSamples = new Set();
const referencedEvidence = new Set();
const referencedThumbnails = new Set();

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
const deterministicEditingReady = new Map();

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

function filesBelow(directory, prefix = "") {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? filesBelow(join(directory, entry.name), relative) : [relative];
  });
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

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isHash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isIsoTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    && Number.isFinite(Date.parse(value));
}

function hasExactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function templateContractHash(template) {
  const { qualityLock: _qualityLock, ...contract } = template;
  return createHash("sha256").update(canonicalJson(contract)).digest("hex");
}

function verifyQualityScore(id, name, value, minimum) {
  if (!Number.isFinite(value) || value < minimum || value > 10) {
    fail(id, `${name} must be between ${minimum} and 10`);
    return false;
  }
  return true;
}

function verifyQualityReview({ id, review, template, stage, copy, assetKeys, outputHash, requestHash }) {
  const before = failures.length;
  if (!isRecord(review) || review.schemaVersion !== 1) {
    fail(id, `${stage}.review must use schemaVersion 1`);
    return false;
  }
  if (
    review.rubricVersion !== qualityRubricVersion
    || review.templateId !== template.id
    || review.requestHash !== requestHash
    || review.candidateHash !== outputHash
  ) {
    fail(id, `${stage}.review is not bound to the rubric, template, request, and output`);
  }
  if (!review.reviewer?.provider?.trim() || !review.reviewer?.model?.trim()) {
    fail(id, `${stage}.review must identify its image-model reviewer`);
  }
  verifyQualityScore(id, `${stage}.review.adSystemLikenessScore`, review.adSystemLikenessScore, minAdSystemLikeness);
  verifyQualityScore(id, `${stage}.review.standaloneAdQualityScore`, review.standaloneAdQualityScore, minStandaloneAdQuality);
  if (review.excludedContentInfluencedScore !== false) {
    fail(id, `${stage}.review must exclude replaceable subject matter from likeness scoring`);
  }

  const expectedCopy = Object.entries(copy);
  if (!Array.isArray(review.copyChecks) || review.copyChecks.length !== expectedCopy.length) {
    fail(id, `${stage}.review must contain one exact copy check per declared text input`);
  } else {
    const checks = new Map();
    for (const check of review.copyChecks) {
      if (!check?.key || checks.has(check.key)) fail(id, `${stage}.review has duplicate or invalid copy checks`);
      else checks.set(check.key, check);
    }
    for (const [key, expected] of expectedCopy) {
      const check = checks.get(key);
      if (!check || check.expected !== expected || check.observed !== expected || check.exact !== true) {
        fail(id, `${stage}.review copy check failed for ${key}`);
      }
    }
  }

  if (!Array.isArray(review.assetChecks) || review.assetChecks.length !== assetKeys.size) {
    fail(id, `${stage}.review must contain one passing asset check per declared image input`);
  } else {
    const checks = new Map();
    for (const check of review.assetChecks) {
      if (!check?.key || checks.has(check.key)) fail(id, `${stage}.review has duplicate or invalid asset checks`);
      else checks.set(check.key, check);
    }
    for (const key of assetKeys) {
      const check = checks.get(key);
      if (!check || check.used !== true || check.faithful !== true || typeof check.notes !== "string") {
        fail(id, `${stage}.review asset check failed for ${key}`);
      }
    }
  }
  if (!Array.isArray(review.identityLeakage) || review.identityLeakage.length !== 0) {
    fail(id, `${stage}.review contains source identity leakage`);
  }
  if (!Array.isArray(review.defects) || review.defects.length !== 0) {
    fail(id, `${stage}.review contains rendering defects`);
  }
  if (!review.includedRationale?.trim() || !review.qualityRationale?.trim() || typeof review.suggestedCorrection !== "string") {
    fail(id, `${stage}.review rationale fields are incomplete`);
  }
  if (!isIsoTimestamp(review.reviewedAt)) fail(id, `${stage}.review reviewedAt must be an ISO-8601 timestamp`);
  return failures.length === before;
}

function verifyQualityStage({ id, value, template, stage, expectedReferenceRole, expectedReferenceHash }) {
  const before = failures.length;
  const expectedKeys = [
    "stage",
    "requestHash",
    "referenceHash",
    "references",
    "copy",
    "outputHash",
    "executionTransport",
    "reviewedAt",
    "review",
  ];
  if (!hasExactKeys(value, expectedKeys)) {
    fail(id, `${stage} evidence has an invalid schema`);
    return null;
  }
  if (value.stage !== stage) fail(id, `${stage} evidence has the wrong stage`);
  if (!isHash(value.requestHash)) fail(id, `${stage}.requestHash must be a SHA-256 hash`);
  if (value.referenceHash !== expectedReferenceHash) fail(id, `${stage}.referenceHash is not bound to its design reference`);
  if (!isHash(value.outputHash)) fail(id, `${stage}.outputHash must be a SHA-256 hash`);
  if (!value.executionTransport?.trim()) fail(id, `${stage}.executionTransport is required`);
  if (!isIsoTimestamp(value.reviewedAt)) fail(id, `${stage}.reviewedAt must be an ISO-8601 timestamp`);

  const expectedTextKeys = new Set(template.inputs.text.map((field) => field.key));
  if (!isRecord(value.copy) || Object.keys(value.copy).length !== expectedTextKeys.size) {
    fail(id, `${stage}.copy must bind every declared text input exactly once`);
  } else {
    for (const field of template.inputs.text) {
      const copy = value.copy[field.key];
      if (typeof copy !== "string" || !copy.trim() || copy.length > field.maxLength) {
        fail(id, `${stage}.copy.${field.key} is missing or exceeds its manifest limit`);
      }
    }
    for (const key of Object.keys(value.copy)) {
      if (!expectedTextKeys.has(key)) fail(id, `${stage}.copy.${key} is not a declared text input`);
    }
  }

  const expectedAssetKeys = new Set(template.inputs.images.map((field) => field.key));
  const assetHashes = new Map();
  if (!Array.isArray(value.references) || value.references.length !== expectedAssetKeys.size + 1) {
    fail(id, `${stage}.references must contain one design reference and every declared image asset`);
  } else {
    const referenceKeys = new Set();
    value.references.forEach((reference, index) => {
      if (!hasExactKeys(reference, ["index", "key", "role", "contentHash"])) {
        fail(id, `${stage}.references[${index}] has an invalid schema`);
        return;
      }
      if (reference.index !== index + 1) fail(id, `${stage}.references must preserve contractual order`);
      if (!reference.key?.trim() || referenceKeys.has(reference.key)) fail(id, `${stage}.references contain duplicate keys`);
      referenceKeys.add(reference.key);
      if (!isHash(reference.contentHash)) fail(id, `${stage}.references[${index}].contentHash must be a SHA-256 hash`);
      if (index === 0) {
        if (reference.role !== expectedReferenceRole || reference.contentHash !== expectedReferenceHash) {
          fail(id, `${stage}.references[0] is not the required design reference`);
        }
      } else {
        if (reference.role !== "replacement_asset" || !expectedAssetKeys.has(reference.key)) {
          fail(id, `${stage}.references[${index}] is not a declared replacement asset`);
        } else {
          assetHashes.set(reference.key, reference.contentHash);
        }
      }
    });
    for (const key of expectedAssetKeys) {
      if (!assetHashes.has(key)) fail(id, `${stage}.references are missing replacement asset ${key}`);
    }
  }

  verifyQualityReview({
    id,
    review: value.review,
    template,
    stage,
    copy: isRecord(value.copy) ? value.copy : {},
    assetKeys: expectedAssetKeys,
    outputHash: value.outputHash,
    requestHash: value.requestHash,
  });
  if (value.reviewedAt !== value.review?.reviewedAt) fail(id, `${stage}.reviewedAt does not match its review`);
  return failures.length === before ? { assetHashes, copy: value.copy, review: value.review, outputHash: value.outputHash } : null;
}

function verifyQualityEvidence({ id, evidence, lock, template, templateHash }) {
  const before = failures.length;
  if (!hasExactKeys(evidence, [
    "schemaVersion",
    "templateId",
    "templateHash",
    "sampleHash",
    "rubricVersion",
    "thresholds",
    "qualifiedAt",
    "sample",
    "customerFixture",
  ])) {
    fail(id, "quality evidence v2 has an invalid schema");
    return false;
  }
  if (evidence.schemaVersion !== 2 || evidence.templateId !== id) fail(id, "quality evidence must use schemaVersion 2 and match the template id");
  if (evidence.templateHash !== templateHash || evidence.templateHash !== lock.templateHash) {
    fail(id, "quality evidence templateHash does not match the manifest and lock");
  }
  if (evidence.sampleHash !== template.sample.contentHash || evidence.sampleHash !== lock.sampleHash) {
    fail(id, "quality evidence sampleHash does not match the manifest and lock");
  }
  if (evidence.rubricVersion !== qualityRubricVersion) fail(id, "quality evidence rubricVersion is invalid");
  if (!hasExactKeys(evidence.thresholds, ["adSystemLikeness", "standaloneAdQuality"])
    || evidence.thresholds.adSystemLikeness !== minAdSystemLikeness
    || evidence.thresholds.standaloneAdQuality !== minStandaloneAdQuality) {
    fail(id, "quality evidence thresholds do not match the release thresholds");
  }
  if (!isIsoTimestamp(evidence.qualifiedAt) || evidence.qualifiedAt !== lock.qualifiedAt) {
    fail(id, "quality evidence qualifiedAt does not match the lock");
  }

  const sample = verifyQualityStage({
    id,
    value: evidence.sample,
    template,
    stage: "gallery_sample",
    expectedReferenceRole: "source",
    expectedReferenceHash: template.sourceAd.contentHash,
  });
  const customer = verifyQualityStage({
    id,
    value: evidence.customerFixture,
    template,
    stage: "customer_fixture",
    expectedReferenceRole: "approved_sample",
    expectedReferenceHash: template.sample.contentHash,
  });
  if (sample) {
    if (sample.outputHash !== template.sample.contentHash) fail(id, "gallery_sample output is not the approved manifest sample");
    if (sample.review.adSystemLikenessScore !== lock.sampleLikeness || sample.review.standaloneAdQualityScore !== lock.sampleQuality) {
      fail(id, "gallery_sample scores do not match the quality lock");
    }
  }
  if (customer) {
    if (customer.outputHash === template.sample.contentHash) fail(id, "customer_fixture output must differ from the approved sample");
    if (customer.review.adSystemLikenessScore !== lock.customerFixtureLikeness
      || customer.review.standaloneAdQualityScore !== lock.customerFixtureQuality) {
      fail(id, "customer_fixture scores do not match the quality lock");
    }
  }
  if (sample && customer) {
    if (canonicalJson(sample.copy) === canonicalJson(customer.copy)) {
      fail(id, "customer_fixture copy must differ from the gallery sample copy");
    }
    for (const [key, sampleHash] of sample.assetHashes) {
      if (customer.assetHashes.get(key) === sampleHash) {
        fail(id, `customer_fixture must use a distinct ${key} asset`);
      }
    }
  }
  return failures.length === before;
}

function verifyQualityLocks() {
  if (!existsSync(qualityLocksPath)) {
    warnings.push("QUALITY_LOCKS: no release quality-lock index; built-in templates will remain unavailable");
    return 0;
  }
  let index;
  try {
    index = JSON.parse(readFileSync(qualityLocksPath, "utf8"));
  } catch (error) {
    fail("QUALITY_LOCKS", `invalid JSON: ${error.message}`);
    return 0;
  }
  if (!hasExactKeys(index, ["schemaVersion", "templates"]) || index.schemaVersion !== 1 || !isRecord(index.templates)) {
    fail("QUALITY_LOCKS", "index must have schemaVersion 1 and a templates object");
    return 0;
  }
  const entries = Object.entries(index.templates);
  if (entries.length === 0) {
    fail("QUALITY_LOCKS", "release index must contain at least one valid template lock");
    return 0;
  }

  const templatesById = new Map(templates.map((entry) => [entry.template.id, entry]));
  let validLocks = 0;
  for (const [id, lock] of entries) {
    const before = failures.length;
    const entry = templatesById.get(id);
    if (!entry) {
      fail(id, "quality lock does not match a gallery manifest");
      continue;
    }
    if (!hasExactKeys(lock, [
      "templateHash",
      "templateContract",
      "sampleHash",
      "evidenceHash",
      "sampleLikeness",
      "sampleQuality",
      "customerFixtureLikeness",
      "customerFixtureQuality",
      "qualifiedAt",
    ])) {
      fail(id, "quality lock has an invalid schema");
      continue;
    }
    if (deterministicEditingReady.get(id) !== true) {
      fail(id, "quality-locked templates must have complete deterministic editing evidence");
    }
    const templateHash = templateContractHash(entry.template);
    if (entry.template.qualityLock?.templateHash !== templateHash) {
      fail(id, "manifest qualityLock.templateHash does not match its contract");
    }
    if (lock.templateHash !== templateHash) fail(id, "quality lock templateHash does not match the manifest file");
    const { qualityLock: _qualityLock, ...templateContract } = entry.template;
    if (lock.templateContract !== canonicalJson(templateContract)) {
      fail(id, "quality lock templateContract does not match the current manifest");
    }
    if (lock.sampleHash !== entry.template.sample.contentHash) fail(id, "quality lock sampleHash does not match the approved sample");
    if (!isHash(lock.evidenceHash)) fail(id, "quality lock evidenceHash must be a SHA-256 hash");
    verifyQualityScore(id, "quality lock sampleLikeness", lock.sampleLikeness, minAdSystemLikeness);
    verifyQualityScore(id, "quality lock sampleQuality", lock.sampleQuality, minStandaloneAdQuality);
    verifyQualityScore(id, "quality lock customerFixtureLikeness", lock.customerFixtureLikeness, minAdSystemLikeness);
    verifyQualityScore(id, "quality lock customerFixtureQuality", lock.customerFixtureQuality, minStandaloneAdQuality);
    if (!isIsoTimestamp(lock.qualifiedAt)) fail(id, "quality lock qualifiedAt must be an ISO-8601 timestamp");

    const evidencePath = join(galleryDir, "evidence", `${id}.json`);
    if (!existsSync(evidencePath)) {
      fail(id, `quality evidence not found: evidence/${id}.json`);
    } else if (sha256(evidencePath) !== lock.evidenceHash) {
      fail(id, "quality lock evidenceHash does not match the evidence file");
    } else {
      try {
        const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
        verifyQualityEvidence({ id, evidence, lock, template: entry.template, templateHash });
      } catch (error) {
        fail(id, `quality evidence is invalid JSON: ${error.message}`);
      }
    }
    if (failures.length === before) validLocks += 1;
  }
  if (validLocks === 0) fail("QUALITY_LOCKS", "release index contains no valid template locks");
  return validLocks;
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
    deterministicEditingReady.set(id, false);
    return;
  }
  if (!(editing.status === "partial" || editing.status === "ready")) {
    deterministicEditingCounts.partial += 1;
    deterministicEditingReady.set(id, false);
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
    deterministicEditingReady.set(id, false);
    for (const [key, box] of Object.entries(editing.imageBoxes ?? {})) {
      if (imageKeys.has(key) && !isNormalizedBox(box)) {
        fail(id, `deterministic editing: image input ${key} has no valid editor hitbox`);
      }
    }
    return;
  }

  if (issues.length) {
    deterministicEditingCounts.partial += 1;
    deterministicEditingReady.set(id, false);
    for (const issue of issues) fail(id, `deterministic editing: ${issue}`);
  } else {
    deterministicEditingCounts.ready += 1;
    deterministicEditingReady.set(id, true);
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
  }

  const sample = template.sample;
  if (sample?.generatedBy !== "reference_clone") fail(id, "sample.generatedBy must be reference_clone");
  if (!sample?.imageSrc || sample.thumbnailSrc !== sample.imageSrc || !sample.alt?.trim()) {
    fail(id, "sample image, matching thumbnail, and alt text are required");
  }
  if (typeof sample?.imageSrc === "string") referencedPublicSamples.add(sample.imageSrc);
  if (/^[a-f0-9]{64}$/iu.test(sample?.contentHash ?? "")) {
    for (const profile of ["320", "640", "preview"]) {
      referencedThumbnails.add(`meta/${sample.contentHash.toLowerCase()}-${profile}.webp`);
    }
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
  const leadForm = template.meta?.leadForm;
  if (!leadForm?.headline?.trim()) fail(id, "meta.leadForm.headline is required");
  const questions = Array.isArray(leadForm?.questions) ? leadForm.questions : [];
  if (!questions.some((question) => typeof question === "string" && question.trim())) fail(id, "meta.leadForm needs at least one non-empty question");
  if (questions.length > 5) fail(id, "meta.leadForm supports at most 5 questions");
  const questionLabels = questions
    .filter((question) => typeof question === "string")
    .map((question) => question.trim().toLowerCase())
    .filter(Boolean);
  if (new Set(questionLabels).size !== questionLabels.length) fail(id, "meta.leadForm question labels must be unique");
  if (!leadForm?.thankYouScreen?.title?.trim() || !leadForm?.thankYouScreen?.body?.trim()) {
    fail(id, "meta.leadForm thank-you title and body are required");
  }
  for (const key of ["ad_type", "primary_intent", "property_or_agent_focus"]) {
    if (!template.classification?.[key]?.trim()) fail(id, `classification.${key} is required`);
  }
  const intent = template.classification?.primary_intent?.trim();
  if (intent && intent !== "other") intentCounts.set(intent, (intentCounts.get(intent) ?? 0) + 1);

  // Offline typography evidence (scripts/build/font-corpus/adstudio-type-specs.mjs
  // output). Optional per-template and per-region — the offline build cannot
  // always find or measure a region — but whatever is present must be well-formed and
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

  // deterministicOnly consistency gate. A template marked deterministicOnly: true
  // promises every text input is fully deterministic — each must have a matching
  // typography entry with a self-hosted fontFile and confidence scores that meet
  // the live-gate thresholds. This is stricter than the per-template typography
  // checks above, which allow partial coverage; deterministicOnly allows none.
  if (template.deterministicOnly === true) {
    for (const field of text ?? []) {
      const spec = template.typography?.[field.key];
      if (!spec) {
        fail(id, `deterministicOnly: text input "${field.key}" has no matching typography entry`);
        continue;
      }
      if (!spec.fontFile?.trim()) {
        fail(id, `deterministicOnly: text input "${field.key}" typography entry has no fontFile`);
      }
      if (!Number.isFinite(spec.fitScore) || spec.fitScore < MAGIC_LAYER_MIN_FONT_FIT) {
        fail(id, `deterministicOnly: text input "${field.key}" fitScore ${spec.fitScore} is below ${MAGIC_LAYER_MIN_FONT_FIT}`);
      }
      if (!Number.isFinite(spec.detectionScore) || spec.detectionScore < MAGIC_LAYER_MIN_REGION_CONFIDENCE) {
        fail(id, `deterministicOnly: text input "${field.key}" detectionScore ${spec.detectionScore} is below ${MAGIC_LAYER_MIN_REGION_CONFIDENCE}`);
      }
    }
  }

  // Readiness evidence gate (warning, not hard fail). Evidence files are
  // aspirational for older templates; their absence is noted but not blocking.
  const evidencePath = join(galleryDir, "evidence", `${template.id}.json`);
  if (!existsSync(evidencePath)) {
    warnings.push(`${id}: no readiness evidence file at evidence/${template.id}.json`);
  }
}

const validQualityLocks = verifyQualityLocks();

for (const id of ids) referencedEvidence.add(`${id}.json`);

const sampleDirectory = join(publicDir, "adstudio-samples", "meta");
if (existsSync(sampleDirectory)) {
  for (const filename of readdirSync(sampleDirectory)) {
    const publicSample = `/adstudio-samples/meta/${filename}`;
    if (!referencedPublicSamples.has(publicSample)) fail("ORPHAN_SAMPLE", `${publicSample} is not referenced by a released template`);
  }
}

const evidenceDirectory = join(galleryDir, "evidence");
for (const filename of filesBelow(evidenceDirectory)) {
  if (!referencedEvidence.has(filename)) fail("ORPHAN_EVIDENCE", `evidence/${filename} does not belong to a released template`);
}

const thumbnailDirectory = join(publicDir, "adstudio-thumbnails");
if (existsSync(thumbnailDirectory)) {
  for (const filename of filesBelow(thumbnailDirectory)) {
    if (!referencedThumbnails.has(filename)) fail("ORPHAN_THUMBNAIL", `/adstudio-thumbnails/${filename} does not belong to a released template`);
  }
  for (const filename of referencedThumbnails) {
    if (!existsSync(join(thumbnailDirectory, filename))) fail("MISSING_THUMBNAIL", `/adstudio-thumbnails/${filename} is required by a released template`);
  }
} else if (!process.env.ADSTUDIO_PUBLIC_DIR) {
  fail("MISSING_THUMBNAIL", "/adstudio-thumbnails is required for the installed gallery");
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

// derivedFrom / validFor contract (documentation, not enforced here):
// Text layers use `derivedFrom` to track which render the plate was built from,
// and `validFor` to limit which renders the plate can be applied to. This is
// enforced at runtime in the editor (see src/lib/adstudio/text-layer-state.ts
// and generate-template-campaign.ts). The verification script does not check
// these fields because they are runtime canvas state, not template JSON fields.

if (warnings.length) {
  for (const warning of warnings) console.warn(`  warning: ${warning}`);
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
  `AdStudio template gate passed - ${templates.length} template(s), ${validQualityLocks} quality locked, ${intentCounts.size} distinct primary intent(s)${typographyNote}; deterministic editing ${deterministicEditingCounts.ready} ready, ${deterministicEditingCounts.partial} partial, ${deterministicEditingCounts.legacy} legacy.`,
);
