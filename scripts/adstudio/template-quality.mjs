#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import sharp from "sharp";

import {
  verifyLockedClonePacket,
} from "./local-template-adapter.mjs";

const HASH = /^[a-f0-9]{64}$/u;
const MIN_AD_SYSTEM_LIKENESS = 9.5;
const MIN_STANDALONE_AD_QUALITY = 9;
const SUBJECT_INVARIANT_RUBRIC_VERSION = "adstudio-subject-invariant-clone-v1";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fileHash(path) {
  return sha256(readFileSync(path));
}

function workspacePath(root, path) {
  const value = relative(root, resolve(path)).split(sep).join("/");
  if (!value || value === ".." || value.startsWith("../")) throw new Error(`Path must remain in the workspace: ${path}`);
  return value;
}

function required(value, name) {
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key?.startsWith("--") || !argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error("Expected --name value arguments.");
    args[key.slice(2)] = argv[index + 1];
  }
  return args;
}

function resolveTemplate(path) {
  const absolute = resolve(path);
  if (!existsSync(absolute)) throw new Error(`Template was not found: ${path}`);
  const template = JSON.parse(readFileSync(absolute, "utf8"));
  if (!template?.id || !template.dimensions?.width || !template.dimensions?.height) throw new Error("Template lacks an id or dimensions.");
  if (!HASH.test(template.sourceAd?.contentHash ?? "") || !HASH.test(template.sample?.contentHash ?? "")) {
    throw new Error("Template must contain Frank source attestation and public sample SHA-256 identities.");
  }
  return { absolute, template };
}

function samplePath(root, template) {
  if (!template.sample?.imageSrc?.startsWith("/")) throw new Error("Template sample imageSrc must be a public path.");
  return resolve(root, "public", template.sample.imageSrc.slice(1));
}

/** Review only an independent customer fixture cloned from the approved sample. */
export async function inspectEvidence({ templatePath, packetPath, candidatePath, sampleOverride }) {
  const root = process.cwd();
  const { absolute: templateAbsolute, template } = resolveTemplate(templatePath);
  const packetAbsolute = resolve(packetPath);
  const candidateAbsolute = resolve(candidatePath);
  if (!existsSync(packetAbsolute) || !existsSync(candidateAbsolute)) throw new Error("Packet and candidate files must exist.");
  const packet = JSON.parse(readFileSync(packetAbsolute, "utf8"));
  verifyLockedClonePacket(packet, { root });
  if (packet.templateId !== template.id) throw new Error("Locked packet templateId does not match the template.");
  if (resolve(root, packet.expectedOutput) !== candidateAbsolute) throw new Error("Candidate path does not match the locked packet expectedOutput.");

  const publicSample = sampleOverride ? resolve(sampleOverride) : samplePath(root, template);
  if (sampleOverride && !workspacePath(root, publicSample).startsWith("artifacts/adstudio-template-imports/")) {
    throw new Error("Customer-fixture sample override must come from an imported Frank release package.");
  }
  if (!existsSync(publicSample) || fileHash(publicSample) !== template.sample.contentHash) {
    throw new Error("Template public sample identity does not match its manifest.");
  }
  const reference = packet.references[0];
  if (resolve(root, reference.path) !== publicSample || reference.contentHash !== template.sample.contentHash) {
    throw new Error("Locked customer-fixture reference does not match the approved public sample.");
  }

  const candidateHash = fileHash(candidateAbsolute);
  if (candidateHash === reference.contentHash) throw new Error("Candidate must differ from its design reference image.");
  const metadata = await sharp(candidateAbsolute).metadata();
  if (metadata.width !== template.dimensions.width || metadata.height !== template.dimensions.height) {
    throw new Error(`Candidate dimensions must be exactly ${template.dimensions.width}x${template.dimensions.height}.`);
  }
  return {
    template,
    stage: "customer_fixture",
    hashes: {
      template: fileHash(templateAbsolute),
      packet: fileHash(packetAbsolute),
      reference: reference.contentHash,
      sample: fileHash(publicSample),
      candidate: candidateHash,
    },
    paths: {
      template: workspacePath(root, templateAbsolute),
      packet: workspacePath(root, packetAbsolute),
      reference: workspacePath(root, publicSample),
      sample: workspacePath(root, publicSample),
      candidate: workspacePath(root, candidateAbsolute),
    },
    packet,
    referenceAbsolute: publicSample,
    candidateAbsolute,
  };
}

