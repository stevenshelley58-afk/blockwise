#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import {
  assertPassingQa,
  inspectEvidence,
  recordReview,
  releasableStageEvidence,
} from "./template-quality.mjs";
import {
  MIN_AD_SYSTEM_LIKENESS,
  MIN_STANDALONE_AD_QUALITY,
  SUBJECT_INVARIANT_RUBRIC_VERSION,
} from "./local-template-adapter.mjs";

const root = process.cwd();
const args = parseArgs(process.argv.slice(2));
const importDir = insideImportedRelease(required("import-dir"));
const preparedPath = requiredPath("template");
const customerPacketPath = requiredPath("customer-packet");
const customerCandidatePath = requiredPath("customer-candidate");
const customerReviewPath = requiredPath("customer-review");
const importedManifest = readJson(resolve(importDir, "manifest.json"));
const importedSamplePath = resolve(importDir, "sample.png");
const factoryPackage = readJson(resolve(importDir, "factory-evidence.json"));
const prepared = readJson(preparedPath);

validateFactoryPackage({ importedManifest, importedSamplePath, factoryPackage, prepared });
const qaOut = resolve(importDir, "promotion", "customer-qa");
const recorded = await recordReview({
  templatePath: preparedPath,
  packetPath: customerPacketPath,
  candidatePath: customerCandidatePath,
  review: customerReviewPath,
  out: qaOut,
  sampleOverride: importedSamplePath,
});
if (!recorded.passed) throw new Error("Independent customer-fixture review did not pass; nothing was promoted.");
const customerQa = readJson(resolve(qaOut, "qa.json"));
const customer = await inspectEvidence({
  templatePath: preparedPath,
  packetPath: customerPacketPath,
  candidatePath: customerCandidatePath,
  sampleOverride: importedSamplePath,
});
assertPassingQa(customerQa, customer);
validateIndependentCustomerFixture({ importedManifest, factoryPackage, customer });

const reviewedAt = new Date(Math.max(
  Date.parse(factoryPackage.attestation.approval.reviewedAt),
  Date.parse(customerQa.reviewedAt),
)).toISOString();
const templateContract = canonicalJson(prepared);
const templateHash = sha256(templateContract);
const promotedTemplate = { ...prepared, qualityLock: { templateHash } };
assertSourceFree(promotedTemplate);
const releaseEvidence = {
  schemaVersion: 2,
  templateId: prepared.id,
  templateHash,
  sampleHash: importedManifest.sample.contentHash,
  rubricVersion: SUBJECT_INVARIANT_RUBRIC_VERSION,
  thresholds: { adSystemLikeness: MIN_AD_SYSTEM_LIKENESS, standaloneAdQuality: MIN_STANDALONE_AD_QUALITY },
  qualifiedAt: reviewedAt,
  sample: factorySampleEvidence({ importedManifest, factoryPackage }),
  customerFixture: releasableStageEvidence(customer, customerQa),
};
assertSourceFree(releaseEvidence);

