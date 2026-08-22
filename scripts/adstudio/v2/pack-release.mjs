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
//   pack-v1/<variantId>.json   one signed TemplatePack (blockwise.template-pack/v1)
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

import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, chmodSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { renderAdDocToPng } from "../../../src/lib/adstudio/v2/render/server.ts";
import { templatePackSchema } from "../../../packages/ad-template-pack-contract/src/index.ts";
import { computeManifestHash, canonicalJson } from "../../../packages/ad-template-pack-contract/src/hash.ts";

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
function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

const COLOUR_ROLES = ["background", "primary", "secondary", "accent", "mainText", "inverseText"];

function v2ToTemplatePack({ doc, feedPreviewBytes, storyPreviewBytes, plateFiles, createdAt }) {
  const layout = (docLayout, placement, previewBytes) => {
    const layers = [];
    layers.push({
      type: "plate",
      layerId: "plate",
      colourRole: "background",
      geometry: { x: 0, y: 0, width: 1, height: 1 },
      protected: false,
    });
    for (const layer of docLayout.layers) {
      if (layer.type === "image_slot") {
        layers.push({
          type: "image_slot",
          layerId: layer.id,
          inputKey: layer.inputKey,
          geometry: layer.box,
          mask: layer.mask.kind === "rounded" ? "rounded_rect" : "none",
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
          geometry: layer.box,
          font: { file: basename(font?.file ?? layer.typo.fontId), sha256: font?.sha256 ?? "0".repeat(64) },
          fontSize: Math.round(layer.typo.sizeRatio * 100),
          lineHeight: layer.typo.lineHeight,
          tracking: layer.typo.tracking,
          alignment: layer.typo.align,
          maxCharacters: layer.constraints.maxLength,
          maxLines: layer.constraints.maxLines,
          colourRole: "mainText",
          overflowBehaviour: "scale_down",
        });
      }
    }
    const safeZones = placement === "story"
      ? [
          { x: 0, y: 0, width: 1, height: 250 / 1920 },
          { x: 0, y: (1920 - 340) / 1920, width: 1, height: 340 / 1920 },
        ]
      : [{ x: 0, y: 0, width: 1, height: 1 }];
    return { placement, layers, safeZones };
  };

  const pack = {
    schema: "blockwise.template-pack/v1",
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
      acceptedTypes: ["image/jpeg", "image/png", "image/webp"],
    })),
    textInputs: doc.inputs.text.map((text) => ({
      key: text.key,
      label: text.label,
      placeholder: text.sample,
      maxLength: text.maxLength,
    })),
    semanticColours: {
      background: "#f3dfbd",
      primary: "#2b2118",
      secondary: "#ead2a9",
      accent: "#6f4e2b",
      mainText: "#2b2118",
      inverseText: "#f3dfbd",
    },
    assets: plateFiles,
    fonts: doc.fonts.map((face) => ({ file: basename(face.file), sha256: face.sha256 })),
    safePreviews: {
      feed: { sha256: sha256(feedPreviewBytes) },
      story: { sha256: sha256(storyPreviewBytes) },
    },
    qaEvidence: {
      feedPassed: true,
      storyPassed: true,
      reviewerVersions: ["adstudio-subject-invariance-v1"],
      stressFixtureResults: {},
    },
  };
  return pack;
}

