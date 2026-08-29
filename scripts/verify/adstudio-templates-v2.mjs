#!/usr/bin/env node

// AdStudio v2 template gate — §10.1 of the rebuild plan. Runs beside the v1
// gate during transition; Track H removes the v1 one. With zero templates
// every check passes vacuously; the moment a template.json lands the
// discipline bites.
//
// Lifecycle-aware: `draft` templates are schema/contract-checked but skip
// asset + story + ready evidence requirements (their plates land when
// decompose runs); `qa` requires assets; `ready` requires everything.
//
//   1. schema   — parses templateDocV2Schema; id == dirname; no dup ids;
//                 no duplicate source ad across v1 + v2 combined.
//   2. assets   — plate/patch/sample exist, sha256 match, dims match,
//                 sample hash != source hash, nothing orphaned (qa+ready).
//   3. fonts    — every fonts[] entry in the manifest with sha + license.
//   4. contract — keys unique, no orphans between inputs and layers.
//   5. safe zones (qa+ready) — no text/slot content in top 250 / bottom 340
//                 of story layouts; Reels 672 warning.
//   6. ready evidence — authenticated curation + human review, exact native
//                 fidelity, complete replayable stress matrix, safe public
//                 sample, and minSourcePx on every slot.
//   7. publish block — CTA in lead subset, copy <=5 within 125/40/90,
//                 lead-form questions, placements cover formatRouting,
//                 creativeFeatures covers the full known list.
//   8. diversity — >=5 distinct non-other intents, <=50% per intent,
//                 layout-skeleton signature collision <= 3.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { fidelityTemplateHash, nativeSurfaceFor, runNativeSurfaceFidelity, runStressMatrix } from "../../src/lib/adstudio/v2/fidelity-stress.ts";
import { hashCanonicalJson } from "../../src/lib/adstudio/v2/template-hash.ts";
import { hasNonTrivialRestyle, normalizeCanonicalJson, templateDocV2Schema } from "../../src/lib/adstudio/v2/template-doc.ts";
import { diversityFailures } from "./adstudio-diversity.mjs";

const root = process.cwd();
const galleryDir = resolve(process.env.ADSTUDIO_GALLERY_V2_DIR ?? join(root, "src", "lib", "adstudio", "template-gallery-v2"));
const v1GalleryDir = resolve(join(root, "src", "lib", "adstudio", "template-gallery"));
const publicDir = resolve(process.env.ADSTUDIO_PUBLIC_DIR ?? join(root, "public"));
const v2PublicDir = join(publicDir, "adstudio-templates");
const privateAssetsDir = resolve(
  process.env.ADSTUDIO_PRIVATE_V2 ?? join(root, "src", "lib", "adstudio", "template-assets-v2"),
);
const fontManifestPath = join(publicDir, "fonts", "adstudio", "manifest.json");

const failures = [];
const warnings = [];
function fail(message) {
  failures.push(message);
}

function privateAssetPath(docId, src) {
  const match = /^\/adstudio-templates\/([a-z0-9-]+)\/((?:plate|patch)-[A-Za-z0-9._-]+)$/.exec(src);
  if (!match || match[1] !== docId) {
    fail(`${docId}: private template asset has an invalid logical ref: ${src}`);
    return null;
  }
  return { path: join(privateAssetsDir, match[1], match[2]), relative: `${match[1]}/${match[2]}` };
}

const fontManifest = existsSync(fontManifestPath)
  ? JSON.parse(readFileSync(fontManifestPath, "utf8"))
  : { faces: [] };
// The doc's font.file is authoritative (one face per weight/italic); a fontId
// alone is ambiguous when a family ships several weights.
const fontByFile = new Map((fontManifest.faces ?? []).map((face) => [face.file, face]));

// Mirrors META_CREATIVE_FEATURE_KEYS (meta-execution.ts) — lockstep by test.
const KNOWN_CREATIVE_FEATURES = [
  "adapt_to_placement", "image_touchups", "image_templates", "inline_comment",
  "enhance_cta", "text_optimizations", "image_animation", "image_background_gen",
  "video_auto_crop", "translate_voiceover", "text_translation", "media_type_automation",
  "product_extensions",
];
const LEAD_CTA_SUBSET = new Set(["LEARN_MORE", "SIGN_UP", "GET_QUOTE", "APPLY_NOW", "DOWNLOAD", "SUBSCRIBE"]);
const STORY_TOP_PX = 250;
const STORY_BOTTOM_PX = 340;
const RESIDUAL_THRESHOLD = 0.14;
const OPERATOR_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OPERATOR_USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STRESS_SCENARIOS = ["longest-copy", "one-character-copy", "minimum-resolution", "all-portrait", "all-landscape"];
const STRESS_FORMATS = ["4:5", "9:16"];

// ─── load docs ──────────────────────────────────────────────────────────────

const docs = [];
const templateEvidenceHashes = new Map();
if (existsSync(galleryDir)) {
  for (const entry of readdirSync(galleryDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(galleryDir, entry.name, "template.json");
    if (!existsSync(path)) {
      fail(`${entry.name}: missing template.json`);
      continue;
    }
    const templateBytes = readFileSync(path);
    const parsed = templateDocV2Schema.safeParse(JSON.parse(templateBytes.toString("utf8")));
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        fail(`${entry.name}: schema ${issue.path.join(".")}: ${issue.message}`);
      }
      continue;
    }
    if (parsed.data.id !== entry.name) {
      fail(`${entry.name}: doc id "${parsed.data.id}" does not match its directory name`);
    }
    const evidencePath = join(galleryDir, entry.name, "evidence.json");
    const doc = parsed.data;
    // Evidence binds to the semantic template document, not checkout bytes.
    // Canonical JSON keeps the binding identical across LF/CRLF checkouts while
    // still changing for every meaningful template change.
    templateEvidenceHashes.set(doc.id, hashCanonicalJson(parsed.data));
    doc.__textBoxes = existsSync(evidencePath)
      ? (JSON.parse(readFileSync(evidencePath, "utf8")).textBoxes ?? {})
      : {};
    docs.push(doc);
  }
}