const galleryDir = resolve(root, "src", "lib", "adstudio", "template-gallery");
const templateTarget = resolve(galleryDir, `${prepared.id}.json`);
const evidenceTarget = resolve(galleryDir, "evidence", `${prepared.id}.json`);
const sampleTarget = resolve(root, "public", importedManifest.sample.imageSrc.slice(1));
const locksPath = resolve(galleryDir, "quality-locks.json");
const indexPath = resolve(galleryDir, "index.ts");
for (const path of [templateTarget, evidenceTarget, sampleTarget]) {
  if (existsSync(path)) throw new Error(`Promotion refuses to overwrite an existing gallery artifact: ${workspacePath(path)}`);
}
const previousLocks = readFileSync(locksPath);
const previousIndex = readFileSync(indexPath);
const evidenceBytes = Buffer.from(`${JSON.stringify(releaseEvidence, null, 2)}\n`, "utf8");
const locks = JSON.parse(previousLocks.toString("utf8"));
if (locks.templates?.[prepared.id]) throw new Error("Promotion refuses to replace an existing quality lock.");
locks.templates[prepared.id] = {
  templateHash,
  templateContract,
  sampleHash: importedManifest.sample.contentHash,
  evidenceHash: sha256(evidenceBytes),
  sampleLikeness: factoryPackage.qa.likenessScore,
  sampleQuality: factoryPackage.qa.qualityScore,
  customerFixtureLikeness: customerQa.visualReview.adSystemLikenessScore,
  customerFixtureQuality: customerQa.visualReview.standaloneAdQualityScore,
  qualifiedAt: reviewedAt,
};
locks.templates = Object.fromEntries(Object.entries(locks.templates).sort(([left], [right]) => left.localeCompare(right)));
const nextIndex = addGalleryImport(previousIndex.toString("utf8"), prepared.id);
const created = [templateTarget, evidenceTarget, sampleTarget];
try {
  for (const path of created) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(templateTarget, `${JSON.stringify(promotedTemplate, null, 2)}\n`, { flag: "wx" });
  writeFileSync(evidenceTarget, evidenceBytes, { flag: "wx" });
  writeFileSync(sampleTarget, readFileSync(importedSamplePath), { flag: "wx" });
  writeFileSync(locksPath, `${JSON.stringify(locks, null, 2)}\n`);
  writeFileSync(indexPath, nextIndex);
  const verification = spawnSync("npm", ["run", "verify:hard-reset"], { cwd: root, stdio: "inherit", encoding: "utf8" });
  if (verification.status !== 0) throw new Error("Hard-reset verification rejected the promotion.");
} catch (error) {
  for (const path of created) rmSync(path, { force: true });
  writeFileSync(locksPath, previousLocks);
  writeFileSync(indexPath, previousIndex);
  throw error;
}

console.log(`Promoted ${prepared.id} through the independent customer-fixture gate.`);
console.log("The gallery manifest, public sample, schema-v2 evidence, quality lock and static index are PR-ready source changes.");
console.log("Before opening the PR, run: npm run typecheck && npm run test");

function validateFactoryPackage({ importedManifest, importedSamplePath, factoryPackage, prepared }) {
  if (!existsSync(importedSamplePath) || factoryPackage?.schema !== "adstudio.template.import-package.v1") throw new Error("Imported factory package is incomplete.");
  if (canonicalJson(stripOfflineFields(prepared)) !== canonicalJson(importedManifest)) {
    throw new Error("Prepared manifest may add only offline typography and deterministic editor evidence to the attested factory manifest.");
  }
  if (prepared.qualityLock !== undefined || prepared.deterministicEditing?.status !== "ready" || !isRecord(prepared.typography)) {
    throw new Error("Prepared manifest needs complete offline deterministic editor evidence and no pre-existing quality lock.");
  }
  if (sha256(readFileSync(importedSamplePath)) !== importedManifest.sample?.contentHash
    || factoryPackage.sampleHash !== importedManifest.sample?.contentHash
    || factoryPackage.manifestHash !== canonicalHash(importedManifest)) {
    throw new Error("Imported factory manifest or sample hash is invalid.");
  }
  if (factoryPackage.candidateEvidence?.evidenceHash !== undefined
    || canonicalHash(factoryPackage.candidateEvidence) !== factoryPackage.attestation?.evidenceHash) {
    throw new Error("Imported factory candidate evidence hash is invalid.");
  }
  const approval = factoryPackage.attestation?.approval;
  const { attestationHash, ...unsignedAttestation } = factoryPackage.attestation ?? {};
  if (!approval || canonicalHash(approval) !== factoryPackage.attestation.approvalHash
    || canonicalHash(unsignedAttestation) !== attestationHash
    || factoryPackage.attestation.manifestHash !== factoryPackage.manifestHash
    || factoryPackage.attestation.evidenceHash !== canonicalHash(factoryPackage.candidateEvidence)
    || factoryPackage.attestation.qaHash !== canonicalHash(factoryPackage.qa)
    || factoryPackage.candidateEvidence.attemptsHash !== canonicalHash(factoryPackage.attempts)
    || factoryPackage.attestation.sampleHash !== factoryPackage.sampleHash
    || factoryPackage.attestation.candidateId !== factoryPackage.candidateId
    || factoryPackage.attestation.factoryJobId !== factoryPackage.factoryJobId) {
    throw new Error("Imported factory release attestation has been changed since import.");
  }
  if (factoryPackage.qa?.passed !== true || factoryPackage.qa.likenessScore < MIN_AD_SYSTEM_LIKENESS
    || factoryPackage.qa.qualityScore < MIN_STANDALONE_AD_QUALITY || factoryPackage.qa.failures?.length
    || factoryPackage.qa.excludedContentInfluencedScore !== false
    || factoryPackage.qa.identityLeakage?.length || factoryPackage.qa.defects?.length) {
    throw new Error("Factory public sample QA is below the release threshold.");
  }
  const copyChecks = new Map((factoryPackage.qa.copyChecks ?? []).map((check) => [check.key, check]));
  for (const field of importedManifest.inputs.text) {
    const check = copyChecks.get(field.key);
    if (!check || check.expected !== field.sample || check.exact !== true || visibleText(check.observed) !== visibleText(check.expected)) {
      throw new Error(`Factory public sample QA does not prove exact observed copy for ${field.key}.`);
    }
  }
  const assetChecks = new Map((factoryPackage.qa.assetChecks ?? []).map((check) => [check.key, check]));
  for (const field of importedManifest.inputs.images) {
    const check = assetChecks.get(field.key);
    if (!check || check.used !== true || check.faithful !== true || typeof check.notes !== "string") {
      throw new Error(`Factory public sample QA does not prove faithful asset use for ${field.key}.`);
    }
  }
  const stages = new Set(factoryPackage.attempts?.filter((attempt) => attempt.outcome === "pass").map((attempt) => attempt.stage));
  if (!stages.has("reference_clone") || !stages.has("visual_qa")) throw new Error("Factory paid-attempt evidence is incomplete.");
  assertPublicSourceProvenance(importedManifest.sourceAd);
  assertPublicSourceProvenance(prepared.sourceAd);
  assertSourceFree(importedManifest);
  assertSourceFree(factoryPackage);
}

