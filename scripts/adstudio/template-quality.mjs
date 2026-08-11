#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

import sharp from "sharp";

import {
  MIN_AD_SYSTEM_LIKENESS,
  MIN_STANDALONE_AD_QUALITY,
  SUBJECT_INVARIANT_RUBRIC_VERSION,
  verifyLockedClonePacket,
} from "./local-template-adapter.mjs";

const HASH = /^[a-f0-9]{64}$/u;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fileHash(path) {
  return sha256(readFileSync(path));
}

function canonicalTemplateContract(template) {
  const { qualityLock: _qualityLock, ...contract } = template;
  return canonicalJson(contract);
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
    throw new Error("Template must contain source and sample SHA-256 identities.");
  }
  return { absolute, template };
}

function samplePath(root, template) {
  if (!template.sample?.imageSrc?.startsWith("/")) throw new Error("Template sample imageSrc must be a public path.");
  return resolve(root, "public", template.sample.imageSrc.slice(1));
}

export async function inspectEvidence({ templatePath, packetPath, candidatePath, sampleOverride }) {
  const root = process.cwd();
  const { absolute: templateAbsolute, template } = resolveTemplate(templatePath);
  const packetAbsolute = resolve(packetPath);
  const candidateAbsolute = resolve(candidatePath);
  if (!existsSync(packetAbsolute) || !existsSync(candidateAbsolute)) throw new Error("Packet and candidate files must exist.");
  const packet = JSON.parse(readFileSync(packetAbsolute, "utf8"));
  const { stage } = verifyLockedClonePacket(packet, { root });
  if (packet.templateId !== template.id) throw new Error("Locked packet templateId does not match the template.");
  const reference = packet.references[0];
  if (resolve(root, packet.expectedOutput) !== candidateAbsolute) throw new Error("Candidate path does not match the locked packet expectedOutput.");
  const publicSample = sampleOverride ? resolve(sampleOverride) : samplePath(root, template);
  if (sampleOverride && !workspacePath(root, publicSample).startsWith("artifacts/adstudio-template-imports/")) {
    throw new Error("Customer-fixture sample override must come from an imported Frank release package.");
  }
  const placeholderSample = template.sample.contentHash === "0".repeat(64);
  if (existsSync(publicSample)) {
    if (!placeholderSample && fileHash(publicSample) !== template.sample.contentHash) {
      throw new Error("Template public sample identity does not match its manifest.");
    }
  } else if (!placeholderSample) {
    throw new Error("Template public sample identity does not match its manifest.");
  }
  if (stage === "gallery_sample") {
    if (reference.contentHash !== template.sourceAd.contentHash) throw new Error("Locked source identity does not match template sourceAd.");
  } else {
    if (!existsSync(publicSample) || placeholderSample) throw new Error("Customer-fixture review requires an approved public sample.");
    if (resolve(root, reference.path) !== publicSample || reference.contentHash !== template.sample.contentHash) {
      throw new Error("Locked customer-fixture reference does not match the approved public sample.");
    }
  }
  const candidateHash = fileHash(candidateAbsolute);
  if (candidateHash === reference.contentHash) throw new Error("Candidate must differ from its design reference image.");
  const metadata = await sharp(candidateAbsolute).metadata();
  if (metadata.width !== template.dimensions.width || metadata.height !== template.dimensions.height) {
    throw new Error(`Candidate dimensions must be exactly ${template.dimensions.width}x${template.dimensions.height}.`);
  }
  return {
    template,
    stage,
    hashes: {
      template: fileHash(templateAbsolute),
      packet: fileHash(packetAbsolute),
      reference: reference.contentHash,
      source: stage === "gallery_sample" ? reference.contentHash : null,
      sample: existsSync(publicSample) ? fileHash(publicSample) : null,
      candidate: candidateHash,
    },
    paths: {
      template: workspacePath(root, templateAbsolute), packet: workspacePath(root, packetAbsolute), reference: reference.path,
      source: null,
      sample: existsSync(publicSample) ? workspacePath(root, publicSample) : null,
      candidate: workspacePath(root, candidateAbsolute),
    },
    packet,
    referenceAbsolute: resolve(root, reference.path),
    candidateAbsolute,
  };
}

