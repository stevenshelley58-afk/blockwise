#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

import { createSupabaseServerClient } from "../lib/supabase-server-credential.mjs";

const BUCKET = "adstudio-template-factory";
const RELEASE_SCHEMA = "adstudio.template.release-bundle.v1";
const EVIDENCE_SCHEMA = "adstudio.template.candidate-evidence.v1";
const ATTESTATION_SCHEMA = "adstudio.template.release-attestation.v1";
const releaseId = String(process.argv[2] ?? "").trim();
const factoryCellId = clean(process.env.FRANK_FACTORY_CELL_ID);
const supabaseUrl = clean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);

if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(releaseId)) {
  throw new Error("Usage: node scripts/adstudio/import-factory-release.mjs <release-uuid>");
}
if (!factoryCellId || !supabaseUrl) throw new Error("FRANK_FACTORY_CELL_ID and SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) are required.");

const service = createSupabaseServerClient(createClient, supabaseUrl, process.env, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data: release, error: releaseError } = await service.from("adstudio_template_factory_releases")
  .select("id,factory_job_id,candidate_id,manifest_hash,attestation_hash,sample_hash,bundle_hash,storage_path")
  .eq("factory_cell_id", factoryCellId)
  .eq("id", releaseId)
  .maybeSingle();
if (releaseError) throw new Error("Approved factory release lookup failed.");
if (!release) throw new Error("Approved factory release was not found in this factory cell.");

const cellPrefix = canonicalHash(factoryCellId).slice(0, 24);
if (!new RegExp(`^template-factory/${cellPrefix}/releases/${releaseId}\\.json$`, "u").test(release.storage_path)) {
  throw new Error("Approved factory release storage path failed cell isolation validation.");
}
const { data: artifact, error: downloadError } = await service.storage.from(BUCKET).download(release.storage_path);
if (downloadError || !artifact) throw new Error("Approved factory release artifact could not be downloaded.");
const bundleBytes = new Uint8Array(await artifact.arrayBuffer());
if (sha256(bundleBytes) !== release.bundle_hash) throw new Error("Approved factory release bundle hash does not match staging metadata.");

const bundle = JSON.parse(Buffer.from(bundleBytes).toString("utf8"));
validateBundle(bundle, release);
const sampleBytes = Buffer.from(bundle.sample.base64, "base64");
if (sampleBytes.length === 0 || sampleBytes.toString("base64") !== bundle.sample.base64 || sha256(sampleBytes) !== release.sample_hash) {
  throw new Error("Approved factory sample bytes failed canonical base64 or hash validation.");
}
const expectedDimensions = bundle.manifest.format === "4:5" ? { width: 1080, height: 1350 } : { width: 1080, height: 1920 };
const metadata = await sharp(sampleBytes).metadata();
if (metadata.format !== "png" || metadata.width !== expectedDimensions.width || metadata.height !== expectedDimensions.height) {
  throw new Error(`Approved factory sample must be a ${expectedDimensions.width}x${expectedDimensions.height} PNG.`);
}

const outputDir = resolve("artifacts", "adstudio-template-imports", releaseId);
const publicEvidence = {
  schema: "adstudio.template.import-package.v1",
  releaseId,
  factoryJobId: release.factory_job_id,
  candidateId: release.candidate_id,
  manifestHash: release.manifest_hash,
  sampleHash: release.sample_hash,
  candidateEvidence: bundle.evidence,
  qa: bundle.qa,
  attempts: bundle.attempts,
  attestation: bundle.attestation,
};
assertSourceFree(publicEvidence);
writeIdempotent(join(outputDir, "manifest.json"), `${JSON.stringify(bundle.manifest, null, 2)}\n`);
writeIdempotent(join(outputDir, "sample.png"), sampleBytes);
writeIdempotent(join(outputDir, "factory-evidence.json"), `${JSON.stringify(publicEvidence, null, 2)}\n`);

console.log(`Verified release ${releaseId} and wrote the non-runtime review package to ${outputDir}.`);
console.log("Next: add offline editor measurements to a prepared manifest, run `npm run adstudio:customer-fixture -- export|render`, prepare its independent review, then run `npm run adstudio:promote-factory-template -- ...`.");
console.log("Promotion writes the static gallery only after customer QA passes; required before PR: npm run typecheck && npm run test");