const seenIds = new Set();
const referencedPrivateFiles = new Set(["__smoke__/plate-feed.webp"]);
for (const doc of docs) {
  if (seenIds.has(doc.id)) fail(`duplicate v2 template id ${doc.id}`);
  seenIds.add(doc.id);
}

// One source ad, at most one INDEPENDENT template, across BOTH generations —
// with two carve-outs: (a) the transition carve-out (a v2 doc is the
// SUCCESSOR of the same-id v1 doc, not a second template from that source),
// and (b) DECLARED PACK VARIANTS: when the job brief requests a pack of N
// templates, the builder emits N docs that share the source hash but declare
// the same provenance.packId with distinct provenance.packVariantIndex. Those
// are one authorised pack, not accidental duplicates; two independent
// templates from one source still fail.
const sourceHashes = new Map();
if (existsSync(v1GalleryDir)) {
  for (const entry of readdirSync(v1GalleryDir, { withFileTypes: true })) {
    const path = entry.isDirectory()
      ? join(v1GalleryDir, entry.name, "template.json")
      : join(v1GalleryDir, entry.name);
    if (!entry.name.endsWith(".json") || !existsSync(path)) continue;
    try {
      const v1 = JSON.parse(readFileSync(path, "utf8"));
      const v1Id = v1.id ?? entry.name.replace(/\.json$/, "");
      if (seenIds.has(v1Id)) continue; // v2 successor replaces it
      if (v1.sourceAd?.contentHash) sourceHashes.set(v1.sourceAd.contentHash, { kind: "v1", id: v1Id, packId: null });
    } catch {
      // not a doc; not this gate's business
    }
  }
}
for (const doc of docs) {
  const owner = sourceHashes.get(doc.provenance.sourceAd.contentHash);
  const packId = doc.provenance?.packId ?? null;
  const packVariantIndex = doc.provenance?.packVariantIndex ?? null;
  const isDeclaredPackVariant = Boolean(
    owner
    && owner.kind === "v2"
    && owner.packId
    && packId === owner.packId
    && typeof packVariantIndex === "number"
  );
  if (owner && !isDeclaredPackVariant) {
    fail(`${doc.id}: source ad already used by ${owner.kind}:${owner.id} — one source, one template (declare provenance.packId + packVariantIndex to author a multi-variant pack)`);
  }
  sourceHashes.set(doc.provenance.sourceAd.contentHash, { kind: "v2", id: doc.id, packId });
}

// Every declared pack must have complete, unique variant indices (1..N), so a
// pack cannot smuggle two docs as the same variant or a half-declared pack.
const packIndices = new Map();
for (const doc of docs) {
  const packId = doc.provenance?.packId;
  if (!packId) continue;
  const index = doc.provenance?.packVariantIndex;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 1) {
    fail(`${doc.id}: pack variant ${packId} needs a positive integer provenance.packVariantIndex`);
    continue;
  }
  const indices = packIndices.get(packId) ?? new Set();
  if (indices.has(index)) fail(`${doc.id}: pack ${packId} declares duplicate packVariantIndex ${index}`);
  indices.add(index);
  packIndices.set(packId, indices);
}
for (const [packId, indices] of packIndices) {
  const maxIndex = Math.max(...indices);
  if (indices.size !== maxIndex) {
    fail(`pack ${packId} declares non-contiguous variant indices ${[...indices].sort((a, b) => a - b).join(",")}`);
  }
}

