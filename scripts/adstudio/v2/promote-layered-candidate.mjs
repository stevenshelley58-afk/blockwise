#!/usr/bin/env node

// Promote a source-free layered candidate only after the durable Frank review
// and deterministic local gates have actually passed. This is deliberately a
// separate lane from source-native fidelity: it records sample replay evidence
// and never invents source-pixel residuals.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fidelityTemplateHash, runStressMatrix } from "../../../src/lib/adstudio/v2/fidelity-stress.ts";
import { hashCanonicalJson } from "../../../src/lib/adstudio/v2/template-hash.ts";
import { appendGeneration, validateGenerationTrace, LIKENESS_THRESHOLD } from "./generation-trace.mjs";
import { readApprovalReceipt } from "./pack-release.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }
function arg(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : null;
}
function requirePath(value, flag) {
  if (!value) throw new Error(`${flag} is required`);
  const path = resolve(value);
  if (!existsSync(path)) throw new Error(`${flag} does not exist: ${path}`);
  return path;
}
function writeJsonAtomic(path, value) {
  const temporary = `${path}.promote-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}
function assertSha(value, label) {
  if (!SHA256.test(String(value ?? ""))) throw new Error(`${label} must be a lowercase SHA-256`);
}

export function assertLayeredEvidence({ templateId, doc, evidence, trace, subjectInvariance, approval, reviewerUserId, reviewerEmail, templateBytes, sampleBytes, storySampleBytes }) {
  if (doc?.exactness?.status !== "qa") throw new Error(`${templateId}: promotion requires exactness.status=qa`);
  if (doc.exactness.bakedTextKeys?.length) throw new Error(`${templateId}: source-free promotion cannot carry baked text`);
  if (evidence?.restyle?.sourceFree !== true || evidence?.restyle?.noWholeAdImageModel !== true) {
    throw new Error(`${templateId}: source-free restyle evidence is missing`);
  }
  const templateHash = fidelityTemplateHash(doc);
  if (evidence.templateSha256 !== hashCanonicalJson(doc)) throw new Error(`${templateId}: seed template hash is stale`);
  validateGenerationTrace(trace);
  if (trace.templateId !== templateId || trace.status !== "accepted") throw new Error(`${templateId}: accepted generation trace is required`);
  const generation = trace.generations.at(-1);
  if (!generation || generation.scores.primaryAdSystemLikeness < LIKENESS_THRESHOLD || generation.scores.strictAdSystemLikeness < LIKENESS_THRESHOLD) {
    throw new Error(`${templateId}: both independent Frank reviewers must score at least ${LIKENESS_THRESHOLD}`);
  }
  if (generation.artifacts.feedSha256 !== doc.provenance.sample.contentHash || generation.artifacts.storySha256 !== doc.provenance.storySample?.contentHash) {
    throw new Error(`${templateId}: accepted generation previews are stale`);
  }
  if (subjectInvariance?.schema !== "adstudio.subject-invariance.evidence.v1"
    || subjectInvariance.templateId !== templateId
    || subjectInvariance.templateIdentityHash !== templateHash
    || subjectInvariance.gate?.passed !== true) {
    throw new Error(`${templateId}: passing subject-invariance evidence bound to the current template is required`);
  }
  assertSha(doc.provenance.sample.contentHash, `${templateId} sample hash`);
  assertSha(doc.provenance.storySample?.contentHash, `${templateId} story sample hash`);
  if (sha256(sampleBytes) !== doc.provenance.sample.contentHash || sha256(storySampleBytes) !== doc.provenance.storySample.contentHash) {
    throw new Error(`${templateId}: sample bytes do not match the current document`);
  }
  if (!approval || approval.decision !== "approved") throw new Error(`${templateId}: approved human receipt is required`);
  if (!UUID.test(reviewerUserId ?? "") || !EMAIL.test(reviewerEmail ?? "")) {
    throw new Error(`${templateId}: authenticated reviewer id and email are required`);
  }
  return { templateHash, generation, checkedAt: approval.decided_at };
}

export async function promoteLayeredCandidate({ candidate, tracePath, subjectInvariancePath, approvalPath, reviewerUserId, reviewerEmail }) {
  const root = resolve(candidate);
  const manifest = readJson(join(root, "variant-pack.manifest.json"));
  if (!Array.isArray(manifest.variantIds) || manifest.variantIds.length !== 1) throw new Error("promotion requires exactly one candidate variant");
  const templateId = manifest.variantIds[0];
  const templatePath = join(root, "src", "lib", "adstudio", "template-gallery-v2", templateId, "template.json");
  const evidencePath = join(root, "src", "lib", "adstudio", "template-gallery-v2", templateId, "evidence.json");
  const samplePath = join(root, "public", "adstudio-templates", templateId, "sample.png");
  const storySamplePath = join(root, "public", "adstudio-templates", templateId, "sample-story.png");
  const templateBytes = readFileSync(templatePath);
  const doc = JSON.parse(templateBytes.toString("utf8"));
  const evidence = readJson(evidencePath);
  const trace = readJson(requirePath(tracePath, "--trace"));
  const suppliedSubjectInvariance = readJson(requirePath(subjectInvariancePath, "--subject-invariance"));
  // Re-run the deterministic gate against this exact candidate. The supplied
  // report is an audit receipt, not an assertion the CLI is allowed to trust.
  const { runSubjectInvariance } = await import("./subject-invariance.mjs");
  const subjectRun = await runSubjectInvariance({ repoRoot: root, templateId });
  const subjectInvariance = subjectRun.report;
  if (suppliedSubjectInvariance.schema !== subjectInvariance.schema
    || suppliedSubjectInvariance.templateId !== subjectInvariance.templateId
    || suppliedSubjectInvariance.templateHash !== subjectInvariance.templateHash
    || suppliedSubjectInvariance.gate?.passed !== true) {
    throw new Error(`${templateId}: supplied subject-invariance receipt is stale or failed`);
  }
  const approval = readApprovalReceipt(requirePath(approvalPath, "--approval"));
  const sampleBytes = readFileSync(samplePath);
  const storySampleBytes = readFileSync(storySamplePath);
  const checked = assertLayeredEvidence({ templateId, doc, evidence, trace, subjectInvariance, approval, reviewerUserId, reviewerEmail, templateBytes, sampleBytes, storySampleBytes });
  const stress = await runStressMatrix(doc, { renderOptions: { repoRoot: root } });
  if (stress.templateHash !== checked.templateHash || stress.entries.length !== 10) throw new Error(`${templateId}: deterministic stress replay did not complete ten cases`);
  const sampleReplayEvidence = {
    templateHash: checked.templateHash,
    checkedAt: checked.checkedAt,
    sampleContentHash: doc.provenance.sample.contentHash,
    storySampleContentHash: doc.provenance.storySample.contentHash,
    stressMatrixHash: stress.hash,
  };
  const nextDoc = {
    ...doc,
    exactness: {
      ...doc.exactness,
      mode: "source-free-sample-replay-v1",
      status: "ready",
      residuals: {},
      sampleReplayEvidence,
      stressEvidence: { templateHash: stress.templateHash, checkedAt: checked.checkedAt, matrixHash: stress.hash, entries: stress.entries },
      reviewEvidence: {
        reviewerUserId,
        reviewerEmail,
        reviewedAt: checked.checkedAt,
        confirmation: "inspected-at-100-percent",
        templateHash: checked.templateHash,
        sourceContentHash: doc.provenance.sourceAd.contentHash,
        sampleContentHash: doc.provenance.sample.contentHash,
        sampleReplayEvidenceHash: hashCanonicalJson(sampleReplayEvidence),
        stressEvidenceHash: hashCanonicalJson({ templateHash: stress.templateHash, checkedAt: checked.checkedAt, matrixHash: stress.hash, entries: stress.entries }),
      },
    },
  };
  const nextEvidence = {
    ...evidence,
    templateSha256: hashCanonicalJson(nextDoc),
    generationTrace: trace,
    subjectInvariance,
    qa: {
      feedPassed: true,
      storyPassed: true,
      stressFixtureResults: Object.fromEntries(stress.entries.map((entry) => [`${entry.format}:${entry.scenario}`, { passed: true, renderHash: entry.renderHash }])),
    },
    iteration: { process: "source-analysis -> layered-v2 -> deterministic-render -> subject-invariance -> stress-replay -> dual-review -> human-approval", status: "ready", authority: "frank-hermes-durable-run", accepted: true, durableRunRequired: false },
  };
  writeJsonAtomic(templatePath, nextDoc);
  writeJsonAtomic(evidencePath, nextEvidence);
  return { templateId, status: "ready", mode: nextDoc.exactness.mode, stressMatrixHash: stress.hash, templateHash: checked.templateHash };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) {
    process.stdout.write("usage: promote-layered-candidate.mjs --candidate <root> --trace <path> --subject-invariance <path> --approval <path> --reviewer-id <uuid> --reviewer-email <email>\n");
    return;
  }
  const result = await promoteLayeredCandidate({
    candidate: requirePath(arg(argv, "--candidate"), "--candidate"),
    tracePath: arg(argv, "--trace"),
    subjectInvariancePath: arg(argv, "--subject-invariance"),
    approvalPath: arg(argv, "--approval"),
    reviewerUserId: arg(argv, "--reviewer-id"),
    reviewerEmail: arg(argv, "--reviewer-email"),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error?.stack ?? error}\n`); process.exitCode = 1; });
}
