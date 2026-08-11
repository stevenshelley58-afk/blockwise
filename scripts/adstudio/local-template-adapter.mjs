import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export const MIN_AD_SYSTEM_LIKENESS = 9.5;
export const MIN_STANDALONE_AD_QUALITY = 9;
export const SUBJECT_INVARIANT_RUBRIC_VERSION = "adstudio-subject-invariant-clone-v1";
export const CLONE_PACKET_STAGES = ["gallery_sample", "customer_fixture"];
export const CLONE_PACKET_TRANSPORTS = ["codex_subscription_image_generation", "google_image_api", "production_image_api"];

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function workspaceRelative(root, path) {
  const value = relative(root, resolve(path)).split(sep).join("/");
  if (!value || value.startsWith("../") || value === "..") {
    throw new Error(`Local adapter path must remain inside the workspace: ${path}`);
  }
  return value;
}

export function createLockedClonePacket(input) {
  const executionTransport = input.executionTransport ?? "codex_subscription_image_generation";
  if (!CLONE_PACKET_TRANSPORTS.includes(executionTransport)) {
    throw new Error("Local clone packet execution transport is invalid.");
  }
  const references = input.referencePaths.map((entry, index) => {
    const absolute = resolve(entry.path);
    if (!existsSync(absolute)) throw new Error(`Reference ${index + 1} was not found: ${absolute}`);
    return {
      index: index + 1,
      key: entry.key,
      role: entry.role,
      path: workspaceRelative(input.root, absolute),
      contentHash: sha256(readFileSync(absolute)),
    };
  });
  const body = {
    schemaVersion: 1,
    stage: input.stage ?? "gallery_sample",
    templateId: input.templateId,
    prompt: input.request.prompt,
    negativePrompt: input.request.negativePrompt ?? "",
    aspectRatio: input.request.aspectRatio,
    seed: input.request.seed ?? 0,
    copy: input.copy,
    references,
    expectedOutput: workspaceRelative(input.root, input.expectedOutput),
    executionTransport,
  };
  return { ...body, requestHash: sha256(canonicalJson(body)) };
}

export function verifyLockedClonePacket(packet, options) {
  if (packet?.schemaVersion !== 1) throw new Error("Unsupported local clone packet schema.");
  const { requestHash, ...body } = packet;
  const actualRequestHash = sha256(canonicalJson(body));
  if (!/^[a-f0-9]{64}$/u.test(requestHash ?? "") || requestHash !== actualRequestHash) {
    throw new Error("Local clone request packet changed after export.");
  }
  if (!Array.isArray(packet.references) || packet.references.length === 0) {
    throw new Error("Local clone request packet has no references.");
  }
  const stage = packet.stage ?? "gallery_sample";
  if (!CLONE_PACKET_STAGES.includes(stage)) throw new Error("Local clone packet stage is invalid.");
  if (!CLONE_PACKET_TRANSPORTS.includes(packet.executionTransport)) {
    throw new Error("Local clone packet execution transport is invalid.");
  }
  const expectedReferenceRole = stage === "customer_fixture" ? "approved_sample" : "source";
  if (packet.references[0]?.role !== expectedReferenceRole || packet.references[0]?.index !== 1) {
    throw new Error(stage === "customer_fixture"
      ? "Customer-fixture reference image 1 must be the approved public sample."
      : "Gallery-sample reference image 1 must be the private source ad.");
  }
  packet.references.forEach((reference, index) => {
    if (reference.index !== index + 1) throw new Error("Local clone reference order changed after export.");
    const absolute = resolve(options.root, reference.path);
    if (!existsSync(absolute)) throw new Error(`Locked reference was not found: ${reference.path}`);
    if (sha256(readFileSync(absolute)) !== reference.contentHash) {
      throw new Error(`Locked reference changed after export: ${reference.path}`);
    }
  });
  return { requestHash: actualRequestHash, stage };
}

