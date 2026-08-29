#!/usr/bin/env node
/**
 * capture.mjs — CLI entry for the standalone Meta Ad Library capture tool.
 *
 * Contract:
 *   node bin/capture.mjs --input '<json>'      # or: echo '<json>' | node bin/capture.mjs
 *
 *   Input JSON: { url, kind, metaPageId, country, activeStatus, resultsLimit,
 *                 timeoutMs, proxyUrl? }
 *
 *   stdout  = EXACTLY ONE MetaCaptureOutcome JSON object (from buildOutcome).
 *   stderr  = all logs.
 *   exit 0  = SUCCEEDED
 *   exit 2  = FAILED / blocked / TIMED_OUT
 *   exit 3  = invalid input
 */

import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { OUTCOME_STATUS, buildOutcome } from "../src/outcome.mjs";

/**
 * The crawler pulls in crawlee/playwright, which are installed inside the
 * tool's own node_modules (never shipped to the Vercel build). Import it lazily
 * so input validation and the FAILED-outcome contract work even where the
 * browser stack is absent — a missing browser must yield a structured FAILED
 * outcome, never a module-load crash.
 */
async function loadCrawler() {
  const { runMetaCapture } = await import("../src/crawler.mjs");
  return runMetaCapture;
}

const require = createRequire(import.meta.url);

const EXIT_OK = 0;
const EXIT_RUN_FAILED = 2;
const EXIT_INVALID_INPUT = 3;

const KINDS = new Set(["page", "location_search"]);
const ACTIVE_STATUSES = new Set(["active", "inactive", "all"]);

function logErr(line) {
  process.stderr.write(`${line}\n`);
}

/** Read all of stdin synchronously (fd 0). Returns "" when stdin is a TTY/empty. */
function readStdinSync() {
  try {
    return require("node:fs").readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function extractInputArg(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--input") return argv[i + 1];
    if (arg.startsWith("--input=")) return arg.slice("--input=".length);
  }
  return undefined;
}

/**
 * Validate + normalise raw input. Returns { ok, input } or { ok:false, error }.
 */
function validateInput(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "input must be a JSON object" };
  }

  const url = raw.url;
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return { ok: false, error: "input.url must be an http(s) URL string" };
  }

  const kind = raw.kind;
  if (!KINDS.has(kind)) {
    return { ok: false, error: `input.kind must be one of ${[...KINDS].join(" | ")}` };
  }

  const metaPageId = raw.metaPageId;
  if (metaPageId != null && typeof metaPageId !== "string") {
    return { ok: false, error: "input.metaPageId must be a string or null" };
  }

  const country = raw.country ?? "AU";
  if (typeof country !== "string" || !country.trim()) {
    return { ok: false, error: "input.country must be a non-empty string" };
  }

  const activeStatus = raw.activeStatus ?? "active";
  if (!ACTIVE_STATUSES.has(activeStatus)) {
    return { ok: false, error: `input.activeStatus must be one of ${[...ACTIVE_STATUSES].join(" | ")}` };
  }

  const resultsLimitRaw = raw.resultsLimit ?? 250;
  const resultsLimit = Number(resultsLimitRaw);
  if (!Number.isFinite(resultsLimit) || resultsLimit <= 0) {
    return { ok: false, error: "input.resultsLimit must be a positive number" };
  }
  if (resultsLimit > 250) {
    return { ok: false, error: "input.resultsLimit must be <= 250" };
  }

  const timeoutMsRaw = raw.timeoutMs ?? 120_000;
  const timeoutMs = Number(timeoutMsRaw);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { ok: false, error: "input.timeoutMs must be a positive number" };
  }

  const proxyUrl = raw.proxyUrl;
  if (proxyUrl != null && typeof proxyUrl !== "string") {
    return { ok: false, error: "input.proxyUrl must be a string when provided" };
  }

  return {
    ok: true,
    input: {
      url,
      kind,
      metaPageId: metaPageId ?? null,
      country,
      activeStatus,
      resultsLimit: Math.floor(resultsLimit),
      timeoutMs: Math.floor(timeoutMs),
      proxyUrl: proxyUrl ?? null,
    },
  };
}