function reviewPrompt(evidence) {
  const copyContract = Object.entries(evidence.packet.copy ?? {}).map(([key, expected]) => ({ key, expected }));
  const assetContract = evidence.packet.references.filter((reference) => reference.role === "replacement_asset").map((reference) => reference.key);
  return [
    "You are independently reviewing an approved public sample and a customer-fixture candidate clone at full resolution.",
    "Score the reusable ad system, not the replaceable customer subject matter.",
    "Ignore property/photo subject and logo content, and ignore copy wording. Do score their placement, crop/fit treatment, masks, overlays, effects, anchors, hierarchy, geometry, palette, typography treatment, line structure, whitespace, borders, and CTA/footer treatment.",
    `Check exact visible copy against this contract: ${JSON.stringify(copyContract)}. Return copyChecks as [{key,expected,observed,exact}].`,
    `Check these supplied replacement assets: ${JSON.stringify(assetContract)}. Return assetChecks as [{key,used,faithful,notes}].`,
    "Return JSON only with schemaVersion (1), rubricVersion, templateId, requestHash, candidateHash, reviewer {provider,model}, adSystemLikenessScore (0-10), standaloneAdQualityScore (0-10), excludedContentInfluencedScore (boolean), copyChecks, assetChecks, identityLeakage (array of source identities that survived), defects (array of true rendering defects such as warped text/logo/geometry, not mere likeness differences), includedRationale, qualityRationale, suggestedCorrection, reviewedAt (ISO-8601).",
    `Pass requires likeness >= ${MIN_AD_SYSTEM_LIKENESS}, quality >= ${MIN_STANDALONE_AD_QUALITY}, excludedContentInfluencedScore false, every copy check exact, every required asset used and faithful, and empty identityLeakage and defects.`,
    `Bind your response exactly to templateId ${evidence.template.id}, requestHash ${evidence.packet.requestHash}, candidateHash ${evidence.hashes.candidate}, rubricVersion ${SUBJECT_INVARIANT_RUBRIC_VERSION}.`,
  ].join("\n");
}

async function contactSheet({ sample, candidate, output, dimensions }) {
  const width = dimensions.width;
  const height = dimensions.height;
  const sampleImage = await sharp(sample).resize({ width, height, fit: "contain", background: "#111111" }).png().toBuffer();
  const candidateImage = await sharp(candidate).resize({ width, height, fit: "contain", background: "#111111" }).png().toBuffer();
  const label = (text) => Buffer.from(`<svg width="${width}" height="64"><rect width="100%" height="100%" fill="#111111"/><text x="28" y="41" font-family="Arial, sans-serif" font-size="25" font-weight="700" fill="#ffffff">${text}</text></svg>`);
  await sharp({ create: { width: width * 2, height: height + 64, channels: 4, background: "#111111" } })
    .composite([{ input: label("APPROVED PUBLIC SAMPLE"), left: 0, top: 0 }, { input: label("CUSTOMER FIXTURE"), left: width, top: 0 }, { input: sampleImage, left: 0, top: 64 }, { input: candidateImage, left: width, top: 64 }])
    .png().toFile(output);
}