// ─── helpers ───────────────────────────────────────────────────────────────

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readEvidence(id) {
  const path = join(galleryDir, id, "evidence.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function canonicalEqual(left, right) {
  return normalizeCanonicalJson(left) === normalizeCanonicalJson(right);
}

function isIsoTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function expectedNativeTextLayers(doc) {
  const nativeSurface = nativeSurfaceFor(doc);
  const layout = doc.formats[nativeSurface];
  const baked = new Set(doc.exactness.bakedTextKeys);
  return {
    nativeSurface,
    layers: layout.layers.filter((layer) => layer.type === "text" && !baked.has(layer.inputKey)),
  };
}

function hasExactlyKeys(record, keys) {
  const actual = Object.keys(record ?? {}).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function sourcePathFor(doc) {
  const file = doc.provenance.sourceAd.file;
  if (!file) return null;
  const sourceRoot = resolve(root, "meta_ad_candidates");
  const path = resolve(sourceRoot, file);
  return path.startsWith(`${sourceRoot}/`) && existsSync(path) ? path : null;
}

function validateSubjectInvarianceBinding(doc, evidence, templateEvidenceHash) {
  const subjectInvariance = evidence?.subjectInvariance;
  if (!subjectInvariance) return;
  const binding = subjectInvariance.binding;
  if (!binding) {
    fail(`${doc.id}: subject-invariance evidence lacks a deterministic binding`);
    return;
  }
  if (binding.templateSha256 !== templateEvidenceHash) fail(`${doc.id}: subject-invariance evidence template hash is stale`);
  if (binding.sourceSha256 !== doc.provenance.sourceAd.contentHash) fail(`${doc.id}: subject-invariance evidence source hash is stale`);
  if (binding.sampleSha256 !== doc.provenance.sample.contentHash) fail(`${doc.id}: subject-invariance evidence sample hash is stale`);
  if (binding.gatePassed !== true) fail(`${doc.id}: subject-invariance deterministic gate did not pass`);
  if (!Array.isArray(binding.sourcePixelIsolation) || binding.sourcePixelIsolation.some((asset) => asset.hardFail !== false)) {
    fail(`${doc.id}: subject-invariance evidence reports static source leakage`);
  }
  if (!Array.isArray(binding.fixtureDifferenceEvidence)
    || binding.fixtureDifferenceEvidence.length === 0
    || binding.fixtureDifferenceEvidence.some((entry) => entry.changedOutsideBoxes !== 0 || entry.outsideDependencyPassed !== true)) {
    fail(`${doc.id}: subject-invariance evidence reports changes outside declared dependencies`);
  }
  const declaredAssets = Object.fromEntries(Object.entries(doc.formats).map(([format, layout]) => [
    format,
    [
      { id: "plate", sha256: layout.plate.sha256 },
      ...layout.layers.filter((layer) => layer.type === "overlay_patch").map((layer) => ({ id: layer.id, sha256: layer.sha256 })),
    ],
  ]));
  if (!canonicalEqual(binding.staticAssets, declaredAssets)) fail(`${doc.id}: subject-invariance evidence static asset hashes are stale`);

  const visualReview = subjectInvariance.visualReview;
  if (visualReview) {
    if (visualReview.templateSha256 !== binding.templateSha256) fail(`${doc.id}: subject-invariance visual review template hash is stale`);
    if (!/^[0-9a-f]{64}$/i.test(visualReview.customerFeedSha256 ?? "")) fail(`${doc.id}: subject-invariance visual review lacks a customer feed hash`);
    if (visualReview.reviewerStatus !== "complete") fail(`${doc.id}: subject-invariance visual review is incomplete`);
    const scores = visualReview.scores;
    if (![scores?.primaryAdSystemLikeness, scores?.strictAdSystemLikeness, scores?.standaloneAdQuality]
      .every((score) => typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 10)) {
      fail(`${doc.id}: subject-invariance visual review scores are invalid`);
    }
    if (visualReview.accepted === true && (
      typeof visualReview.likenessThreshold !== "number"
      || scores?.primaryAdSystemLikeness <= visualReview.likenessThreshold
      || scores?.strictAdSystemLikeness <= visualReview.likenessThreshold
    )) {
      fail(`${doc.id}: accepted subject-invariance visual review does not clear its likeness threshold`);
    }
  }
}

function readPngLikeDimensions(path) {
  const bytes = readFileSync(path);
  if (bytes.readUInt32BE(0) === 0x89504e47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  // WebP: RIFF....WEBP with VP8X chunk carrying 24-bit dims - 1.
  if (bytes.toString("ascii", 8, 12) === "WEBP" && bytes.toString("ascii", 12, 16) === "VP8X") {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    };
  }
  // WebP lossless: RIFF....WEBP + VP8L chunk (no VP8X). The VP8L header packs
  // 14-bit (width-1) and 14-bit (height-1) after a 0x2f signature byte.
  if (bytes.toString("ascii", 8, 12) === "WEBP" && bytes.toString("ascii", 12, 16) === "VP8L") {
    if (bytes.length < 22 || bytes[16] !== 0x2f) return null;
    const widthMinus1 = bytes[17] | ((bytes[18] & 0x3f) << 8);
    const heightMinus1 = (bytes[18] >> 6) | (bytes[19] << 2) | ((bytes[20] & 0x0f) << 10);
    if (widthMinus1 < 0 || heightMinus1 < 0) return null;
    return { width: widthMinus1 + 1, height: heightMinus1 + 1 };
  }
  return null;
}

// ─── per-doc checks ─────────────────────────────────────────────────────────

const referencedFiles = new Set();

for (const doc of docs) {
  const status = doc.exactness.status;
  validateSubjectInvarianceBinding(doc, readEvidence(doc.id), templateEvidenceHashes.get(doc.id));
  const layouts = [doc.formats.feed, doc.formats.story].filter(Boolean);
  // Story-first sources derive the 4:5 feed as a centred band; inputs whose
  // boxes fall outside the band legitimately have no layer on that surface.
  const storyFirst = Boolean(doc.formats.story?.native);

  // 4. contract: no orphans between inputs and layers, per format.
  for (const layout of layouts) {
    const derivedSurface = storyFirst && layout.format === "4:5";
    const textKeys = new Set(layout.layers.filter((l) => l.type === "text").map((l) => l.inputKey));
    const slotKeys = new Set(layout.layers.filter((l) => l.type === "image_slot").map((l) => l.inputKey));
    for (const input of doc.inputs.text) {
      if (!derivedSurface && !doc.exactness.bakedTextKeys.includes(input.key) && !textKeys.has(input.key)) {
        fail(`${doc.id}: text input "${input.key}" has no text layer in ${layout.format}`);
      }
    }
    for (const layer of layout.layers) {
      if (layer.type === "text" && !doc.inputs.text.some((i) => i.key === layer.inputKey)) {
        fail(`${doc.id}: text layer ${layer.id} references undeclared input "${layer.inputKey}"`);
      }
      if (layer.type === "image_slot" && !doc.inputs.images.some((i) => i.key === layer.inputKey)) {
        fail(`${doc.id}: slot ${layer.id} references undeclared input "${layer.inputKey}"`);
      }
    }
    for (const input of doc.inputs.images) {
      if (!derivedSurface && !slotKeys.has(input.key)) fail(`${doc.id}: image input "${input.key}" has no slot in ${layout.format}`);
    }

    // 5. story safe zones. Hard fail for ready docs (the shipped surface);
    // 5. story safe zones. Hard at ready: EDITABLE text may not sit in the
    // cropped zones. Baked text and full-bleed plates/slots ARE the source's
    // own design (backgrounds cover the canvas by design); they are exempt.
    if (layout.format === "9:16" && status === "ready") {
      for (const layer of layout.layers) {
        if (layer.type !== "text" || doc.exactness.bakedTextKeys.includes(layer.inputKey)) continue;
        const top = layer.box.y * 1920;
        const bottom = (layer.box.y + layer.box.height) * 1920;
        if (top < STORY_TOP_PX) fail(`${doc.id}: layer ${layer.id} intrudes into the story top safe zone (${Math.round(top)}px)`);
        if (bottom > 1920 - STORY_BOTTOM_PX) fail(`${doc.id}: layer ${layer.id} intrudes into the story bottom safe zone (${Math.round(bottom)}px)`);
      }
    }
  }

  // 6. ready evidence
  if (status === "ready") {
    if (!doc.formats.story) fail(`${doc.id}: ready requires a story layout`);
    if (doc.exactness.bakedTextKeys.length > 0) fail(`${doc.id}: ready cannot expose baked source text`);
    const editable = doc.inputs.text.filter((input) => !doc.exactness.bakedTextKeys.includes(input.key));
    if (editable.length === 0) fail(`${doc.id}: ready requires at least one customer-visible editable text field`);

    const evidence = readEvidence(doc.id);
    for (const input of editable) {
      if (typeof evidence?.sourceValues?.[input.key] !== "string" || evidence.sourceValues[input.key].trim().length === 0) {
        fail(`${doc.id}: editable text ${input.key} lacks a non-blank sourceValues record`);
      }
      if (typeof input.sample !== "string" || input.sample.trim().length === 0) {
        fail(`${doc.id}: editable text ${input.key} has blank public sample copy`);
      } else if (input.sample.trim() === evidence?.sourceValues?.[input.key]?.trim()) {
        fail(`${doc.id}: editable text ${input.key} public sample copy still equals private source text`);
      }
    }
    const curation = evidence?.sourceCuration;
    if (!curation?.accepted
      || !OPERATOR_USER_ID.test(curation.reviewerUserId ?? "")
      || !OPERATOR_EMAIL.test(curation.reviewerEmail ?? "")
      || !isIsoTimestamp(curation.reviewedAt)
      || !curation.classification
      || !String(curation.rationale ?? "").trim()) {
      fail(`${doc.id}: ready requires accepted sourceCuration with authenticated reviewerUserId, reviewerEmail, timestamp, classification, and rationale`);
    } else if (!canonicalEqual(curation.classification, doc.classification)) {
      fail(`${doc.id}: sourceCuration classification does not match template classification`);
    }

    const residualEvidence = doc.exactness.residualEvidence;
    if (!residualEvidence) {
      fail(`${doc.id}: ready requires replay-bound residual evidence`);
    } else {
      if (residualEvidence.sourceContentHash !== doc.provenance.sourceAd.contentHash) fail(`${doc.id}: residual evidence source hash is stale`);
      if (residualEvidence.templateHash !== fidelityTemplateHash(doc)) fail(`${doc.id}: residual evidence template hash is stale`);
      if (!isIsoTimestamp(residualEvidence.checkedAt)) fail(`${doc.id}: residual evidence timestamp is invalid`);
      const native = expectedNativeTextLayers(doc);
      if (residualEvidence.nativeSurface !== native.nativeSurface) {
        fail(`${doc.id}: fidelity evidence must cover native ${native.nativeSurface}, never a derived surface`);
      }
      const nativeLayerIds = native.layers.map((layer) => layer.id);
      if (!hasExactlyKeys(residualEvidence.residuals, nativeLayerIds)) {
        fail(`${doc.id}: native residual evidence must contain exactly every editable ${native.nativeSurface} text layer`);
      }
      if (!canonicalEqual(doc.exactness.residuals, residualEvidence.residuals)) {
        fail(`${doc.id}: residual summary must exactly match replay-bound native residual evidence`);
      }
      if (residualEvidence.outside.differingPixels !== 0 || residualEvidence.outside.differingBounds !== null || residualEvidence.outside.totalPixels <= 0) {
        fail(`${doc.id}: native fidelity changed pixels outside editable text regions`);
      }
      for (const [layerId, residual] of Object.entries(residualEvidence.residuals)) {
        if (residual > RESIDUAL_THRESHOLD) fail(`${doc.id}: native residual ${residual} for ${layerId} exceeds ${RESIDUAL_THRESHOLD}`);
      }
    }
    for (const [layerId, residual] of Object.entries(doc.exactness.residuals)) {
      if (residual > RESIDUAL_THRESHOLD) fail(`${doc.id}: residual ${residual} for ${layerId} exceeds ${RESIDUAL_THRESHOLD}`);
    }
    if (!hasNonTrivialRestyle(doc)) fail(`${doc.id}: restyle is incomplete: every declared image input needs one hashed safe replacement asset`);
    const replacementKeys = (doc.restyle.safeReplacementAssets ?? []).map((asset) => asset.inputKey);
    if (!hasExactlyKeys(Object.fromEntries(replacementKeys.map((key) => [key, true])), doc.inputs.images.map((input) => input.key))
      || new Set(replacementKeys).size !== replacementKeys.length) {
      fail(`${doc.id}: safe replacement assets must map one-to-one to declared image inputs`);
    }
    for (const asset of doc.restyle.safeReplacementAssets ?? []) {
      const path = join(publicDir, asset.src.replace(/^\//, ""));
      if (!existsSync(path)) fail(`${doc.id}: safe replacement asset missing at ${asset.src}`);
      else if (sha256File(path) !== asset.sha256) fail(`${doc.id}: safe replacement asset sha256 mismatch for ${asset.src}`);
    }
    if (doc.provenance.sample.contentHash === doc.provenance.sourceAd.contentHash) {
      fail(`${doc.id}: sample hash equals source hash`);
    }
    const stressEvidence = doc.exactness.stressEvidence;
    if (!stressEvidence) {
      fail(`${doc.id}: ready requires the complete stress preview evidence`);
    } else {
      if (stressEvidence.templateHash !== fidelityTemplateHash(doc)) fail(`${doc.id}: stress evidence template hash is stale`);
      if (!isIsoTimestamp(stressEvidence.checkedAt)) fail(`${doc.id}: stress evidence timestamp is invalid`);
      const expectedStressEntries = STRESS_SCENARIOS.flatMap((scenario) => STRESS_FORMATS.map((format) => `${format}:${scenario}`));
      const actualStressEntries = stressEvidence.entries.map((entry) => `${entry.format}:${entry.scenario}`);
      if (stressEvidence.entries.length !== 10 || !hasExactlyKeys(Object.fromEntries(actualStressEntries.map((entry) => [entry, true])), expectedStressEntries)
        || new Set(actualStressEntries).size !== actualStressEntries.length) {
        fail(`${doc.id}: stress evidence must contain exactly ten feed/story × five-scenario entries`);
      }
      const canonicalMatrixHash = hashCanonicalJson({ templateHash: stressEvidence.templateHash, entries: stressEvidence.entries });
      if (stressEvidence.matrixHash !== canonicalMatrixHash) fail(`${doc.id}: stress evidence matrix hash is stale or fabricated`);
    }
    const reviewEvidence = doc.exactness.reviewEvidence;
    if (!reviewEvidence) {
      fail(`${doc.id}: ready requires authenticated human review evidence`);
    } else {
      if (!OPERATOR_USER_ID.test(reviewEvidence.reviewerUserId) || !OPERATOR_EMAIL.test(reviewEvidence.reviewerEmail) || !isIsoTimestamp(reviewEvidence.reviewedAt)
        || reviewEvidence.confirmation !== "inspected-at-100-percent") {
        fail(`${doc.id}: review evidence requires authenticated reviewerUserId, reviewerEmail, timestamp, and 100% confirmation`);
      }
      if (reviewEvidence.templateHash !== fidelityTemplateHash(doc)
        || reviewEvidence.sourceContentHash !== doc.provenance.sourceAd.contentHash
        || reviewEvidence.sampleContentHash !== doc.provenance.sample.contentHash) {
        fail(`${doc.id}: review evidence is not bound to the current template, source, and sample`);
      }
      if (curation && reviewEvidence.sourceCurationHash !== hashCanonicalJson(curation)) fail(`${doc.id}: review evidence source curation hash is stale`);
      if (residualEvidence && reviewEvidence.fidelityEvidenceHash !== hashCanonicalJson(residualEvidence)) fail(`${doc.id}: review evidence fidelity hash is stale`);
      if (stressEvidence && reviewEvidence.stressEvidenceHash !== hashCanonicalJson(stressEvidence)) fail(`${doc.id}: review evidence stress hash is stale`);
    }
    for (const layout of layouts) {
      for (const layer of layout.layers) {
        if (layer.type === "image_slot" && !layer.minSourcePx) {
          fail(`${doc.id}: slot ${layer.id} lacks minSourcePx (ready)`);
        }
      }
    }
  }

  // 7. publish block
  const publish = doc.publish;
  if (!LEAD_CTA_SUBSET.has(publish.cta)) fail(`${doc.id}: cta ${publish.cta} not in the lead-ads subset`);
  const copyLimits = [
    ["primaryText", 125],
    ["headlines", 40],
    ["descriptions", 90],
  ];
  for (const [field, limit] of copyLimits) {
    const values = publish.copy?.[field] ?? [];
    if (values.length > 5) fail(`${doc.id}: publish.copy.${field} has ${values.length} entries (>5)`);
    for (const value of values) {
      if (value.length > limit) fail(`${doc.id}: publish.copy.${field} entry exceeds ${limit} chars`);
    }
  }
  if (!publish.leadForm?.questions?.length) fail(`${doc.id}: lead form questions empty`);
  const positions = [...(publish.placements?.facebookPositions ?? []), ...(publish.placements?.instagramPositions ?? [])];
  if (publish.formatRouting?.story && !positions.length) fail(`${doc.id}: placements do not cover formatRouting`);
  for (const key of KNOWN_CREATIVE_FEATURES) {
    if (!(key in (publish.creativeFeatures ?? {}))) fail(`${doc.id}: creativeFeatures omits ${key}`);
  }

  // 2/3. assets + fonts (drafts skip existence; sha checks still run)
  for (const font of doc.fonts) {
    const face = fontByFile.get(font.file);
    if (!face || face.fontId !== font.fontId) {
      fail(`${doc.id}: font ${font.fontId} (${font.file}) not in manifest`);
      continue;
    }
    if (face.sha256 !== font.sha256) fail(`${doc.id}: font ${font.fontId} sha256 mismatch vs manifest`);
    if (!face.license) fail(`${doc.id}: font ${font.fontId} has no license`);
    if (face.weight !== font.weight || Boolean(face.italic) !== font.italic) {
      fail(`${doc.id}: font ${font.fontId} weight/italic mismatch vs manifest`);
    }
  }

  // Drafts: assets land during the pipeline; register their paths so the
  // orphan sweep doesn't flag mid-pipeline files (sha checks skipped).
  if (status === "draft") {
    for (const layout of layouts) {
      const asset = privateAssetPath(doc.id, layout.plate.src);
      if (asset) referencedPrivateFiles.add(asset.relative);
    }
    if (doc.provenance.sample.imageSrc) referencedFiles.add(doc.provenance.sample.imageSrc);
    continue; // plates land at decompose time
  }

  for (const layout of layouts) {
    const plateAsset = privateAssetPath(doc.id, layout.plate.src);
    if (!plateAsset) continue;
    const platePath = plateAsset.path;
    referencedPrivateFiles.add(plateAsset.relative);
    if (!existsSync(platePath)) {
      fail(`${doc.id}: plate missing at ${layout.plate.src}`);
      continue;
    }
    if (sha256File(platePath) !== layout.plate.sha256) {
      fail(`${doc.id}: plate sha256 mismatch for ${layout.plate.src}`);
    }
    const dims = readPngLikeDimensions(platePath);
    if (dims && (dims.width !== layout.width || dims.height !== layout.height)) {
      fail(`${doc.id}: plate ${layout.plate.src} is ${dims.width}x${dims.height}, layout wants ${layout.width}x${layout.height}`);
    }
    for (const layer of layout.layers) {
      if (layer.type !== "overlay_patch") continue;
      const patchAsset = privateAssetPath(doc.id, layer.src);
      if (!patchAsset) continue;
      const patchPath = patchAsset.path;
      referencedPrivateFiles.add(patchAsset.relative);
      if (!existsSync(patchPath)) {
        fail(`${doc.id}: overlay patch missing at ${layer.src}`);
      } else if (sha256File(patchPath) !== layer.sha256) {
        fail(`${doc.id}: overlay patch sha256 mismatch for ${layer.src}`);
      }
    }
  }
  const samplePath = join(publicDir, doc.provenance.sample.imageSrc.replace(/^\//, ""));
  if (doc.provenance.sample.imageSrc) {
    referencedFiles.add(doc.provenance.sample.imageSrc);
    if (!existsSync(samplePath)) fail(`${doc.id}: sample missing at ${doc.provenance.sample.imageSrc}`);
    else if (sha256File(samplePath) !== doc.provenance.sample.contentHash) fail(`${doc.id}: sample sha256 mismatch`);
  }
  if (doc.provenance.storySample?.imageSrc) {
    referencedFiles.add(doc.provenance.storySample.imageSrc);
    const storySamplePath = join(publicDir, doc.provenance.storySample.imageSrc.replace(/^\//, ""));
    if (!existsSync(storySamplePath)) fail(`${doc.id}: story sample missing at ${doc.provenance.storySample.imageSrc}`);
    else if (sha256File(storySamplePath) !== doc.provenance.storySample.contentHash) fail(`${doc.id}: story sample sha256 mismatch`);
  }
  if (doc.provenance.sample.contentHash && doc.provenance.sample.contentHash === doc.provenance.sourceAd.contentHash) {
    fail(`${doc.id}: sample hash equals source hash`);
  }
}

// Public v2 contains safe samples only. Any source-derived plate/patch that
// reappears here is both orphaned and a privacy regression.
if (existsSync(v2PublicDir)) {
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const src = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), src);
      } else if (!referencedFiles.has(src)) {
        fail(`orphaned file under public/adstudio-templates: ${src}`);
      }
    }
  };
  walk(v2PublicDir, "/adstudio-templates");
}

// Every server-only template asset must be declared by a template (apart from
// the one render-smoke fixture), and every declared asset was hash-checked.
if (existsSync(privateAssetsDir)) {
  const walkPrivate = (dir, prefix = "") => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walkPrivate(join(dir, entry.name), relative);
      else if (!referencedPrivateFiles.has(relative)) fail(`orphaned private template asset: ${relative}`);
    }
  };
  walkPrivate(privateAssetsDir);
}

// ── 8.5 visual output: no tofu / missing glyphs in any rendered surface ──
// Two complementary checks:
//  (a) EXACT font coverage — every face a doc declares must contain every
//      codepoint the doc renders (text input samples + any literal text), so
//      missing-glyph boxes cannot be produced at build time.
//  (b) PREVIEW SCAN — the .notdef glyph draws as a hollow rectangle outline;
//      a text layer whose ink is concentrated on a thin closed rectangle with
//      an empty interior is tofu. Scans every 4:5 and 9:16 sample.
const { brotliDecompressSync } = await import("node:zlib");

const WOFF2_KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm",
  "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern",
  "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC",
  "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar",
  "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty",
  "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat",
  "Gloc", "Feat", "Sill",
];

