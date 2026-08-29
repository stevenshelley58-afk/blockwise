#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const GENERATION_TRACE_SCHEMA = "adstudio.generation-trace.v1";
export const LIKENESS_THRESHOLD = 9.5;
export const MAX_GENERATIONS = 30;

const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : canonical(value)).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function score(value, label) {
  const number = Number(value);
  assert(Number.isFinite(number) && number >= 0 && number <= 10, `${label} must be between 0 and 10`);
  return Math.round(number * 10) / 10;
}

function safeId(value, label) {
  const result = String(value || "").trim();
  assert(SAFE_ID.test(result), `${label} must be a safe stable identifier`);
  return result;
}

function hash(value, label) {
  const result = String(value || "").trim().toLowerCase();
  assert(SHA256.test(result), `${label} must be a lowercase SHA-256`);
  return result;
}

export function createGenerationTrace({ templateId, sourceSha256, seedSha256 = null }) {
  const trace = {
    schema: GENERATION_TRACE_SCHEMA,
    templateId: safeId(templateId, "templateId"),
    sourceSha256: hash(sourceSha256, "sourceSha256"),
    seedSha256: seedSha256 ? hash(seedSha256, "seedSha256") : null,
    threshold: LIKENESS_THRESHOLD,
    maxGenerations: MAX_GENERATIONS,
    status: "active",
    generations: [],
  };
  return { ...trace, traceSha256: sha256(trace) };
}

export function validateGenerationTrace(value) {
  assert(value && typeof value === "object" && !Array.isArray(value), "generation trace must be an object");
  assert(value.schema === GENERATION_TRACE_SCHEMA, `generation trace schema must be ${GENERATION_TRACE_SCHEMA}`);
  safeId(value.templateId, "templateId");
  hash(value.sourceSha256, "sourceSha256");
  if (value.seedSha256 !== null) hash(value.seedSha256, "seedSha256");
  assert(value.threshold === LIKENESS_THRESHOLD, `threshold must be ${LIKENESS_THRESHOLD}`);
  assert(value.maxGenerations === MAX_GENERATIONS, `maxGenerations must be ${MAX_GENERATIONS}`);
  assert(["active", "accepted", "exhausted"].includes(value.status), "status is invalid");
  assert(Array.isArray(value.generations) && value.generations.length <= MAX_GENERATIONS, `generations must contain at most ${MAX_GENERATIONS} records`);
  let accepted = false;
  value.generations.forEach((generation, index) => {
    assert(generation.iteration === index + 1, "generation iterations must be consecutive and one-based");
    assert(!accepted, "no generation may follow an accepted generation");
    hash(generation.artifacts.feedSha256, "artifacts.feedSha256");
    hash(generation.artifacts.storySha256, "artifacts.storySha256");
    hash(generation.artifacts.renderSetSha256, "artifacts.renderSetSha256");
    const primaryReviewer = safeId(generation.reviewers.primary, "reviewers.primary");
    const strictReviewer = safeId(generation.reviewers.strict, "reviewers.strict");
    assert(primaryReviewer !== strictReviewer, "primary and strict reviewers must be independent identities");
    const primary = score(generation.scores.primaryAdSystemLikeness, "scores.primaryAdSystemLikeness");
    const strict = score(generation.scores.strictAdSystemLikeness, "scores.strictAdSystemLikeness");
    const passed = primary >= LIKENESS_THRESHOLD && strict >= LIKENESS_THRESHOLD;
    assert(generation.decision === (passed ? "accepted" : "revise"), "generation decision must match the numeric gate");
    assert(typeof generation.revisionReason === "string" && generation.revisionReason.trim().length >= 8, "revisionReason must explain the decision");
    const unsigned = { ...generation };
    delete unsigned.recordSha256;
    assert(generation.recordSha256 === sha256(unsigned), "generation record hash is stale");
    accepted = passed;
  });
  assert(value.status === (accepted ? "accepted" : value.generations.length === MAX_GENERATIONS ? "exhausted" : "active"), "trace status does not match its generations");
  const unsignedTrace = { ...value };
  delete unsignedTrace.traceSha256;
  assert(value.traceSha256 === sha256(unsignedTrace), "generation trace hash is stale");
  return value;
}

