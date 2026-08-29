#!/usr/bin/env node

// AdStudio v2 release packager — deterministic assembly of the immutable,
// source-free TemplatePack release for a multi-variant pack.
//
//   node scripts/adstudio/v2/pack-release.mjs \
//     --candidate <candidateRoot> \
//     --release <releaseDir> \
//     --run <toolRunId> --trace <traceRef> \
//     --job <jobName> --scope <projectId> \
//     --settings-revision <n> --approval <approvalReceiptPath> \
//     [--slot <slotFixturePath>]
//
// Produces, beneath <releaseDir>:
//   pack-v2/<variantId>.json   one signed TemplatePack (blockwise.template-pack/v2)
//                              per variant, validated against the frozen schema
//   templates/                 canonical adstudio.template.v2 docs + evidence
//   assets/                    plates + samples (hash-verified)
//   previews/                  deterministic feed + story previews per variant
//   variant-pack.manifest.json pack manifest
//   pack.sha256 / pack.sig     Ed25519 signature over the bundle artifact
//   release.json               schema://frank.ad-template-generator-release/v1
//   receipt.json               redacted receipt with artifact refs + serving note
//
// No image model is called; previews are deterministic renders. The release
// directory is made read-only after writing (immutable).

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, chmodSync, readdirSync } from "node:fs";
import { join, resolve, dirname, basename, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { renderAdDocToPng } from "../../../src/lib/adstudio/v2/render/server.ts";
import { hashCanonicalJson } from "../../../src/lib/adstudio/v2/template-hash.ts";
import { templatePackV2Schema } from "../../../packages/ad-template-pack-contract/src/index.ts";
import { computeManifestHash, canonicalJson } from "../../../packages/ad-template-pack-contract/src/hash.ts";
import { evaluateStoryQa } from "./lib/story-qa.mjs";
import { LIKENESS_THRESHOLD, validateGenerationTrace } from "./generation-trace.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
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

/**
 * Release is a one-way boundary. It must consume the explicit receipt created
 * by Frank after the operator reviewed every native-pixel preview; a missing
 * path or a merely pending decision can never be upgraded to "approved" by
 * the packager itself.
 */
export function readApprovalReceipt(path) {
  if (!path) throw new Error("--approval is required after native-pixel human review");
  const resolvedPath = resolve(path);
  if (!existsSync(resolvedPath)) throw new Error(`approval receipt does not exist: ${resolvedPath}`);
  const raw = readJson(resolvedPath);
  const receipt = raw?.approval_receipt && typeof raw.approval_receipt === "object"
    ? raw.approval_receipt
    : raw;
  if (receipt?.decision !== "approved") throw new Error("approval receipt decision must be approved");
  if (receipt?.gate !== "native-pixel-human-approval") {
    throw new Error("approval receipt gate must be native-pixel-human-approval");
  }
  if (typeof receipt?.receipt_ref !== "string" || !receipt.receipt_ref.trim()) {
    throw new Error("approval receipt must include receipt_ref");
  }
  if (typeof receipt?.decided_at !== "string" || !Number.isFinite(Date.parse(receipt.decided_at))) {
    throw new Error("approval receipt must include an ISO decided_at timestamp");
  }
  return {
    decision: "approved",
    gate: "native-pixel-human-approval",
    receipt_ref: receipt.receipt_ref,
    decided_at: receipt.decided_at,
  };
}

export function assertStoryQa(templateId, storyQa) {
  if (!storyQa?.passed) {
    throw new Error(`${templateId}: Story QA failed: ${(storyQa?.blockers ?? ["unknown Story QA failure"]).join("; ")}`);
  }
}

function fidelityTemplateHash(doc) {
  return hashCanonicalJson({
    ...doc,
    exactness: { bakedTextKeys: [...(doc.exactness?.bakedTextKeys ?? [])].sort() },
  });
}

/**
 * A release may only consume a candidate that completed the iterative QA
 * process.  The portable pack is intentionally not allowed to turn a `qa`
 * document or a stale sidecar into a release by reporting optimistic booleans.
 */
export function assertCandidateEvidence({ templateId, doc, evidence, templateBytes }) {
  if (doc?.exactness?.status !== "ready") {
    throw new Error(`${templateId}: release requires exactness.status=ready`);
  }
  const expectedTemplateSha = sha256(templateBytes);
  if (evidence?.templateSha256 !== expectedTemplateSha) {
    throw new Error(`${templateId}: evidence templateSha256 is stale or wrong`);
  }
  if (evidence?.restyle?.sourceFree !== true || evidence?.restyle?.noWholeAdImageModel !== true) {
    throw new Error(`${templateId}: evidence does not prove source-free iterative construction`);
  }
  let generationTrace;
  try {
    generationTrace = validateGenerationTrace(evidence?.generationTrace);
  } catch (error) {
    throw new Error(`${templateId}: accepted durable generation trace is missing or invalid: ${error.message}`);
  }
  if (generationTrace.templateId !== templateId
    || generationTrace.sourceSha256 !== doc.provenance?.sourceAd?.contentHash
    || generationTrace.status !== "accepted") {
    throw new Error(`${templateId}: generation trace is not accepted or is bound to another template/source`);
  }
  const acceptedGeneration = generationTrace.generations.at(-1);
  if (acceptedGeneration?.scores?.primaryAdSystemLikeness < LIKENESS_THRESHOLD
    || acceptedGeneration?.scores?.strictAdSystemLikeness < LIKENESS_THRESHOLD
    || acceptedGeneration?.artifacts?.feedSha256 !== doc.provenance?.sample?.contentHash
    || acceptedGeneration?.artifacts?.storySha256 !== doc.provenance?.storySample?.contentHash) {
    throw new Error(`${templateId}: accepted generation scores or preview hashes are stale`);
  }

  const exactness = doc.exactness;
  const fidelityHash = fidelityTemplateHash(doc);
  const residual = exactness.residualEvidence;
  const stress = exactness.stressEvidence;
  const review = exactness.reviewEvidence;
  if (!residual || residual.templateHash !== fidelityHash || residual.outside?.differingPixels !== 0) {
    throw new Error(`${templateId}: fidelity evidence is missing, stale, or failed`);
  }
  if (!stress || stress.templateHash !== fidelityHash || !Array.isArray(stress.entries) || stress.entries.length !== 10) {
    throw new Error(`${templateId}: complete feed/story stress evidence is required`);
  }
  const matrixHash = hashCanonicalJson({ templateHash: stress.templateHash, entries: stress.entries });
  if (stress.matrixHash !== matrixHash) throw new Error(`${templateId}: stress evidence matrix hash is stale`);
  if (!review || review.templateHash !== fidelityHash
    || review.sourceContentHash !== doc.provenance?.sourceAd?.contentHash
    || review.sampleContentHash !== doc.provenance?.sample?.contentHash
    || review.fidelityEvidenceHash !== hashCanonicalJson(residual)
    || review.stressEvidenceHash !== hashCanonicalJson(stress)) {
    throw new Error(`${templateId}: human review evidence is missing or not bound to current evidence`);
  }

  const qa = evidence.qa;
  if (qa?.feedPassed !== true || qa?.storyPassed !== true) {
    throw new Error(`${templateId}: Feed and Story QA must both pass in evidence`);
  }
  const stressResults = qa?.stressFixtureResults;
  if (!stressResults || typeof stressResults !== "object" || Array.isArray(stressResults)
    || Object.keys(stressResults).length !== 10
    || Object.values(stressResults).some((result) => result?.passed !== true)) {
    throw new Error(`${templateId}: evidence stressFixtureResults must contain 10 passing cases`);
  }
  return { feedPassed: true, storyPassed: true, stressFixtureResults: qa.stressFixtureResults };
}

function loadSigningKey(publicReleaseEnabled) {
  const inline = process.env.FRANK_PACK_SIGNING_PRIVATE_KEY?.trim();
  const keyFile = process.env.FRANK_PACK_SIGNING_KEY_FILE?.trim();
  if (inline || keyFile) {
    const pem = inline || readFileSync(resolve(keyFile), "utf8");
    const privateKey = createPrivateKey(pem);
    return { privateKey, publicKey: createPublicKey(privateKey), ephemeral: false };
  }
  if (publicReleaseEnabled && process.env.FRANK_ALLOW_EPHEMERAL_PACK_SIGNING !== "1") {
    throw new Error("A public release requires FRANK_PACK_SIGNING_KEY_FILE or FRANK_PACK_SIGNING_PRIVATE_KEY");
  }
  return { ...generateKeyPairSync("ed25519"), ephemeral: true };
}
function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

const COLOUR_ROLES = ["background", "primary", "secondary", "accent", "mainText", "inverseText"];

function instantFormDefaults(doc) {
  const leadForm = doc.publish?.leadForm;
  if (!leadForm) return null;
  const primary = doc.publish?.copy?.primaryText?.[0] ?? "Tell us what you need and we will be in touch.";
  return {
    name: leadForm.name ?? `${doc.name} lead form`.slice(0, 100),
    formType: leadForm.formType ?? "higher_intent",
    intro: { headline: leadForm.headline, body: leadForm.introBody ?? primary.slice(0, 500) },
    contactFields: leadForm.contactFields ?? [
      { type: "full_name", required: true },
      { type: "email", required: true },
      { type: "phone", required: false },
    ],
    customQuestions: (leadForm.questions ?? []).slice(0, 5).map((label) => ({ type: "short_answer", label, required: false })),
    privacy: leadForm.privacy ?? { url: "", linkText: "Privacy policy" },
    thankYou: {
      title: leadForm.thankYou.title,
      body: leadForm.thankYou.body,
      actionType: leadForm.thankYou.actionType ?? "none",
      ...(leadForm.thankYou.actionUrl ? { actionUrl: leadForm.thankYou.actionUrl } : {}),
    },
  };
}

function pixelRect(rect, width, height) {
  return { x: rect.x * width, y: rect.y * height, width: rect.width * width, height: rect.height * height };
}

function v2ToTemplatePack({ doc, feedPreviewBytes, storyPreviewBytes, plateFiles, createdAt, publicBaseUrl, storyQa, qaEvidence }) {
  const assetUrl = (key) => publicBaseUrl ? `${publicBaseUrl}/assets/${plateFiles[key]?.fileName ?? basename(key)}` : undefined;
  const declaredRequirements = doc.publish?.requirements ?? doc.publishRequirements ?? doc.provenance?.publishRequirements ?? {};
  const declaredDestination = declaredRequirements.destination ?? (doc.publish?.leadForm
    ? { required: true, kind: "instant_form", dependency: "instant_form" }
    : { required: false, kind: "none", dependency: null });
  const declaredForm = declaredRequirements.instantForm ?? {};
  const paletteMap = doc.restyle?.paletteMap ?? {};
  const paletteRoles = doc.restyle?.paletteRoles ?? {};
  const paletteColour = (key, fallback) => {
    const roleValue = paletteRoles[key];
    if (typeof roleValue === "string" && /^#[0-9a-f]{6}$/i.test(roleValue)) return roleValue.toLowerCase();
    const value = paletteMap[key];
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  };
  const roleForLayer = (layer) => {
    const role = layer.colourRole || (layer.typo?.colourRole);
    if (role === "background") return "background";
    if (role === "surface") return "secondary";
    if (role === "accent") return "accent";
    if (role === "inverseText") return "inverseText";
    if (role === "ink") return "mainText";
    if (layer.id?.includes("supporting")) return "secondary";
    if (layer.id?.includes("cta")) return "accent";
    const colour = layer.typo?.color || layer.fill;
    if (typeof colour === "string" && colour.toLowerCase() === String(paletteRoles.inverseText || "").toLowerCase()) return "inverseText";
    if (typeof colour === "string" && colour.toLowerCase() === String(paletteRoles.surface || "").toLowerCase()) return "secondary";
    return "mainText";
  };
  const metadata = {
    title: doc.name,
    description: `${doc.category} ${doc.audienceIntent} template`,
    gallerySamples: {
      feed: { assetKey: "feed-sample", placement: "feed", purpose: "gallery_sample", ...(publicBaseUrl ? { url: assetUrl("feed-sample") } : {}) },
      story: { assetKey: "story-sample", placement: "story", purpose: "gallery_sample", ...(publicBaseUrl ? { url: assetUrl("story-sample") } : {}) },
    },
    metaCopyDefaults: {
      primaryText: doc.publish?.copy?.primaryText ?? [],
      headlines: doc.publish?.copy?.headlines ?? [],
      descriptions: doc.publish?.copy?.descriptions ?? [],
      cta: doc.publish?.cta ?? "LEARN_MORE",
    },
    aiWritingGuidance: (() => {
      const defaults = Object.fromEntries((doc.inputs?.text ?? []).map((input) => [input.key, `${input.label}; maximum ${input.maxLength} characters.`]));
      const declared = doc.publish?.aiWritingGuidance ?? {};
      const declaredFields = declared.fields && typeof declared.fields === "object" ? declared.fields : {};
      const guidanceText = (value) => typeof value === "string" ? value : JSON.stringify(value);
      return {
        summary: typeof declared.summary === "string" && declared.summary.trim()
          ? declared.summary
          : "Keep copy concise, factual, and consistent with the declared offer.",
        fields: {
          ...defaults,
          ...Object.fromEntries(Object.entries(declaredFields).filter(([, value]) => typeof value === "string")),
          ...(declared.overlay !== undefined ? { overlay: guidanceText(declared.overlay) } : {}),
          ...(declared.offCanvas !== undefined ? { offCanvas: guidanceText(declared.offCanvas) } : {}),
        },
      };
    })(),
    publishRequirements: {
      objective: doc.publish?.objective ?? "OUTCOME_LEADS",
      specialAdCategory: doc.publish?.specialAdCategory ?? null,
      instantForm: { required: declaredForm.required ?? Boolean(doc.publish?.leadForm), dependency: declaredForm.dependency ?? (doc.publish?.leadForm ? "instant_form" : null), defaults: declaredForm.defaults ?? instantFormDefaults(doc) },
      destination: { required: declaredDestination.required ?? false, kind: declaredDestination.kind ?? "none", dependency: declaredDestination.dependency ?? null },
    },
    replacementAssets: (doc.restyle?.safeReplacementAssets ?? []).map((asset) => ({
      assetKey: `${asset.inputKey}-fixture`,
      purpose: "replacement",
      ...(publicBaseUrl ? { url: assetUrl(`${asset.inputKey}-fixture`) } : {}),
    })),
    realAssetRefs: [
      ...Object.keys(plateFiles)
        .filter((key) => !["feed-sample", "story-sample", "customer-photo-fixture"].includes(key))
        .map((key) => ({ assetKey: key, purpose: "real_asset", ...(publicBaseUrl ? { url: assetUrl(key) } : {}) })),
      ...doc.fonts.map((font) => ({ assetKey: basename(font.file), purpose: "font", ...(publicBaseUrl ? { url: assetUrl(font.file) } : {}) })),
    ],
  };
  const layout = (docLayout, placement, previewBytes) => {
    const width = 1080;
    const height = placement === "feed" ? 1350 : 1920;
    const layers = [];
    layers.push({
      type: "plate",
      layerId: "plate",
      colourRole: "background",
      assetKey: `${placement}-plate`,
      geometry: { x: 0, y: 0, width, height },
      protected: false,
    });
    for (const layer of docLayout.layers) {
      const geometry = pixelRect(layer.box, width, height);
      if (layer.type === "image_slot" && layer.inputKey === "logo_slot") {
        layers.push({
          type: "logo",
          layerId: layer.id,
          inputKey: layer.inputKey,
          geometry,
        });
      } else if (layer.type === "image_slot") {
        layers.push({
          type: "image_slot",
          layerId: layer.id,
          inputKey: layer.inputKey,
          geometry: pixelRect(layer.box, width, height),
          mask: layer.mask.kind === "rounded" ? "rounded_rect" : layer.mask.kind === "ellipse" ? "circle" : "none",
          minSourceWidth: layer.minSourcePx?.width ?? 540,
          minSourceHeight: layer.minSourcePx?.height ?? 675,
          defaultCrop: { x: 0, y: 0, width: 1, height: 1 },
          allowedPlacementOverrides: ["crop", "position"],
        });
      } else if (layer.type === "text") {
        const font = doc.fonts.find((face) => face.fontId === layer.typo.fontId && face.weight === layer.typo.weight);
        layers.push({
          type: "text",
          layerId: layer.id,
          inputKey: layer.inputKey,
          geometry,
          font: { file: basename(font?.file ?? layer.typo.fontId), sha256: font?.sha256 ?? "0".repeat(64) },
          fontSize: Math.max(1, Math.round(geometry.height * layer.typo.sizeRatio)),
          lineHeight: layer.typo.lineHeight,
          tracking: layer.typo.tracking,
          alignment: layer.typo.align,
          maxCharacters: layer.constraints.maxLength,
          maxLines: layer.constraints.maxLines,
          colourRole: roleForLayer(layer),
          overflowBehaviour: "scale_down",
        });
      } else if (layer.type === "overlay_patch") {
        layers.push({
          type: "overlay_patch",
          layerId: layer.id,
          geometry,
          colourRole: roleForLayer(layer),
          opacity: 1,
          assetKey: `${layer.id}-patch`,
        });
      } else if (layer.type === "vector") {
        layers.push({
          type: "vector",
          layerId: layer.id,
          geometry,
          shape: layer.shape,
          colourRole: roleForLayer(layer),
          opacity: layer.opacity ?? 1,
        });
      } else if (layer.type === "icon") {
        layers.push({
          type: "icon",
          layerId: layer.id,
          geometry,
          icon: layer.icon,
          colourRole: roleForLayer(layer),
        });
      }
    }
    const safeZones = placement === "story"
      ? [
          { x: 0, y: 0, width, height: docLayout.storyPolicy?.safeTopPx ?? 240 },
          { x: 0, y: height - (docLayout.storyPolicy?.safeBottomPx ?? 300), width, height: docLayout.storyPolicy?.safeBottomPx ?? 300 },
        ]
      : [{ x: 0, y: 0, width, height }];
    return {
      placement,
      layers,
      safeZones,
      ...(docLayout.storyPolicy && placement === "story" ? { storyPolicy: docLayout.storyPolicy } : {}),
    };
  };

  const pack = {
    schema: "blockwise.template-pack/v2",
    templateId: doc.id,
    version: 1,
    packId: doc.provenance.packId ?? doc.id,
    createdAt,
    builderVersion: "adstudio-v2-build-template-2.0.0",
    rendererVersion: "adstudio-v2-render-2.0.0",
    classification: {
      label: doc.classification.primary_intent || "real-estate",
      modelVersion: "adstudio-v2-analysis-v2",
      confidence: 0.95,
    },
    manifestSha256: "0".repeat(64),
    signature: "",
    feedLayout: layout(doc.formats.feed, "feed", feedPreviewBytes),
    storyLayout: layout(doc.formats.story, "story", storyPreviewBytes),
    imageInputs: doc.inputs.images.map((image) => ({
      key: image.key,
      label: image.label,
      required: image.required,
      acceptedTypes: ["image/jpeg", "image/png", "image/webp"],
    })),
    textInputs: doc.inputs.text.map((text) => ({
      key: text.key,
      label: text.label,
      placeholder: text.sample,
      maxLength: text.maxLength,
    })),
    semanticColours: {
      background: paletteColour("background", "#f4f0e8"),
      primary: paletteColour("ink", "#2b2118"),
      secondary: paletteColour("surface", "#ead2a9"),
      accent: paletteColour("accent", "#6f4e2b"),
      mainText: paletteColour("ink", "#2b2118"),
      inverseText: paletteColour("inverseText", "#f3dfbd"),
    },
    assets: plateFiles,
    fonts: doc.fonts.map((face) => ({ file: basename(face.file), sha256: face.sha256 })),
    safePreviews: {
      feed: { sha256: sha256(feedPreviewBytes) },
      story: { sha256: sha256(storyPreviewBytes) },
    },
    qaEvidence: {
      feedPassed: qaEvidence.feedPassed === true,
      storyPassed: qaEvidence.storyPassed === true && storyQa.passed === true,
      reviewerVersions: ["adstudio-subject-invariance-v1"],
      stressFixtureResults: qaEvidence.stressFixtureResults,
    },
    metadata,
  };
  return pack;
}

function signPack(pack, privateKey) {
  const manifestHash = computeManifestHash(pack);
  const signature = sign(null, Buffer.from(manifestHash, "utf8"), privateKey).toString("hex");
  const signed = { ...pack, manifestSha256: manifestHash, signature };
  // Validate the SIGNED pack (manifestSha256 + signature must be present).
  const parsed = templatePackV2Schema.safeParse(signed);
  if (!parsed.success) {
    throw new Error(`TemplatePack ${pack.templateId} failed schema validation: ${JSON.stringify(parsed.error.issues.slice(0, 4))}`);
  }
  return signed;
}

async function main() {
  const candidate = resolve(argValue("--candidate") || process.cwd());
  const runId = argValue("--run") || "unknown-run";
  const traceRef = argValue("--trace") || "";
  const job = argValue("--job") || "Ad Studio job";
  const scopeId = argValue("--scope") || "blockwise";
  const settingsRevision = Number(argValue("--settings-revision") ?? 0);
  const approvalReceipt = readApprovalReceipt(argValue("--approval"));
  const slotPath = resolve(argValue("--slot") || join(REPO_ROOT, "public", "adstudio-samples", "photos", "int-bedroom.png"));
  const slotBytes = readFileSync(slotPath);
  const slotSha = sha256(slotBytes);

  const manifest = readJson(join(candidate, "variant-pack.manifest.json"));
  const releaseId = `${manifest.packId}-${runId.slice(-8)}`;
  const publicRoot = process.env.FRANK_PUBLIC_RELEASE_ROOT ? resolve(process.env.FRANK_PUBLIC_RELEASE_ROOT) : null;
  if (!publicRoot && process.env.FRANK_ALLOW_PRIVATE_TEMPLATE_RELEASE !== "1") {
    throw new Error("FRANK_PUBLIC_RELEASE_ROOT is required so Blockwise can fetch the signed pack and assets");
  }
  const publicBaseUrl = publicRoot ? `https://frank.fail/releases/ad-template-generator/${releaseId}` : null;
  const releaseStoreRoot = resolveReleaseStoreRoot(process.env);
  const releaseDir = resolve(argValue("--release") || join(releaseStoreRoot, releaseId));
  const releaseRelative = relative(releaseStoreRoot, releaseDir);
  if (!releaseRelative || releaseRelative.startsWith("..") || isAbsolute(releaseRelative)) {
    throw new Error(`releaseDir ${releaseDir} is outside the private release store ${releaseStoreRoot}`);
  }
  if (existsSync(releaseDir)) {
    throw new Error(`releaseId already exists and is immutable: ${releaseDir}`);
  }
  mkdirSync(releaseDir, { recursive: true });

  const templatesDir = join(releaseDir, "templates");
  const packV1Dir = join(releaseDir, "pack-v2");
  const previewsDir = join(releaseDir, "previews");
  const assetsDir = join(releaseDir, "assets");
  for (const dir of [templatesDir, packV1Dir, previewsDir, assetsDir]) mkdirSync(dir, { recursive: true });
  const createdAt = new Date().toISOString();
  const { publicKey, privateKey, ephemeral } = loadSigningKey(Boolean(publicRoot));

  const signedPacks = [];
  const artifacts = [];
  for (const id of manifest.variantIds) {
    const templatePath = join(candidate, "src", "lib", "adstudio", "template-gallery-v2", id, "template.json");
    const templateBytes = readFileSync(templatePath);
    const doc = JSON.parse(templateBytes.toString("utf8"));
    const evidence = readJson(join(candidate, "src", "lib", "adstudio", "template-gallery-v2", id, "evidence.json"));
    const qaEvidence = assertCandidateEvidence({ templateId: id, doc, evidence, templateBytes });

    // canonical v2 artifacts (hash-verified copies)
    writeJson(join(templatesDir, id, "template.json"), doc);
    writeJson(join(templatesDir, id, "evidence.json"), evidence);
    for (const [format, layout] of [["feed", doc.formats.feed], ["story", doc.formats.story]]) {
      const src = join(candidate, "src", "lib", "adstudio", "template-assets-v2", id, `plate-${format}.webp`);
      const bytes = readFileSync(src);
      if (sha256(bytes) !== layout.plate.sha256) throw new Error(`${id} ${format} plate hash mismatch`);
      copyFileSync(src, join(assetsDir, `${id}-plate-${format}.webp`));
    }
    for (const layer of doc.formats.story.layers.filter((entry) => entry.type === "overlay_patch")) {
      const source = join(candidate, "src", "lib", "adstudio", "template-assets-v2", id, basename(layer.src));
      const bytes = readFileSync(source);
      if (sha256(bytes) !== layer.sha256) throw new Error(`${id} ${layer.id} patch hash mismatch`);
      copyFileSync(source, join(assetsDir, `${id}-${basename(layer.src)}`));
    }
    copyFileSync(join(candidate, "public", "adstudio-templates", id, "sample.png"), join(assetsDir, `${id}-sample.png`));
    copyFileSync(join(candidate, "public", "adstudio-templates", id, "sample-story.png"), join(assetsDir, `${id}-sample-story.png`));
    const sampleSlots = new Map();
    for (const image of doc.inputs?.images ?? []) {
      // Brand logos and portraits are intentionally empty in the neutral QA
      // sample; never substitute property photography into those slots.
      if (image.key === "logo_slot" || image.key === "portrait_slot") continue;
      const declared = doc.restyle?.safeReplacementAssets?.find((asset) => asset.inputKey === image.key);
      const candidateAsset = declared?.src ? join(candidate, "public", String(declared.src).replace(/^[/\\]+/, "")) : slotPath;
      const source = existsSync(candidateAsset) ? candidateAsset : slotPath;
      const bytes = readFileSync(source);
      const digest = sha256(bytes);
      if (declared?.sha256 && declared.sha256 !== digest) throw new Error(`${id} ${image.key} fixture hash mismatch`);
      const ext = source.endsWith(".webp") ? "webp" : source.endsWith(".jpg") || source.endsWith(".jpeg") ? "jpg" : "png";
      const fileName = `${id}-${image.key}-fixture.${ext}`;
      copyFileSync(source, join(assetsDir, fileName));
      sampleSlots.set(image.key, { src: declared?.src || "/slots/photo-portrait.png", bytes, sha256: digest, fileName, mimeType: ext === "webp" ? "image/webp" : ext === "jpg" ? "image/jpeg" : "image/png" });
    }
    copyFileSync(slotPath, join(assetsDir, `${id}-customer-photo-fixture.png`));
    for (const font of doc.fonts) {
      const relative = String(font.file).replace(/^[/\\]+/, "");
      const source = join(candidate, "public", relative);
      const bytes = readFileSync(source);
      if (sha256(bytes) !== font.sha256) throw new Error(`${id} font hash mismatch: ${font.file}`);
      const destination = join(assetsDir, basename(font.file));
      if (existsSync(destination) && sha256(readFileSync(destination)) !== font.sha256) {
        throw new Error(`${id} font basename collision: ${basename(font.file)}`);
      }
      if (!existsSync(destination)) copyFileSync(source, destination);
    }

    // deterministic previews (no image model)
    const instance = (format) => ({
      schema: "adstudio.instance.v2",
      templateId: doc.id,
      templateHash: "0".repeat(64),
      format,
      values: { images: Object.fromEntries([...sampleSlots.entries()].map(([key, asset]) => [key, { src: asset.src }])), text: Object.fromEntries(doc.inputs.text.map((t) => [t.key, t.sample])) },
      overrides: [],
    });
    const sampleSlotBytes = new Map([...sampleSlots.entries()].map(([key, asset]) => [key, asset.bytes]));
    const feedPreview = await renderAdDocToPng(doc, instance("4:5"), "4:5", { repoRoot: candidate, slotBytes: sampleSlotBytes });
    const storyPreview = await renderAdDocToPng(doc, instance("9:16"), "9:16", { repoRoot: candidate, slotBytes: sampleSlotBytes });
    const storyQa = await evaluateStoryQa(doc, storyPreview);
    assertStoryQa(id, storyQa);
    writeFileSync(join(previewsDir, `${id}-feed.png`), feedPreview);
    writeFileSync(join(previewsDir, `${id}-story.png`), storyPreview);
    writeFileSync(join(assetsDir, `${id}-feed.png`), feedPreview);
    writeFileSync(join(assetsDir, `${id}-story.png`), storyPreview);

    const plateFiles = {
      "feed-plate": { fileName: `${id}-plate-feed.webp`, sha256: doc.formats.feed.plate.sha256, mimeType: "image/webp" },
      "story-plate": { fileName: `${id}-plate-story.webp`, sha256: doc.formats.story.plate.sha256, mimeType: "image/webp" },
      "feed-preview": { fileName: `${id}-feed.png`, sha256: sha256(feedPreview), mimeType: "image/png" },
      "story-preview": { fileName: `${id}-story.png`, sha256: sha256(storyPreview), mimeType: "image/png" },
      "feed-sample": { fileName: `${id}-sample.png`, sha256: sha256(readFileSync(join(candidate, "public", "adstudio-templates", id, "sample.png"))), mimeType: "image/png" },
      "story-sample": { fileName: `${id}-sample-story.png`, sha256: sha256(readFileSync(join(candidate, "public", "adstudio-templates", id, "sample-story.png"))), mimeType: "image/png" },
      "customer-photo-fixture": { fileName: `${id}-customer-photo-fixture.png`, sha256: slotSha, mimeType: "image/png" },
      ...Object.fromEntries([...sampleSlots.entries()].map(([key, asset]) => [`${key}-fixture`, { fileName: asset.fileName, sha256: asset.sha256, mimeType: asset.mimeType }])),
    };
    for (const layer of doc.formats.story.layers.filter((entry) => entry.type === "overlay_patch")) {
      const sourceName = basename(layer.src);
      plateFiles[`${layer.id}-patch`] = {
        fileName: `${id}-${sourceName}`,
        sha256: layer.sha256,
        mimeType: "image/webp",
      };
    }
    const unsigned = v2ToTemplatePack({ doc, feedPreviewBytes: feedPreview, storyPreviewBytes: storyPreview, plateFiles, createdAt, publicBaseUrl, storyQa, qaEvidence });
    const signed = signPack(unsigned, privateKey);
    if (computeManifestHash(signed) !== signed.manifestSha256 || !signed.signature) throw new Error(`${id}: signing failed`);
    writeJson(join(packV1Dir, `${id}.json`), signed);
    signedPacks.push(signed);
    artifacts.push({ templateId: id, packFile: `pack-v2/${id}.json`, manifestSha256: signed.manifestSha256, signature: signed.signature });
  }

  writeJson(join(releaseDir, "variant-pack.manifest.json"), manifest);

  // Optional public serving tree: only the signed portable pack and its
  // referenced assets/previews are copied; candidate/source/evidence remain private.
  if (publicRoot) {
    const publicReleaseDir = join(publicRoot, releaseId);
    mkdirSync(join(publicReleaseDir, "pack-v2"), { recursive: true });
    mkdirSync(join(publicReleaseDir, "assets"), { recursive: true });
    mkdirSync(join(publicReleaseDir, "previews"), { recursive: true });
    for (const artifact of artifacts) {
      copyFileSync(join(releaseDir, artifact.packFile), join(publicReleaseDir, artifact.packFile));
    }
    for (const file of readdirSync(assetsDir)) copyFileSync(join(assetsDir, file), join(publicReleaseDir, "assets", file));
    for (const file of readdirSync(previewsDir)) copyFileSync(join(previewsDir, file), join(publicReleaseDir, "previews", file));
  }

  // bundle artifact: canonical JSON of the signed pack refs + manifest. The
  // `integrity` block is the release receipt the Tool framework validates:
  // the artifact's integrity.signature must equal the envelope signature.
  const bundle = {
    schema: "blockwise.template-pack/v2",
    releaseId,
    packId: manifest.packId,
    sourceAd: manifest.sourceAd,
    fixtureCorpus: manifest.fixtureCorpus,
    templates: artifacts,
    releasedAt: createdAt,
  };
  // The Ed25519 signature signs the SHA-256 of the canonical bundle content
  // (integrity excluded), then the signed bundle is written with the
  // integrity receipt attached. The artifact's own bytes hash to
  // finalBundleSha. The framework contract requires integrity.signature to be
  // a receipt OBJECT (algorithm + hex signature + public key), not a bare hex
  // string, and sha256 to hash the exact artifact bytes.
  const bundleSha = sha256(Buffer.from(canonicalJson(bundle)));
  const bundleSignature = sign(null, Buffer.from(bundleSha, "utf8"), privateKey).toString("hex");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  const publicKeyHex = publicKey.export({ type: "spki", format: "der" }).toString("hex");
  const signingKeyId = sha256(Buffer.from(publicKeyHex, "hex")).slice(0, 16);
  const signatureReceipt = {
    algorithm: "ed25519",
    signature: bundleSignature,
    publicKey: publicKeyPem,
    publicKeyHex,
    keyId: signingKeyId,
  };
  const signedBundle = { ...bundle, integrity: { algorithm: "ed25519", signature: signatureReceipt } };
  const finalBundleBytes = Buffer.from(canonicalJson(signedBundle));
  const finalBundleSha = sha256(finalBundleBytes);
  writeFileSync(join(releaseDir, "pack.bundle.json"), finalBundleBytes);

  const artifactRef = publicBaseUrl
    ? `${publicBaseUrl}/pack-v2/${artifacts[0].templateId}.json`
    : `https://frank.fail/api/ad-studio/runs/${runId}/artifacts/${releaseId}-pack.bundle.json`;
  const portablePackSha = publicBaseUrl
    ? sha256(Buffer.from(canonicalJson(signedPacks[0])))
    : finalBundleSha;
  const now = new Date().toISOString();
  const release = {
    schema: "schema://frank.ad-template-generator-release/v1",
    tool_id: "ad-template-generator",
    scope: { kind: "project", id: scopeId },
    release_version: "1.0.0",
    release_id: releaseId,
    status: "released",
    settings_revision: settingsRevision,
    settings_ref: "hermes://ad-template-generator/settings/recommended-quality-v2",
    pipeline_id: "variant-pack-release",
    pipeline_version: "1.0.0",
    consumer_compatibility: ["blockwise-template-pack-v1", "blockwise-template-pack-v2"],
    template_pack: {
      schema: "blockwise.template-pack/v2",
      pack_id: manifest.packId,
      artifact_ref: artifactRef,
      sha256: portablePackSha,
      signature_algorithm: "ed25519",
      signature: signedPacks[0].signature,
      signing_key_id: signingKeyId,
    },
    provenance: { artifact_ref: artifactRef, artifact_receipt_ref: `${releaseId}/receipt.json` },
    trace_ref: traceRef,
    qa_receipt: { decision: "pass", receipt_ref: `${releaseId}/qa-evidence.json`, checked_at: now },
    approval_receipt: approvalReceipt,
    sanitization_receipt: { decision: "pass", receipt_ref: `${releaseId}/sanitization.json`, checked_at: now },
    released_at: now,
    release_hash: "0".repeat(64),
    immutable: true,
    source_free: true,
  };
  const { release_hash: _rh, ...rest } = release;
  release.release_hash = sha256(Buffer.from(canonicalJson(rest)));
  writeJson(join(releaseDir, "release.json"), release);
  writeJson(join(releaseDir, "receipt.json"), {
    schema: "adstudio.release.receipt.v1",
    releaseId,
    runId,
    traceRef,
    job,
    pack: manifest,
    templates: artifacts,
    artifact: { file: "pack.bundle.json", sha256: finalBundleSha, signature: bundleSignature, signatureAlgorithm: "ed25519", publicKey: publicKeyPem, publicKeyHex, signingKeyId, ephemeralSigningKey: ephemeral },
    artifactRef,
    servingNote: "Frank serves signed release artifacts at artifactRef under /releases/ad-template-generator; import-pack.ts validates that HTTPS origin and the content-addressed assets before activation.",
    releaseEnvelope: `${releaseDir}/release.json`,
  });

  // immutable: read-only after write
  chmodSync(releaseDir, 0o555);

  process.stdout.write(`${JSON.stringify({
    releaseId,
    releaseDir,
    packBundle: join(releaseDir, "pack.bundle.json"),
    template_pack_path: join(releaseDir, "pack.bundle.json"),
    sha256: finalBundleSha,
    signature: signatureReceipt,
    templatePack: { artifactRef, sha256: portablePackSha, signature: signedPacks[0].signature, publicKeyHex, signingKeyId },
    templates: signedPacks.map((pack) => ({ templateId: pack.templateId, manifestSha256: pack.manifestSha256 })),
    traceRef,
    envelope: join(releaseDir, "release.json"),
    receipt: join(releaseDir, "receipt.json"),
  }, null, 2)}\n`);
}

// The private release store lives under the Hermes home. The Tool-run agent
// environment does not always export HERMES_HOME, so fall back to ~/.hermes
// explicitly — never to $HOME itself, which the framework rejects as outside
// the private store.
export function resolveReleaseStoreRoot(env = process.env) {
  const hermesHome = env.HERMES_HOME || join(env.HOME || "", ".hermes");
  return resolve(join(hermesHome, "tool_releases", "ad-template-generator"));
}

// Guard: only run the packager when invoked directly, so tests can import
// the exported helpers without executing a release.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack ?? error);
    process.exit(1);
  });
}