function readBase128(b, start) {
  let result = 0;
  let i = start;
  for (let count = 0; count < 5; count += 1) {
    if (i >= b.length) throw new Error("base128 value truncated");
    const byte = b[i];
    i += 1;
    if (count === 0 && byte === 0x80) throw new Error("base128 leading zero");
    result = (result << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value: result, next: i };
  }
  throw new Error("base128 value too long");
}

function parseWoff2Cmap(filePath) {
  const b = readFileSync(filePath);
  if (b.toString("ascii", 0, 4) !== "wOF2") throw new Error("not a woff2 font");
  const numTables = b.readUInt16BE(12);
  const totalCompressedSize = b.readUInt32BE(20);
  let off = 48;
  const tables = [];
  for (let i = 0; i < numTables; i += 1) {
    const flags = b.readUInt8(off);
    off += 1;
    const tagIndex = flags & 0x3f;
    let tag;
    if (tagIndex === 0x3f) {
      tag = b.toString("ascii", off, off + 4);
      off += 4;
    } else {
      tag = WOFF2_KNOWN_TAGS[tagIndex];
    }
    const orig = readBase128(b, off);
    off = orig.next;
    const transformVersion = flags >> 6;
    const transformed = (tag === "glyf" || tag === "loca") ? transformVersion !== 3 : transformVersion !== 0;
    if (transformed) {
      const len = readBase128(b, off);
      off = len.next;
    }
    tables.push({ tag, origLength: orig.value });
  }
  const compressed = b.subarray(off, off + totalCompressedSize);
  const data = brotliDecompressSync(compressed);
  let cursor = 0;
  let cmapData = null;
  for (const table of tables) {
    if (table.tag === "cmap") {
      cmapData = data.subarray(cursor, cursor + table.origLength);
      break;
    }
    cursor += table.origLength;
  }
  if (!cmapData) return new Set();
  const numSubtables = cmapData.readUInt16BE(2);
  const codes = new Set();
  for (let i = 0; i < numSubtables; i += 1) {
    const rec = 4 + i * 8;
    const platformID = cmapData.readUInt16BE(rec);
    const encodingID = cmapData.readUInt16BE(rec + 2);
    const subOffset = cmapData.readUInt32BE(rec + 4);
    const format = cmapData.readUInt16BE(subOffset);
    if (format === 4 && (platformID === 3 || platformID === 0)) {
      const segCountX2 = cmapData.readUInt16BE(subOffset + 6);
      const segCount = segCountX2 >> 1;
      const endCodes = subOffset + 14;
      const startCodes = endCodes + segCountX2 + 2;
      for (let s = 0; s < segCount; s += 1) {
        const start = cmapData.readUInt16BE(startCodes + s * 2);
        const end = cmapData.readUInt16BE(endCodes + s * 2);
        for (let c = start; c <= end && c <= 0xffff; c += 1) codes.add(c);
      }
    } else if (format === 12 && (platformID === 3 || platformID === 0)) {
      const nGroups = cmapData.readUInt32BE(subOffset + 12);
      for (let g = 0; g < nGroups; g += 1) {
        const base = subOffset + 16 + g * 12;
        const start = cmapData.readUInt32BE(base);
        const end = cmapData.readUInt32BE(base + 4);
        for (let c = start; c <= end && c < 0x110000; c += 1) codes.add(c);
      }
    }
  }
  return codes;
}