function reviewPrompt(evidence) {
  const copyContract = Object.entries(evidence.packet.copy ?? {}).map(([key, expected]) => ({ key, expected }));
  const assetContract = evidence.packet.references.filter((reference) => reference.role === "replacement_asset").map((reference) => reference.key);
  return [
    `You are independently reviewing a ${evidence.stage === "gallery_sample" ? "private source ad" : "safe approved public sample"} and a candidate clone at full resolution.`,
    "Score the reusable ad system, not the replaceable customer subject matter.",
    "Ignore property/photo subject and logo content, and ignore copy wording. Do score their placement, crop/fit treatment, masks, overlays, effects, anchors, hierarchy, geometry, palette, typography treatment, line structure, whitespace, borders, and CTA/footer treatment.",
    `Check exact visible copy against this contract: ${JSON.stringify(copyContract)}. Return copyChecks as [{key,expected,observed,exact}].`,
    `Check these supplied replacement assets: ${JSON.stringify(assetContract)}. Return assetChecks as [{key,used,faithful,notes}].`,
    "Return JSON only with schemaVersion (1), rubricVersion, templateId, requestHash, candidateHash, reviewer {provider,model}, adSystemLikenessScore (0-10), standaloneAdQualityScore (0-10), excludedContentInfluencedScore (boolean), copyChecks, assetChecks, identityLeakage (array of source identities that survived), defects (array of true rendering defects such as warped text/logo/geometry, not mere likeness differences), includedRationale, qualityRationale, suggestedCorrection, reviewedAt (ISO-8601).",
    `Pass requires likeness >= ${MIN_AD_SYSTEM_LIKENESS}, quality >= ${MIN_STANDALONE_AD_QUALITY}, excludedContentInfluencedScore false, every copy check exact, every required asset used and faithful, and empty identityLeakage and defects.`,
    `Bind your response exactly to templateId ${evidence.template.id}, requestHash ${evidence.packet.requestHash}, candidateHash ${evidence.hashes.candidate}, rubricVersion ${SUBJECT_INVARIANT_RUBRIC_VERSION}.`,
  ].join("\n");
}

async function contactSheet({ source, candidate, output, dimensions, referenceLabel }) {
  const width = dimensions.width;
  const height = dimensions.height;
  const sourceImage = await sharp(source).resize({ width, height, fit: "contain", background: "#111111" }).png().toBuffer();
  const candidateImage = await sharp(candidate).resize({ width, height, fit: "contain", background: "#111111" }).png().toBuffer();
  const label = (text) => Buffer.from(`<svg width="${width}" height="64"><rect width="100%" height="100%" fill="#111111"/><text x="28" y="41" font-family="Arial, sans-serif" font-size="25" font-weight="700" fill="#ffffff">${text}</text></svg>`);
  await sharp({ create: { width: width * 2, height: height + 64, channels: 4, background: "#111111" } })
    .composite([{ input: label(referenceLabel), left: 0, top: 0 }, { input: label("CANDIDATE"), left: width, top: 0 }, { input: sourceImage, left: 0, top: 64 }, { input: candidateImage, left: width, top: 64 }])
    .png().toFile(output);
}