export function appendGeneration(trace, input) {
  validateGenerationTrace(trace);
  assert(trace.status === "active", "cannot append to a closed generation trace");
  const iteration = trace.generations.length + 1;
  assert(iteration <= MAX_GENERATIONS, `generation budget exhausted at ${MAX_GENERATIONS}`);
  const primary = score(input.primaryScore, "primaryScore");
  const strict = score(input.strictScore, "strictScore");
  const passed = primary >= LIKENESS_THRESHOLD && strict >= LIKENESS_THRESHOLD;
  const record = {
    iteration,
    artifacts: {
      feedSha256: hash(input.feedSha256, "feedSha256"),
      storySha256: hash(input.storySha256, "storySha256"),
      renderSetSha256: hash(input.renderSetSha256, "renderSetSha256"),
    },
    reviewers: {
      primary: safeId(input.primaryReviewer, "primaryReviewer"),
      strict: safeId(input.strictReviewer, "strictReviewer"),
    },
    scores: {
      primaryAdSystemLikeness: primary,
      strictAdSystemLikeness: strict,
    },
    threshold: LIKENESS_THRESHOLD,
    decision: passed ? "accepted" : "revise",
    revisionReason: String(input.revisionReason || "").trim(),
  };
  assert(record.reviewers.primary !== record.reviewers.strict, "primary and strict reviewers must be independent identities");
  assert(record.revisionReason.length >= 8, "revisionReason must explain the decision");
  record.recordSha256 = sha256(record);
  const next = {
    ...trace,
    status: passed ? "accepted" : iteration === MAX_GENERATIONS ? "exhausted" : "active",
    generations: [...trace.generations, record],
  };
  delete next.traceSha256;
  next.traceSha256 = sha256(next);
  return validateGenerationTrace(next);
}

function args(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) parsed._.push(token);
    else parsed[token.slice(2)] = argv[++index];
  }
  return parsed;
}

function usage() {
  return [
    "generation-trace.mjs init --trace <file> --template <id> --source-sha <sha256> [--seed-sha <sha256>]",
    "generation-trace.mjs record --trace <file> --feed-sha <sha256> --story-sha <sha256> --render-set-sha <sha256> --primary-reviewer <id> --strict-reviewer <id> --primary-score <0..10> --strict-score <0..10> --revision-reason <text>",
    "generation-trace.mjs validate --trace <file>",
  ].join("\n");
}

export function runCli(argv) {
  const parsed = args(argv);
  const command = parsed._[0];
  const tracePath = parsed.trace ? resolve(parsed.trace) : "";
  assert(tracePath, `--trace is required\n${usage()}`);
  if (command === "init") {
    const trace = createGenerationTrace({ templateId: parsed.template, sourceSha256: parsed["source-sha"], seedSha256: parsed["seed-sha"] || null });
    writeFileSync(tracePath, `${JSON.stringify(trace, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return trace;
  }
  const trace = JSON.parse(readFileSync(tracePath, "utf8"));
  if (command === "validate") return validateGenerationTrace(trace);
  if (command === "record") {
    const next = appendGeneration(trace, {
      feedSha256: parsed["feed-sha"], storySha256: parsed["story-sha"], renderSetSha256: parsed["render-set-sha"],
      primaryReviewer: parsed["primary-reviewer"], strictReviewer: parsed["strict-reviewer"],
      primaryScore: parsed["primary-score"], strictScore: parsed["strict-score"], revisionReason: parsed["revision-reason"],
    });
    writeFileSync(tracePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
  }
  throw new Error(usage());
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.stdout.write(`${JSON.stringify(runCli(process.argv.slice(2)))}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