function tofuLikeComponents(gray, w, h) {
  // gray: Uint8Array luminance; returns the area of ink components that look
  // like .notdef tofu boxes (thin hollow rectangles).
  const visited = new Uint8Array(w * h);
  let tofuArea = 0;
  let totalInk = 0;
  const queue = [];
  for (let start = 0; start < w * h; start += 1) {
    if (visited[start] || gray[start] >= 128) continue;
    // flood fill one ink component
    queue.length = 0;
    queue.push(start);
    visited[start] = 1;
    let minX = start % w, maxX = minX, minY = (start / w) | 0, maxY = minY;
    let ink = 0;
    while (queue.length > 0) {
      const p = queue.pop();
      const x = p % w;
      const y = (p / w) | 0;
      ink += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && !visited[p - 1] && gray[p - 1] < 128) { visited[p - 1] = 1; queue.push(p - 1); }
      if (x < w - 1 && !visited[p + 1] && gray[p + 1] < 128) { visited[p + 1] = 1; queue.push(p + 1); }
      if (y > 0 && !visited[p - w] && gray[p - w] < 128) { visited[p - w] = 1; queue.push(p - w); }
      if (y < h - 1 && !visited[p + w] && gray[p + w] < 128) { visited[p + w] = 1; queue.push(p + w); }
    }
    totalInk += ink;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    if (bw < 6 || bh < 6) continue; // noise specks are not tofu
    if (bw < w * 0.03 || bh < h * 0.03) continue; // too small relative to the layer
    // ink within 1px of the component bbox border vs the rest
    let borderInk = 0;
    let interiorInk = 0;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const p = y * w + x;
        if (gray[p] >= 128) continue;
        if (x === minX || x === maxX || y === minY || y === maxY) borderInk += 1;
        else interiorInk += 1;
      }
    }
    const interiorFraction = interiorInk / (bw * bh);
    const borderShare = ink === 0 ? 0 : borderInk / ink;
    // tofu: a thin closed rectangle — nearly all ink on the bbox border and an
    // empty interior. Real glyphs (O, 0, D, @) have thick strokes so their
    // interior is inked; diagonal glyphs (>) do not hug all four edges.
    if (borderShare >= 0.78 && interiorFraction < 0.05) tofuArea += ink;
  }
  return { tofuArea, totalInk };
}