function validateIndependentCustomerFixture({ importedManifest, factoryPackage, customer }) {
  if (customer.stage !== "customer_fixture" || customer.packet.references[0]?.contentHash !== importedManifest.sample.contentHash) {
    throw new Error("Independent customer fixture was not cloned from the exact imported public sample.");
  }
  const sampleCopy = Object.fromEntries(importedManifest.inputs.text.map((field) => [field.key, field.sample]));
  if (canonicalJson(customer.packet.copy) === canonicalJson(sampleCopy)) throw new Error("Independent customer fixture must use different copy.");
  for (const reference of customer.packet.references.filter((item) => item.role === "replacement_asset")) {
    if (factoryPackage.candidateEvidence.genericImageHashes?.[reference.key] === reference.contentHash) {
      throw new Error(`Independent customer fixture must use a different ${reference.key} asset.`);
    }
  }
}

function factorySampleEvidence({ importedManifest, factoryPackage }) {
  const visualAttempt = [...factoryPackage.attempts].reverse().find((attempt) => attempt.stage === "visual_qa" && attempt.outcome === "pass");
  const approval = factoryPackage.attestation.approval;
  return {
    stage: "gallery_sample",
    requestHash: factoryPackage.candidateEvidence.cloneRequestHash,
    referenceHash: factoryPackage.attestation.sourceHash,
    references: [
      { index: 1, key: "source_ad", role: "source", contentHash: factoryPackage.attestation.sourceHash },
      ...importedManifest.inputs.images.map((field, index) => ({
        index: index + 2,
        key: field.key,
        role: "replacement_asset",
        contentHash: factoryPackage.candidateEvidence.genericImageHashes[field.key],
      })),
    ],
    copy: Object.fromEntries(importedManifest.inputs.text.map((field) => [field.key, field.sample])),
    outputHash: importedManifest.sample.contentHash,
    executionTransport: "blockwise_factory",
    reviewedAt: approval.reviewedAt,
    review: {
      schemaVersion: 1,
      rubricVersion: SUBJECT_INVARIANT_RUBRIC_VERSION,
      templateId: importedManifest.id,
      requestHash: factoryPackage.candidateEvidence.cloneRequestHash,
      candidateHash: importedManifest.sample.contentHash,
      reviewer: { provider: visualAttempt.providerId, model: visualAttempt.modelRef },
      adSystemLikenessScore: factoryPackage.qa.likenessScore,
      standaloneAdQualityScore: factoryPackage.qa.qualityScore,
      excludedContentInfluencedScore: factoryPackage.qa.excludedContentInfluencedScore,
      copyChecks: factoryPackage.qa.copyChecks,
      assetChecks: factoryPackage.qa.assetChecks,
      identityLeakage: factoryPackage.qa.identityLeakage,
      defects: factoryPackage.qa.defects,
      includedRationale: "The approved factory candidate passed the image-model likeness gate and human native-source comparison.",
      qualityRationale: "The approved factory candidate passed the standalone quality gate.",
      suggestedCorrection: "",
      reviewedAt: approval.reviewedAt,
    },
  };
}