async function main() {
  const argInput = extractInputArg(process.argv.slice(2));
  const rawText = argInput !== undefined ? argInput : readStdinSync();

  if (!rawText || !rawText.trim()) {
    logErr("invalid input: no input provided (use --input '<json>' or pipe JSON on stdin)");
    process.exit(EXIT_INVALID_INPUT);
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    logErr(`invalid input: could not parse JSON (${error?.message || error})`);
    process.exit(EXIT_INVALID_INPUT);
  }

  const validation = validateInput(parsed);
  if (!validation.ok) {
    logErr(`invalid input: ${validation.error}`);
    process.exit(EXIT_INVALID_INPUT);
  }

  const input = validation.input;
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  logErr(`capture start runId=${runId} kind=${input.kind} resultsLimit=${input.resultsLimit} timeoutMs=${input.timeoutMs}`);

  let result;
  try {
    const runMetaCapture = await loadCrawler();
    result = await runMetaCapture({ input, runId, logLine: logErr });
  } catch (error) {
    // A missing browser stack (crawlee/playwright not installed) throws here on
    // import; any runtime error throws from the crawler itself. Either way the
    // outcome contract holds: exactly one FAILED JSON object on stdout, exit 2.
    logErr(`capture error: ${error?.message || error}`);
    const outcome = buildOutcome({
      runId,
      startedAt,
      status: OUTCOME_STATUS.FAILED,
      items: [],
      errorMessage: `unexpected:${error?.message || error}`,
      metadata: { confirmed_absence: false },
    });
    process.stdout.write(`${JSON.stringify(outcome)}\n`);
    process.exit(EXIT_RUN_FAILED);
  }

  const metadata = {
    confirmed_absence: false,
    pages_loaded: result.pagesLoaded,
    scrolls: result.scrolls,
    evidence_dir: result.evidenceDir,
    graphql_responses: result.graphqlResponses,
    ad_library_responses: result.adLibraryResponses,
    kind: input.kind,
    meta_page_id: input.metaPageId,
    country: input.country,
    active_status: input.activeStatus,
    results_limit: input.resultsLimit,
  };

  let status;
  let errorMessage = null;

  if (result.blockedSignal) {
    status = OUTCOME_STATUS.FAILED;
    errorMessage = `blocked:${result.blockedSignal}`;
    metadata.blocked_reason = result.blockedSignal;
  } else if (result.timedOut) {
    status = OUTCOME_STATUS.TIMED_OUT;
    errorMessage = result.errorMessage ?? "timed_out";
  } else if (result.items.length > 0) {
    status = OUTCOME_STATUS.SUCCEEDED;
  } else if (result.errorMessage && result.adLibraryResponses === 0 && result.pagesLoaded === 0) {
    // The page never loaded / never produced a clean ad_library_main response.
    // This is NOT a trusted zero — report FAILED.
    status = OUTCOME_STATUS.FAILED;
    errorMessage = result.errorMessage;
  } else {
    // Clean load, no bot challenge, zero results → trusted confirmed absence.
    status = OUTCOME_STATUS.SUCCEEDED;
    metadata.confirmed_absence = true;
  }

  const outcome = buildOutcome({
    runId,
    startedAt,
    status,
    items: result.items,
    errorMessage,
    metadata,
  });

  // Exactly one JSON object on stdout.
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
  logErr(`capture done runId=${runId} status=${status} items=${outcome.itemCount} confirmed_absence=${metadata.confirmed_absence}`);
  process.exit(status === OUTCOME_STATUS.SUCCEEDED ? EXIT_OK : EXIT_RUN_FAILED);
}

main();