async function scanSampleForTofu(doc, samplePath, layout, label, failures) {
  if (!existsSync(samplePath)) return;
  const sharpMod = await import("sharp");
  const { data, info } = await sharpMod.default(samplePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const layer of layout.layers) {
    if (layer.type !== "text") continue;
    const x0 = Math.max(0, Math.floor(layer.box.x * info.width));
    const y0 = Math.max(0, Math.floor(layer.box.y * info.height));
    const x1 = Math.min(info.width, Math.ceil((layer.box.x + layer.box.width) * info.width));
    const y1 = Math.min(info.height, Math.ceil((layer.box.y + layer.box.height) * info.height));
    const w = x1 - x0;
    const h = y1 - y0;
    if (w < 8 || h < 8) continue;
    const gray = new Uint8Array(w * h);
    // A light/inverse text role on a light-neutral or photographic region is
    // still real ink; the historical lum<128 probe incorrectly called those
    // layers empty.  Use the authored hex colour to choose the polarity while
    // retaining the dark-text behaviour for normal ink.
    const authoredColour = layer.typo?.color;
    const colourMatch = typeof authoredColour === "string" && /^#[0-9a-f]{6}$/i.test(authoredColour)
      ? authoredColour.slice(1).match(/../g)?.map((part) => Number.parseInt(part, 16))
      : null;
    const authoredLum = colourMatch
      ? 0.2126 * colourMatch[0] + 0.7152 * colourMatch[1] + 0.0722 * colourMatch[2]
      : 0;
    const expectsLightInk = authoredLum >= 128;
    let ink = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const p = (y * info.width + x) * 3;
        const lum = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
        gray[(y - y0) * w + (x - x0)] = expectsLightInk ? 255 - lum : lum;
        if (expectsLightInk ? lum > 180 : lum < 128) ink += 1;
      }
    }
    if (ink === 0) {
      failures.push(`${doc.id}: ${label} layer ${layer.id} rendered no ink at all (missing glyphs or the font failed to load)`);
      continue;
    }
    const { tofuArea, totalInk } = tofuLikeComponents(gray, w, h);
    if (tofuArea >= 0.25 * totalInk) {
      failures.push(`${doc.id}: ${label} layer ${layer.id} renders tofu/missing-glyph boxes (${Math.round((tofuArea / totalInk) * 100)}% of ink is hollow .notdef rectangles)`);
    }
  }
}

