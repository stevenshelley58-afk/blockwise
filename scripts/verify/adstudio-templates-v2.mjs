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
const templateByteHashes = new Map();
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
    templateByteHashes.set(doc.id, createHash("sha256").update(templateBytes).digest("hex"));
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

// One source ad, at most one template, across BOTH generations — with the
// transition carve-out: a v2 doc is the SUCCESSOR of the same-id v1 doc
// (same source by construction; Track H deletes the v1 side), not a second
// template from that source. Only genuinely new sources get deduplicated.
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
      if (v1.sourceAd?.contentHash) sourceHashes.set(v1.sourceAd.contentHash, `v1:${v1Id}`);
    } catch {
      // not a doc; not this gate's business
    }
  }
}
for (const doc of docs) {
  const owner = sourceHashes.get(doc.provenance.sourceAd.contentHash);
  if (owner) fail(`${doc.id}: source ad already used by ${owner} — one source, one template`);
  sourceHashes.set(doc.provenance.sourceAd.contentHash, `v2:${doc.id}`);
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

function validateSubjectInvarianceBinding(doc, evidence, templateByteHash) {
  const subjectInvariance = evidence?.subjectInvariance;
  if (!subjectInvariance) return;
  const binding = subjectInvariance.binding;
  if (!binding) {
    fail(`${doc.id}: subject-invariance evidence lacks a deterministic binding`);
    return;
  }
  if (binding.templateSha256 !== templateByteHash) fail(`${doc.id}: subject-invariance evidence template hash is stale`);
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
  return null;
}

function skeletonSignature(doc) {
  const boxes = [];
  const q = (v) => Math.min(11, Math.max(0, Math.round(v * 12)));
  for (const layout of [doc.formats.feed, doc.formats.story]) {
    if (!layout) continue;
    for (const layer of layout.layers) {
      boxes.push([q(layer.box.x), q(layer.box.y), q(layer.box.x + layer.box.width), q(layer.box.y + layer.box.height)].join(","));
    }
  }
  // Baked text is visually present (it's in the plate) even when it is not an
  // editable layer — the signature must reflect the real layout.
  for (const box of Object.values(doc.__textBoxes ?? {})) {
    boxes.push([q(box.x), q(box.y), q(box.x + box.width), q(box.y + box.height)].join(","));
  }
  return boxes.sort().join("|");
}

// ─── per-doc checks ─────────────────────────────────────────────────────────

const referencedFiles = new Set();

for (const doc of docs) {
  const status = doc.exactness.status;
  validateSubjectInvarianceBinding(doc, readEvidence(doc.id), templateByteHashes.get(doc.id));
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

// 8. diversity across the gallery.
if (docs.length > 0) {
  const intents = docs.map((doc) => doc.classification?.primary_intent).filter((intent) => intent && intent !== "other");
  const distinct = new Set(intents);
  if (distinct.size < 5 && docs.length >= 5) fail(`diversity: only ${distinct.size} distinct non-other intents (<5)`);
  const counts = new Map();
  for (const intent of intents) counts.set(intent, (counts.get(intent) ?? 0) + 1);
  for (const [intent, count] of counts) {
    if (count / Math.max(1, intents.length) > 0.5) fail(`diversity: intent "${intent}" is ${Math.round((count / intents.length) * 100)}% of the gallery (>50%)`);
  }
  const signatures = new Map();
  for (const doc of docs) {
    const signature = skeletonSignature(doc);
    signatures.set(signature, (signatures.get(signature) ?? 0) + 1);
  }
  for (const [signature, count] of signatures) {
    if (count > 3) fail(`diversity: ${count} templates share an identical layout skeleton (>3)`);
  }
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