export async function prepareReview(input) {
  const evidence = await inspectEvidence(input);
  const out = resolve(input.out);
  mkdirSync(out, { recursive: true });
  const sheet = resolve(out, evidence.stage === "gallery_sample" ? "source-vs-candidate.png" : "sample-vs-customer-candidate.png");
  await contactSheet({
    source: evidence.referenceAbsolute,
    candidate: evidence.candidateAbsolute,
    output: sheet,
    dimensions: evidence.template.dimensions,
    referenceLabel: evidence.stage === "gallery_sample" ? "PRIVATE SOURCE — REVIEW ONLY" : "APPROVED PUBLIC SAMPLE",
  });
  const manifest = {
    schemaVersion: 1, kind: "adstudio_template_quality_review_packet", stage: evidence.stage, templateId: evidence.template.id,
    requestHash: evidence.packet.requestHash, candidateHash: evidence.hashes.candidate, hashes: evidence.hashes,
    paths: { ...evidence.paths, contactSheet: workspacePath(process.cwd(), sheet) },
    dimensions: evidence.template.dimensions, rubricVersion: SUBJECT_INVARIANT_RUBRIC_VERSION,
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
  if (qa?.schemaVersion !== 1 || qa.stage !== evidence.stage || qa.templateId !== evidence.template.id || qa.requestHash !== evidence.packet.requestHash || qa.outputHash !== evidence.hashes.candidate) {
    throw new Error(`Recorded ${evidence.stage} QA is not bound to the reviewed request and output.`);
  }
  if (qa.passed !== true || qa.fullSizeReviewed !== true || !qa.contractReview?.passed || !qa.requestIntegrity?.passed) {
    throw new Error(`Recorded ${evidence.stage} QA did not pass every integrity check.`);
  }
  assertReview(qa.visualReview, evidence);
  if (qa.visualReview.adSystemLikenessScore < MIN_AD_SYSTEM_LIKENESS || qa.visualReview.standaloneAdQualityScore < MIN_STANDALONE_AD_QUALITY) {
    throw new Error(`Recorded ${evidence.stage} QA is below the quality thresholds.`);
  }
  if (qa.copyChecks.some((check) => check.exact !== true) || qa.assetChecks.some((check) => check.used !== true || check.faithful !== true)) {
    throw new Error(`Recorded ${evidence.stage} QA has failed copy or asset checks.`);
  }
  if (qa.identityLeakage.length || qa.defects.length) throw new Error(`Recorded ${evidence.stage} QA has leakage or defects.`);
}

export function releasableStageEvidence(evidence, qa) {
  return {
    stage: evidence.stage,
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
  const status = { schemaVersion: 1, stage: evidence.stage, templateId: evidence.template.id, requestHash: evidence.packet.requestHash, candidateHash: evidence.hashes.candidate, passed, suggestedCorrection: review.suggestedCorrection ?? "" };
  const qa = {
    schemaVersion: 1,
    stage: evidence.stage,
    templateId: evidence.template.id,
    requestHash: evidence.packet.requestHash,
    passed,
    fullSizeReviewed: true,
    contractReview: { passed: true, notes: "Only declared customer inputs were used." },
    requestIntegrity: { passed: true, notes: "The locked buildCloneImageRequest payload and contractual reference order were verified." },
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

export async function publishQualityLock(input) {
  const sample = await inspectEvidence({ templatePath: input.templatePath, packetPath: input.samplePacket, candidatePath: input.sampleCandidate });
  const customer = await inspectEvidence({ templatePath: input.templatePath, packetPath: input.customerPacket, candidatePath: input.customerCandidate });
  if (sample.stage !== "gallery_sample" || customer.stage !== "customer_fixture") throw new Error("Quality lock requires one gallery-sample stage and one customer-fixture stage.");
  if (sample.template.id !== customer.template.id) throw new Error("Quality-lock stages belong to different templates.");
  const sampleQa = JSON.parse(readFileSync(resolve(input.sampleQa), "utf8"));
  const customerQa = JSON.parse(readFileSync(resolve(input.customerQa), "utf8"));
  assertPassingQa(sampleQa, sample);
  assertPassingQa(customerQa, customer);
  if (sample.hashes.candidate !== sample.template.sample.contentHash) throw new Error("Passing gallery candidate is not the currently approved public sample.");
  if (customer.packet.references[0].contentHash !== sample.hashes.candidate) throw new Error("Customer fixture was not cloned from the passing public sample.");

  const sampleAssets = new Map(sample.packet.references.filter((reference) => reference.role === "replacement_asset").map((reference) => [reference.key, reference.contentHash]));
  for (const reference of customer.packet.references.filter((item) => item.role === "replacement_asset")) {
    if (sampleAssets.get(reference.key) === reference.contentHash) throw new Error(`Customer fixture must use a different ${reference.key} asset from the gallery sample.`);
  }
  if (canonicalJson(sample.packet.copy) === canonicalJson(customer.packet.copy)) throw new Error("Customer fixture copy must differ from the gallery sample copy.");

  const reviewedAt = new Date(Math.max(Date.parse(sampleQa.reviewedAt), Date.parse(customerQa.reviewedAt))).toISOString();
  const templatePath = resolve(input.templatePath);
  const templateDocument = JSON.parse(readFileSync(templatePath, "utf8"));
  const templateContract = canonicalTemplateContract(templateDocument);
  const templateHash = sha256(templateContract);
  templateDocument.qualityLock = { templateHash };
  writeFileSync(templatePath, `${JSON.stringify(templateDocument, null, 2)}\n`);
  const releaseEvidence = {
    schemaVersion: 2,
    templateId: sample.template.id,
    templateHash,
    sampleHash: sample.template.sample.contentHash,
    rubricVersion: SUBJECT_INVARIANT_RUBRIC_VERSION,
    thresholds: { adSystemLikeness: MIN_AD_SYSTEM_LIKENESS, standaloneAdQuality: MIN_STANDALONE_AD_QUALITY },
    qualifiedAt: reviewedAt,
    sample: releasableStageEvidence(sample, sampleQa),
    customerFixture: releasableStageEvidence(customer, customerQa),
  };
  const evidencePath = input.evidence
    ? resolve(input.evidence)
    : resolve(dirname(sample.paths.template), "evidence", `${sample.template.id}.json`);
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(releaseEvidence, null, 2)}\n`);
  const evidenceHash = fileHash(evidencePath);

  const locksPath = input.locks ? resolve(input.locks) : resolve(dirname(sample.paths.template), "quality-locks.json");
  const locks = existsSync(locksPath) ? JSON.parse(readFileSync(locksPath, "utf8")) : { schemaVersion: 1, templates: {} };
  if (locks.schemaVersion !== 1 || !locks.templates || Array.isArray(locks.templates)) throw new Error("Quality-lock index is invalid.");
  locks.templates[sample.template.id] = {
    templateHash,
    templateContract,
    sampleHash: sample.template.sample.contentHash,
    evidenceHash,
    sampleLikeness: sampleQa.visualReview.adSystemLikenessScore,
    sampleQuality: sampleQa.visualReview.standaloneAdQualityScore,
    customerFixtureLikeness: customerQa.visualReview.adSystemLikenessScore,
    customerFixtureQuality: customerQa.visualReview.standaloneAdQualityScore,
    qualifiedAt: reviewedAt,
  };
  locks.templates = Object.fromEntries(Object.entries(locks.templates).sort(([left], [right]) => left.localeCompare(right)));
  writeFileSync(locksPath, `${JSON.stringify(locks, null, 2)}\n`);
  return locks.templates[sample.template.id];
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || !["prepare-review", "record-review", "publish-lock"].includes(command)) throw new Error("Usage: template-quality.mjs <prepare-review|record-review|publish-lock> ...");
  const args = parseArgs(rest);
  if (command === "publish-lock") {
    const allowed = new Set(["template", "sample-packet", "sample-candidate", "sample-qa", "customer-packet", "customer-candidate", "customer-qa", "evidence", "locks"]);
    for (const key of Object.keys(args)) if (!allowed.has(key)) throw new Error(`Unsupported --${key}; this tool publishes exactly one template quality lock.`);
    const result = await publishQualityLock({
      templatePath: required(args.template, "template"),
      samplePacket: required(args["sample-packet"], "sample-packet"),
      sampleCandidate: required(args["sample-candidate"], "sample-candidate"),
      sampleQa: required(args["sample-qa"], "sample-qa"),
      customerPacket: required(args["customer-packet"], "customer-packet"),
      customerCandidate: required(args["customer-candidate"], "customer-candidate"),
      customerQa: required(args["customer-qa"], "customer-qa"),
      evidence: args.evidence,
      locks: args.locks,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const allowed = command === "prepare-review" ? new Set(["template", "packet", "candidate", "out"]) : new Set(["template", "packet", "candidate", "out", "review"]);
  for (const key of Object.keys(args)) if (!allowed.has(key)) throw new Error(`Unsupported --${key}; this tool reviews exactly one template.`);
  const input = { templatePath: required(args.template, "template"), packetPath: required(args.packet, "packet"), candidatePath: required(args.candidate, "candidate"), out: required(args.out, "out"), review: args.review };
  const result = command === "prepare-review" ? await prepareReview(input) : await recordReview({ ...input, review: required(args.review, "review") });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (command === "record-review" && !result.passed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