export async function prepareReview(input) {
  const evidence = await inspectEvidence(input);
  const out = resolve(input.out);
  mkdirSync(out, { recursive: true });
  const sheet = resolve(out, "sample-vs-customer-candidate.png");
  await contactSheet({
    sample: evidence.referenceAbsolute,
    candidate: evidence.candidateAbsolute,
    output: sheet,
    dimensions: evidence.template.dimensions,
  });
  const manifest = {
    schemaVersion: 1,
    kind: "adstudio_customer_fixture_quality_review_packet",
    stage: "customer_fixture",
    templateId: evidence.template.id,
    requestHash: evidence.packet.requestHash,
    candidateHash: evidence.hashes.candidate,
    hashes: evidence.hashes,
    paths: { ...evidence.paths, contactSheet: workspacePath(process.cwd(), sheet) },
    dimensions: evidence.template.dimensions,
    rubricVersion: SUBJECT_INVARIANT_RUBRIC_VERSION,
    reviewPrompt: reviewPrompt(evidence),
  };
  writeFileSync(resolve(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function assertReview(review, evidence) {
  if (review?.schemaVersion !== 1 || review.templateId !== evidence.template.id || review.requestHash !== evidence.packet.requestHash || review.candidateHash !== evidence.hashes.candidate) throw new Error("Review is not bound to this exact template, request, and candidate.");
  if (review.rubricVersion !== SUBJECT_INVARIANT_RUBRIC_VERSION) throw new Error("Review rubric version is invalid.");
  if (!review.reviewer?.provider?.trim() || !review.reviewer?.model?.trim()) throw new Error("Review must identify its image-model reviewer.");
  if (!Number.isFinite(review.adSystemLikenessScore) || !Number.isFinite(review.standaloneAdQualityScore)) throw new Error("Review scores must be numeric.");
  if (review.excludedContentInfluencedScore !== false) throw new Error("Review improperly used excluded content in its score.");
  const copyChecks = new Map((review.copyChecks ?? []).map((check) => [check.key, check]));
  for (const [key, expected] of Object.entries(evidence.packet.copy ?? {})) {
    const check = copyChecks.get(key);
    if (!check || check.expected !== expected || typeof check.exact !== "boolean") {
      throw new Error(`Review did not evaluate exact copy for ${key}.`);
    }
  }
  const assetChecks = new Map((review.assetChecks ?? []).map((check) => [check.key, check]));
  for (const reference of evidence.packet.references.filter((item) => item.role === "replacement_asset")) {
    const check = assetChecks.get(reference.key);
    if (!check || typeof check.used !== "boolean" || typeof check.faithful !== "boolean") {
      throw new Error(`Review did not evaluate required asset ${reference.key}.`);
    }
  }
  if (!Array.isArray(review.identityLeakage) || !Array.isArray(review.defects)) throw new Error("Review needs identityLeakage and defects arrays.");
  if (!Number.isFinite(Date.parse(review.reviewedAt ?? ""))) throw new Error("Review needs a valid reviewedAt timestamp.");
}

export function assertPassingQa(qa, evidence) {
  if (qa?.schemaVersion !== 1 || qa.stage !== "customer_fixture" || qa.templateId !== evidence.template.id || qa.requestHash !== evidence.packet.requestHash || qa.outputHash !== evidence.hashes.candidate) {
    throw new Error("Recorded customer-fixture QA is not bound to the reviewed request and output.");
  }
  if (qa.passed !== true || qa.fullSizeReviewed !== true || !qa.contractReview?.passed || !qa.requestIntegrity?.passed) {
    throw new Error("Recorded customer-fixture QA did not pass every integrity check.");
  }
  assertReview(qa.visualReview, evidence);
  if (qa.visualReview.adSystemLikenessScore < MIN_AD_SYSTEM_LIKENESS || qa.visualReview.standaloneAdQualityScore < MIN_STANDALONE_AD_QUALITY) {
    throw new Error("Recorded customer-fixture QA is below the quality thresholds.");
  }
  if (qa.copyChecks.some((check) => check.exact !== true) || qa.assetChecks.some((check) => check.used !== true || check.faithful !== true)) {
    throw new Error("Recorded customer-fixture QA has failed copy or asset checks.");
  }
  if (qa.identityLeakage.length || qa.defects.length) throw new Error("Recorded customer-fixture QA has leakage or defects.");
}

export function releasableStageEvidence(evidence, qa) {
  return {
    stage: "customer_fixture",
    requestHash: evidence.packet.requestHash,
    referenceHash: evidence.packet.references[0].contentHash,
    references: evidence.packet.references.map(({ index, key, role, contentHash }) => ({ index, key, role, contentHash })),
    copy: evidence.packet.copy,
    outputHash: evidence.hashes.candidate,
    executionTransport: evidence.packet.executionTransport,
    reviewedAt: qa.reviewedAt,
    review: qa.visualReview,
  };
}

export async function recordReview(input) {
  const evidence = await inspectEvidence(input);
  const out = resolve(input.out);
  const review = JSON.parse(readFileSync(resolve(input.review), "utf8"));
  assertReview(review, evidence);
  mkdirSync(out, { recursive: true });
  const immutablePath = resolve(out, "review.json");
  const serialized = `${JSON.stringify(review, null, 2)}\n`;
  if (existsSync(immutablePath) && readFileSync(immutablePath, "utf8") !== serialized) throw new Error("An immutable review already exists for this output directory.");
  if (!existsSync(immutablePath)) writeFileSync(immutablePath, serialized);
  const copyPassed = review.copyChecks.every((check) => check.exact === true);
  const assetsPassed = review.assetChecks.every((check) => check.used === true && check.faithful === true);
  const passed = review.adSystemLikenessScore >= MIN_AD_SYSTEM_LIKENESS && review.standaloneAdQualityScore >= MIN_STANDALONE_AD_QUALITY && copyPassed && assetsPassed && review.identityLeakage.length === 0 && review.defects.length === 0;
  const status = { schemaVersion: 1, stage: "customer_fixture", templateId: evidence.template.id, requestHash: evidence.packet.requestHash, candidateHash: evidence.hashes.candidate, passed, suggestedCorrection: review.suggestedCorrection ?? "" };
  const qa = {
    schemaVersion: 1,
    stage: "customer_fixture",
    templateId: evidence.template.id,
    requestHash: evidence.packet.requestHash,
    passed,
    fullSizeReviewed: true,
    contractReview: { passed: true, notes: "Only declared customer inputs were used." },
    requestIntegrity: { passed: true, notes: "The locked public-sample clone request and contractual reference order were verified." },
    copyChecks: review.copyChecks.map(({ key, expected, observed, exact }) => ({ key, expected, observed, exact })),
    assetChecks: review.assetChecks.map(({ key, used, faithful, notes }) => ({ key, used, faithful, notes })),
    identityLeakage: review.identityLeakage,
    defects: review.defects,
    correctionCount: Number.isInteger(evidence.packet.seed) && evidence.packet.seed >= 0 ? evidence.packet.seed : 0,
    reviewedAt: review.reviewedAt,
    outputHash: evidence.hashes.candidate,
    visualReview: review,
  };
  writeFileSync(resolve(out, "status.json"), `${JSON.stringify(status, null, 2)}\n`);
  writeFileSync(resolve(out, "qa.json"), `${JSON.stringify(qa, null, 2)}\n`);
  return status;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || !["prepare-review", "record-review"].includes(command)) throw new Error("Usage: template-quality.mjs <prepare-review|record-review> ...");
  const args = parseArgs(rest);
  const allowed = command === "prepare-review" ? new Set(["template", "packet", "candidate", "out"]) : new Set(["template", "packet", "candidate", "out", "review"]);
  for (const key of Object.keys(args)) if (!allowed.has(key)) throw new Error(`Unsupported --${key}; this tool reviews exactly one customer fixture.`);
  const input = { templatePath: required(args.template, "template"), packetPath: required(args.packet, "packet"), candidatePath: required(args.candidate, "candidate"), out: required(args.out, "out"), review: args.review };
  const result = command === "prepare-review" ? await prepareReview(input) : await recordReview({ ...input, review: required(args.review, "review") });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (command === "record-review" && !result.passed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