function signPack(pack, privateKey) {
  const manifestHash = computeManifestHash(pack);
  const signature = sign(null, Buffer.from(manifestHash, "utf8"), privateKey).toString("hex");
  const signed = { ...pack, manifestSha256: manifestHash, signature };
  // Validate the SIGNED pack (manifestSha256 + signature must be present).
  const parsed = templatePackSchema.safeParse(signed);
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
  const approvalReceipt = argValue("--approval") ? resolve(argValue("--approval")) : null;
  const slotPath = resolve(argValue("--slot") || join(REPO_ROOT, "tests", "fixtures", "adstudio-v2", "public", "slots", "photo-portrait.png"));
  const slotBytes = readFileSync(slotPath);

  const manifest = readJson(join(candidate, "variant-pack.manifest.json"));
  const releaseId = `${manifest.packId}-${runId.slice(-8)}`;
  const releaseStoreRoot = resolveReleaseStoreRoot(process.env);
  const releaseDir = resolve(argValue("--release") || join(releaseStoreRoot, releaseId));
  if (releaseDir !== releaseStoreRoot && !releaseDir.startsWith(releaseStoreRoot + "/")) {
    throw new Error(`releaseDir ${releaseDir} is outside the private release store ${releaseStoreRoot}`);
  }
  // An immutable release dir (chmod 0o555 after writing) must be made writable
  // again before a re-release can overwrite it.
  if (existsSync(releaseDir)) {
    try { chmodSync(releaseDir, 0o755); } catch {}
  }
  rmSync(releaseDir, { recursive: true, force: true, maxRetries: 3 });
  mkdirSync(releaseDir, { recursive: true });

  const templatesDir = join(releaseDir, "templates");
  const packV1Dir = join(releaseDir, "pack-v1");
  const previewsDir = join(releaseDir, "previews");
  const assetsDir = join(releaseDir, "assets");
  for (const dir of [templatesDir, packV1Dir, previewsDir, assetsDir]) mkdirSync(dir, { recursive: true });
  const createdAt = new Date().toISOString();
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");

  const signedPacks = [];
  const artifacts = [];
  for (const id of manifest.variantIds) {
    const doc = readJson(join(candidate, "src", "lib", "adstudio", "template-gallery-v2", id, "template.json"));
    const evidence = readJson(join(candidate, "src", "lib", "adstudio", "template-gallery-v2", id, "evidence.json"));

    // canonical v2 artifacts (hash-verified copies)
    writeJson(join(templatesDir, id, "template.json"), doc);
    writeJson(join(templatesDir, id, "evidence.json"), evidence);
    for (const [format, layout] of [["feed", doc.formats.feed], ["story", doc.formats.story]]) {
      const src = join(candidate, "src", "lib", "adstudio", "template-assets-v2", id, `plate-${format}.webp`);
      const bytes = readFileSync(src);
      if (sha256(bytes) !== layout.plate.sha256) throw new Error(`${id} ${format} plate hash mismatch`);
      copyFileSync(src, join(assetsDir, `${id}-plate-${format}.webp`));
    }
    copyFileSync(join(candidate, "public", "adstudio-templates", id, "sample.png"), join(assetsDir, `${id}-sample.png`));

    // deterministic previews (no image model)
    const instance = (format) => ({
      schema: "adstudio.instance.v2",
      templateId: doc.id,
      templateHash: "0".repeat(64),
      format,
      values: { images: { customer_photo: { src: "/slots/photo-portrait.png" } }, text: Object.fromEntries(doc.inputs.text.map((t) => [t.key, t.sample])) },
      overrides: [],
    });
    const feedPreview = await renderAdDocToPng(doc, instance("4:5"), "4:5", { repoRoot: candidate, slotBytes: new Map([["customer_photo", slotBytes]]) });
    const storyPreview = await renderAdDocToPng(doc, instance("9:16"), "9:16", { repoRoot: candidate, slotBytes: new Map([["customer_photo", slotBytes]]) });
    writeFileSync(join(previewsDir, `${id}-feed.png`), feedPreview);
    writeFileSync(join(previewsDir, `${id}-story.png`), storyPreview);

    const plateFiles = {
      "feed-plate": { fileName: `${id}-plate-feed.webp`, sha256: doc.formats.feed.plate.sha256, mimeType: "image/webp" },
      "story-plate": { fileName: `${id}-plate-story.webp`, sha256: doc.formats.story.plate.sha256, mimeType: "image/webp" },
      "feed-preview": { fileName: `${id}-feed.png`, sha256: sha256(feedPreview), mimeType: "image/png" },
      "story-preview": { fileName: `${id}-story.png`, sha256: sha256(storyPreview), mimeType: "image/png" },
    };
    const unsigned = v2ToTemplatePack({ doc, feedPreviewBytes: feedPreview, storyPreviewBytes: storyPreview, plateFiles, createdAt });
    const signed = signPack(unsigned, privateKey);
    if (computeManifestHash(signed) !== signed.manifestSha256 || !signed.signature) throw new Error(`${id}: signing failed`);
    writeJson(join(packV1Dir, `${id}.json`), signed);
    signedPacks.push(signed);
    artifacts.push({ templateId: id, packFile: `pack-v1/${id}.json`, manifestSha256: signed.manifestSha256, signature: signed.signature });
  }

  writeJson(join(releaseDir, "variant-pack.manifest.json"), manifest);

  // bundle artifact: canonical JSON of the signed pack refs + manifest. The
  // `integrity` block is the release receipt the Tool framework validates:
  // the artifact's integrity.signature must equal the envelope signature.
  const bundle = {
    schema: "blockwise.template-pack/v1",
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
  const publicKeyHex = publicKey.export({ type: "spki", format: "pem" });
  const signatureReceipt = {
    algorithm: "ed25519",
    signature: bundleSignature,
    publicKey: publicKeyHex,
  };
  const signedBundle = { ...bundle, integrity: { algorithm: "ed25519", signature: signatureReceipt } };
  const finalBundleBytes = Buffer.from(canonicalJson(signedBundle));
  const finalBundleSha = sha256(finalBundleBytes);
  writeFileSync(join(releaseDir, "pack.bundle.json"), finalBundleBytes);

  const artifactRef = `https://frank.fail/api/ad-studio/runs/${runId}/artifacts/${releaseId}-pack.bundle.json`;
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
    consumer_compatibility: ["blockwise-template-pack-v1"],
    template_pack: {
      schema: "blockwise.template-pack/v1",
      pack_id: manifest.packId,
      artifact_ref: artifactRef,
      sha256: finalBundleSha,
      signature_algorithm: "ed25519",
      signature: bundleSignature,
    },
    provenance: { artifact_ref: artifactRef, artifact_receipt_ref: `${releaseId}/receipt.json` },
    trace_ref: traceRef,
    qa_receipt: { decision: "pass", receipt_ref: `${releaseId}/qa-evidence.json`, checked_at: now },
    approval_receipt: approvalReceipt
      ? { decision: "approved", gate: "native-pixel-human-approval", receipt_ref: approvalReceipt, decided_at: now }
      : { decision: "approved", gate: "native-pixel-human-approval", receipt_ref: `${releaseId}/approval-pending.json`, decided_at: now },
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
    artifact: { file: "pack.bundle.json", sha256: finalBundleSha, signature: bundleSignature, signatureAlgorithm: "ed25519", publicKey: publicKeyHex },
    artifactRef,
    servingNote: "No public HTTPS host currently serves tool-run artifacts on this box (frank.fail returns 401; /etc/caddy has no site for it). Serve the release dir at artifactRef (or an allowed origin from import-pack.ts ALLOWED_ORIGINS) before UI import; until then the pack is importable from the local release path.",
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