function validateBundle(bundle, release) {
  if (!isRecord(bundle) || bundle.schema !== RELEASE_SCHEMA || bundle.releaseId !== release.id
    || bundle.factoryJobId !== release.factory_job_id || bundle.candidateId !== release.candidate_id) {
    throw new Error("Approved factory release bundle binding is invalid.");
  }
  if (!isRecord(bundle.manifest) || canonicalHash(bundle.manifest) !== release.manifest_hash || bundle.manifestHash !== release.manifest_hash) {
    throw new Error("Approved factory manifest hash is invalid.");
  }
  if (!isRecord(bundle.sample) || bundle.sample.contentType !== "image/png" || bundle.sample.contentHash !== release.sample_hash
    || typeof bundle.sample.base64 !== "string") throw new Error("Approved factory sample record is invalid.");
  if (!isRecord(bundle.evidence) || bundle.evidence.schema !== EVIDENCE_SCHEMA || canonicalHash(bundle.evidence) !== bundle.attestation?.evidenceHash) {
    throw new Error("Approved factory candidate evidence is invalid.");
  }
  if (!isRecord(bundle.attestation) || bundle.attestation.schema !== ATTESTATION_SCHEMA
    || bundle.attestation.attestationHash !== release.attestation_hash) throw new Error("Approved factory release attestation is invalid.");
  const { attestationHash: _hash, ...attestationPayload } = bundle.attestation;
  if (canonicalHash(attestationPayload) !== release.attestation_hash
    || bundle.attestation.manifestHash !== release.manifest_hash
    || bundle.attestation.sampleHash !== release.sample_hash
    || bundle.attestation.candidateId !== release.candidate_id
    || bundle.attestation.factoryJobId !== release.factory_job_id) {
    throw new Error("Approved factory release attestation bindings are invalid.");
  }
  if (canonicalHash(bundle.qa) !== bundle.attestation.qaHash || canonicalHash(bundle.attempts) !== bundle.evidence.attemptsHash) {
    throw new Error("Approved factory QA or paid-attempt evidence hash is invalid.");
  }
  if (bundle.evidence.candidateId !== release.candidate_id || bundle.evidence.factoryJobId !== release.factory_job_id
    || bundle.evidence.sampleHash !== release.sample_hash || bundle.evidence.qaHash !== bundle.attestation.qaHash) {
    throw new Error("Approved factory candidate evidence bindings are invalid.");
  }
  if (bundle.manifest.id !== bundle.evidence.templateId || bundle.manifest.sample?.contentHash !== release.sample_hash
    || bundle.manifest.sourceAd?.contentHash !== bundle.attestation.sourceHash) {
    throw new Error("Approved factory gallery manifest bindings are invalid.");
  }
  assertSourceFree(bundle.manifest);
}

function assertSourceFree(value, key = "value") {
  if (typeof value === "string") {
    const publicAsset = /^\/(?:adstudio-samples\/meta\/[a-z0-9][a-z0-9-]*\.png|fonts\/adstudio\/[a-z0-9][a-z0-9-]*\.woff2)$/u.test(value);
    if (/^(?:data:|https?:|file:)/iu.test(value) || (value.startsWith("/") && !publicAsset) || value.includes("\\") || value.includes("..")) {
      throw new Error(`Import package contains a private or external value at ${key}.`);
    }
    return;
  }
  if (Array.isArray(value)) { value.forEach((item, index) => assertSourceFree(item, `${key}[${index}]`)); return; }
  if (!isRecord(value)) return;
  for (const [childKey, child] of Object.entries(value)) {
    if (/^(?:sourceReference|privatePath|bytes|dataUrl|base64|layers|recipe|versions|fonts)$/iu.test(childKey)) {
      throw new Error(`Import package contains forbidden field ${childKey}.`);
    }
    assertSourceFree(child, `${key}.${childKey}`);
  }
}

function writeIdempotent(path, bytes) {
  const next = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, "utf8");
  if (existsSync(path)) {
    const current = readFileSync(path);
    if (!current.equals(next)) throw new Error(`Refusing to overwrite a different existing import artifact: ${path}`);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, next, { flag: "wx" });
}

function canonicalHash(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function isRecord(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function clean(value) { return String(value ?? "").replace(/^\uFEFF/u, "").trim(); }