function stripOfflineFields(value) {
  const { typography: _typography, deterministicEditing: _editing, qualityLock: _lock, ...base } = value;
  return base;
}

function addGalleryImport(source, templateId) {
  if (source.includes(`"./${templateId}.json"`)) throw new Error("Static gallery index already imports this template.");
  const identifier = `factory${templateId.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join("")}`;
  const importLine = `import ${identifier} from "./${templateId}.json" with { type: "json" };\n`;
  const typeMarker = 'import type { AdStudioGalleryTemplate } from "../templates.ts";';
  if (!source.includes(typeMarker)) throw new Error("Static gallery index format is not recognized.");
  const withImport = source.replace(typeMarker, `${importLine}${typeMarker}`);
  const arrayEnd = "] as unknown as AdStudioGalleryTemplate[];";
  if (!withImport.includes(arrayEnd)) throw new Error("Static gallery index array is not recognized.");
  return withImport.replace(arrayEnd, `  ${identifier},\n${arrayEnd}`);
}

function assertSourceFree(value, key = "value") {
  if (typeof value === "string") {
    const publicAsset = /^\/(?:adstudio-samples\/meta\/[a-z0-9][a-z0-9-]*\.png|fonts\/adstudio\/[a-z0-9][a-z0-9-]*\.woff2)$/u.test(value);
    if (/^(?:data:|https?:|file:)/iu.test(value) || (value.startsWith("/") && !publicAsset) || value.includes("\\") || value.includes("..")) {
      throw new Error(`Promotion contains a private or external value at ${key}.`);
    }
    return;
  }
  if (Array.isArray(value)) { value.forEach((item, index) => assertSourceFree(item, `${key}[${index}]`)); return; }
  if (!isRecord(value)) return;
  for (const [childKey, child] of Object.entries(value)) {
    if (/^(?:sourceReference|privatePath|sourceFile|fileName|file|creativeId|bytes|dataUrl|base64|layers|recipe|versions|fonts)$/iu.test(childKey)) throw new Error(`Promotion contains forbidden field ${childKey}.`);
    assertSourceFree(child, `${key}.${childKey}`);
  }
}

function assertPublicSourceProvenance(sourceAd) {
  if (!isRecord(sourceAd)
    || Object.keys(sourceAd).length !== 2
    || !Object.hasOwn(sourceAd, "contentHash")
    || !Object.hasOwn(sourceAd, "provenance")
    || !/^[a-f0-9]{64}$/u.test(sourceAd.contentHash)
    || sourceAd.provenance !== "frank_factory") {
    throw new Error("Promotion source provenance must contain only the factory marker and SHA-256 hash.");
  }
}

function insideImportedRelease(value) {
  const path = resolve(value);
  const relativePath = workspacePath(path);
  if (!/^artifacts\/adstudio-template-imports\/[a-f0-9-]+$/iu.test(relativePath)) throw new Error("--import-dir must be one exact imported release directory.");
  return path;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    if (!key?.startsWith("--") || !values[index + 1]?.trim()) throw new Error("Expected --name value arguments.");
    parsed[key.slice(2)] = values[index + 1];
  }
  return parsed;
}

function required(name) {
  const value = args[name];
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
}

function requiredPath(name) {
  const path = resolve(required(name));
  if (!existsSync(path)) throw new Error(`File not found for --${name}: ${path}`);
  return path;
}

function readJson(path) {
  if (!existsSync(path)) throw new Error(`Required promotion artifact is missing: ${workspacePath(path)}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function canonicalHash(value) { return sha256(canonicalJson(value)); }
function visibleText(value) { return String(value ?? "").trim().replace(/\s+/gu, " "); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function isRecord(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function workspacePath(path) { const value = relative(root, resolve(path)).split(sep).join("/"); if (!value || value === ".." || value.startsWith("../")) throw new Error("Path must stay inside the workspace."); return value; }