for (const doc of docs) {
  if (doc.exactness.status === "draft") continue;
  const failures = [];
  // (a) font coverage
  const renderedText = [
    ...doc.inputs.text.map((input) => input.sample ?? ""),
    ...doc.formats.feed.layers.filter((l) => l.type === "text" && l.literal).map((l) => l.literal),
  ].join("");
  const needed = new Set([...renderedText].map((ch) => ch.codePointAt(0)).filter((cp) => cp >= 32 && cp !== 0xfeff));
  for (const font of doc.fonts) {
    const rel = font.file.replace(/^\//, "");
    const fontPath = join(publicDir, rel);
    if (!existsSync(fontPath)) {
      failures.push(`${doc.id}: font file missing at ${font.file} — renders fall back to a missing-glyph font`);
      continue;
    }
    let codes;
    try {
      codes = parseWoff2Cmap(fontPath);
    } catch (error) {
      failures.push(`${doc.id}: font ${font.file} is unreadable (${error?.message ?? error})`);
      continue;
    }
    const missing = [...needed].filter((cp) => !codes.has(cp)).map((cp) => String.fromCodePoint(cp));
    if (missing.length > 0) {
      failures.push(`${doc.id}: font ${font.fontId} (${font.file}) lacks glyphs for: ${JSON.stringify(missing.slice(0, 20))} — the rendered text would show tofu boxes`);
    }
  }
  // (b) preview scan on both placements
  const feedSample = doc.provenance.sample?.imageSrc ? join(publicDir, doc.provenance.sample.imageSrc.replace(/^\//, "")) : null;
  if (feedSample) await scanSampleForTofu(doc, feedSample, doc.formats.feed, "4:5", failures);
  const storySample = doc.provenance.storySample?.imageSrc
    ? join(publicDir, doc.provenance.storySample.imageSrc.replace(/^\//, ""))
    : join(publicDir, "adstudio-templates", doc.id, "sample-story.png");
  if (doc.formats.story) await scanSampleForTofu(doc, storySample, doc.formats.story, "9:16", failures);
  for (const message of failures) fail(message);
}

// 8. diversity across the gallery.
if (docs.length > 0) {
  for (const message of diversityFailures(docs)) fail(message);
}

// ── 9. replay the ready evidence, then render both formats + stress matrix ──
// Skipped in fast mode (the unit test embedding this gate stays fast; the
// dedicated CI step runs the full gate without the flag). Stored evidence is
// still fully hash-checked above in fast mode; this path independently reruns
// the native fidelity and stress matrix so a hand-written report cannot pass.
if (!process.env.ADSTUDIO_V2_GATE_FAST && docs.some((doc) => doc.exactness.status === "ready")) {
  const { renderAdDocToPng } = await import("../../src/lib/adstudio/v2/render/server.ts");
  for (const doc of docs.filter((entry) => entry.exactness.status === "ready")) {
    const evidence = readEvidence(doc.id);
    const residualEvidence = doc.exactness.residualEvidence;
    const stressEvidence = doc.exactness.stressEvidence;
    const sourcePath = sourcePathFor(doc);
    if (!sourcePath || !residualEvidence) {
      fail(`${doc.id}: ready fidelity replay requires the recorded local source asset and residual evidence`);
    } else {
      try {
        const replay = await runNativeSurfaceFidelity(doc, {
          sourceBytes: readFileSync(sourcePath),
          sourceValues: evidence?.sourceValues ?? {},
          checkedAt: residualEvidence.checkedAt,
        });
        if (!canonicalEqual(replay, residualEvidence)) {
          fail(`${doc.id}: native fidelity replay does not match recorded residual evidence`);
        }
      } catch (error) {
        fail(`${doc.id}: native fidelity replay failed: ${error?.message ?? error}`);
      }
    }
    const values = {
      images: {},
      text: Object.fromEntries(doc.inputs.text.map((input) => [input.key, input.sample])),
    };
    for (const [key, layout] of [["feed", doc.formats.feed], ["story", doc.formats.story]]) {
      if (!layout) continue;
      try {
        const png = await renderAdDocToPng(doc, {
          schema: "adstudio.instance.v2",
          templateId: doc.id,
          templateHash: "0".repeat(64),
          format: layout.format,
          values,
          overrides: [],
        }, layout.format);
        if (!png || png.length < 1000) fail(`${doc.id}: ${key} smoke render produced no image`);
      } catch (error) {
        fail(`${doc.id}: ${key} smoke render threw: ${error?.message ?? error}`);
      }
    }
    try {
      const replay = await runStressMatrix(doc);
      if (!stressEvidence || replay.hash !== stressEvidence.matrixHash || !canonicalEqual(replay.entries, stressEvidence.entries)) {
        fail(`${doc.id}: stress matrix replay does not match recorded evidence`);
      }
    } catch (error) {
      fail(`${doc.id}: stress matrix replay threw: ${error?.message ?? error}`);
    }
  }
}

// ─── report ─────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`adstudio-templates-v2: ${failures.length} failure(s)`);
  for (const message of failures.slice(0, 40)) console.error(`  - ${message}`);
  process.exit(1);
}
for (const message of warnings.slice(0, 20)) console.warn(`  ! ${message}`);
const byStatus = docs.reduce((acc, doc) => {
  acc[doc.exactness.status] = (acc[doc.exactness.status] ?? 0) + 1;
  return acc;
}, {});
console.log(`adstudio-templates-v2: ${docs.length} template(s) checked [${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(", ") || "none"}] — schema, contract, publish, diversity OK`);