export function validateLocalQaEvidence(input) {
  const { qa, packet, template, outputHash } = input;
  if ((packet.stage ?? "gallery_sample") !== "gallery_sample") {
    throw new Error("Only gallery-sample QA can approve a public template sample.");
  }
  if (qa?.schemaVersion !== 1 || qa.templateId !== template.id || qa.requestHash !== packet.requestHash) {
    throw new Error("Local QA evidence does not match the locked clone request.");
  }
  if (qa.passed !== true || qa.fullSizeReviewed !== true) {
    throw new Error("Local QA evidence must pass and include full-size review.");
  }
  if (!qa.contractReview?.passed || !qa.requestIntegrity?.passed) {
    throw new Error("Local QA contract and request-integrity checks must pass.");
  }
  const copyChecks = new Map((qa.copyChecks ?? []).map((check) => [check.key, check]));
  for (const field of template.inputs.text) {
    const check = copyChecks.get(field.key);
    if (!check?.exact || check.expected !== packet.copy[field.key]) {
      throw new Error(`Local QA exact-copy check failed for ${field.key}.`);
    }
  }
  const assetChecks = new Map((qa.assetChecks ?? []).map((check) => [check.key, check]));
  for (const field of template.inputs.images.filter((item) => item.required)) {
    const check = assetChecks.get(field.key);
    if (check?.used !== true || check.faithful !== true) {
      throw new Error(`Local QA asset check failed for ${field.key}.`);
    }
  }
  if ((qa.identityLeakage ?? []).length > 0 || (qa.defects ?? []).length > 0) {
    throw new Error("Local QA reported source identity leakage or visual defects.");
  }
  if (!Number.isInteger(qa.correctionCount) || qa.correctionCount < 0) {
    throw new Error("Local QA correction count must be a non-negative integer.");
  }
  if (!Number.isFinite(Date.parse(qa.reviewedAt ?? ""))) {
    throw new Error("Local QA evidence needs a valid review timestamp.");
  }
  if (!/^[a-f0-9]{64}$/u.test(qa.outputHash ?? "") || qa.outputHash !== outputHash) {
    throw new Error("Local QA evidence does not match the reviewed output image.");
  }
  const review = qa.visualReview;
  if (
    review?.rubricVersion !== SUBJECT_INVARIANT_RUBRIC_VERSION
    || review?.requestHash !== packet.requestHash
    || review?.candidateHash !== outputHash
  ) {
    throw new Error("Local visual review is not bound to this request and candidate image.");
  }
  if (!review.reviewer?.provider?.trim() || !review.reviewer?.model?.trim()) {
    throw new Error("Local visual review needs an identified image-model reviewer.");
  }
  if (!Number.isFinite(review.adSystemLikenessScore) || review.adSystemLikenessScore < MIN_AD_SYSTEM_LIKENESS) {
    throw new Error(`Local visual review likeness must be at least ${MIN_AD_SYSTEM_LIKENESS}.`);
  }
  if (!Number.isFinite(review.standaloneAdQualityScore) || review.standaloneAdQualityScore < MIN_STANDALONE_AD_QUALITY) {
    throw new Error(`Local visual review quality must be at least ${MIN_STANDALONE_AD_QUALITY}.`);
  }
  if (review.excludedContentInfluencedScore !== false) {
    throw new Error("Local visual review must exclude replaceable image content and copy wording from likeness.");
  }
  if (!Number.isFinite(Date.parse(review.reviewedAt ?? ""))) {
    throw new Error("Local visual review needs a valid review timestamp.");
  }
  return true;
}

export function localAuditEvidence(input) {
  return {
    schemaVersion: 1,
    stage: input.packet.stage ?? "gallery_sample",
    templateId: input.template.id,
    requestHash: input.packet.requestHash,
    inputHashes: Object.fromEntries(input.packet.references.map((reference) => [reference.key, reference.contentHash])),
    inputs: input.packet.references,
    request: {
      prompt: input.packet.prompt,
      negativePrompt: input.packet.negativePrompt,
      aspectRatio: input.packet.aspectRatio,
      seed: input.packet.seed,
    },
    outputHash: input.outputHash,
    executionTransport: input.packet.executionTransport,
    reviewedAt: input.qa.reviewedAt,
    correctionCount: input.qa.correctionCount,
    qa: {
      passed: input.qa.passed,
      fullSizeReviewed: input.qa.fullSizeReviewed,
      contractReview: input.qa.contractReview,
      requestIntegrity: input.qa.requestIntegrity,
      copyChecks: input.qa.copyChecks,
      assetChecks: input.qa.assetChecks,
      identityLeakage: input.qa.identityLeakage,
      defects: input.qa.defects,
      visualReview: input.qa.visualReview,
    },
  };
}
