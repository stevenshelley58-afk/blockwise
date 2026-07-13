#!/usr/bin/env node
// Gate 0 read-only provider-run baseline.
// Usage: node scripts/migrations/snapshot-provider-run-baseline.mjs --dry-run

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  assertIgnoredOutputPath,
  canonicalJson,
  sha256Bytes,
  sha256Canonical,
  writeSecureManifest as legacyWriteSecureManifest,
} from "./snapshot-legacy-creatives.mjs";
import {
  createSupabaseServerClient,
  resolveSupabaseServerCredential,
} from "../lib/supabase-server-credential.mjs";

export const WINDOW_START = "1970-01-01T00:00:00.000Z";
export const PROVIDER_RUN_COLUMNS = Object.freeze([
  "id",
  "workspace_id",
  "created_at",
  "task_type",
  "model_profile",
  "provider_name",
  "provider_type",
  "model_name",
  "status",
  "cost_estimate",
  "usage_json",
  "ai_run_id",
  "ai_usage_ledger_id",
]);
export const PROFILE_KEYS = Object.freeze([
  "image_draft",
  "image_final",
  "image_generative",
  "structured_json",
  "vision_classification",
]);

const PROFILE_VERSION_COLUMNS = [
  "id",
  "provider",
  "model",
  "input_usd_per_million_tokens",
  "output_usd_per_million_tokens",
  "image_usd_per_unit",
  "supports_structured_output",
  "max_context_tokens",
  "active_from",
  "active_to",
  "model_profiles!inner(key)",
].join(",");
const SCHEMA = "adstudio-provider-run-baseline/v1";
const QUERY_VERSION = "workspace-created-at-id-keyset-v1";
const MODEL_PROFILE_QUERY_VERSION = "active-at-window-end-v1";
const PAGE_SIZE = 1000;
const DEFAULT_MAX_LATENCY_MS = 12_000;
const TERMINAL_STATUSES = new Set(["completed", "failed", "blocked", "cancelled"]);
const UNKNOWN_SENTINELS = new Set(["unknown", "unset", "n/a", "other"]);
const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const MANIFEST_PATH = path.join(
  REPO_ROOT,
  "artifacts",
  "adstudio",
  "evidence",
  "provider-runs-manifest.json",
);
export const writeSecureManifest = legacyWriteSecureManifest;

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertIsoTimestamp(value, label) {
  if (typeof value !== "string" || !value || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  return value;
}

function assertHexDigest(value, length, label) {
  if (typeof value !== "string" || !new RegExp(`^[a-f0-9]{${length}}$`).test(value)) {
    throw new Error(`${label} must be a lowercase ${length}-character hexadecimal digest.`);
  }
  return value;
}

export function requireEnv(env = process.env) {
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const credential = resolveSupabaseServerCredential(env);
  if (!url || !credential) {
    throw new Error(
      "Missing env: set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).",
    );
  }
  return { url, serviceRoleKey: credential.value };
}

export function parseCliArgs(args) {
  if (!args.includes("--dry-run")) {
    throw new Error("--dry-run is required; provider baseline capture has no live mode.");
  }
  const liveFlags = ["--execute", "--live", "--write"].filter((flag) => args.includes(flag));
  if (liveFlags.length > 0) {
    throw new Error(`Live execution flags are forbidden during Gate 0: ${liveFlags.join(", ")}`);
  }
  const unsupported = args.filter((argument, index) => argument !== "--dry-run" || args.indexOf(argument) !== index);
  if (unsupported.length > 0) throw new Error("Unsupported argument supplied to provider baseline capture.");
  return { dryRun: true };
}

function compareRunKeys(left, right) {
  const timestampOrder = Date.parse(left.created_at) - Date.parse(right.created_at);
  return timestampOrder || String(left.id).localeCompare(String(right.id));
}

function normalizeProviderRun(row, { workspaceId, windowEnd }) {
  const normalized = Object.fromEntries(PROVIDER_RUN_COLUMNS.map((column) => [column, row?.[column] ?? null]));
  if (typeof normalized.id !== "string" || !normalized.id) {
    throw new Error("Provider-run row is missing its ID.");
  }
  if (normalized.workspace_id !== workspaceId) {
    throw new Error("Provider-run row escaped the requested workspace scope.");
  }
  assertIsoTimestamp(normalized.created_at, "Provider-run created_at");
  const createdAtMillis = Date.parse(normalized.created_at);
  if (createdAtMillis < Date.parse(WINDOW_START) || createdAtMillis >= Date.parse(windowEnd)) {
    throw new Error("Provider-run row escaped the frozen capture window.");
  }
  return normalized;
}

export async function loadProviderRunRows({ supabase, workspaceId, windowEnd, pageSize = PAGE_SIZE }) {
  assertIsoTimestamp(windowEnd, "Window end");
  if (typeof workspaceId !== "string" || !workspaceId) throw new Error("Workspace ID is required.");
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) throw new Error("Page size must be a positive integer.");

  const rows = [];
  let cursor = null;
  while (true) {
    let query = supabase
      .from("adstudio_provider_runs")
      .select(PROVIDER_RUN_COLUMNS.join(","))
      .eq("workspace_id", workspaceId)
      .gte("created_at", WINDOW_START)
      .lt("created_at", windowEnd)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(pageSize);
    if (cursor) {
      query = query.or(
        `created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id})`,
      );
    }
    const { data, error } = await query;
    if (error) throw new Error("Unable to read provider-run evidence.");
    if (!Array.isArray(data)) throw new Error("Provider-run evidence query returned no data.");
    if (data.length === 0) break;

    for (const candidate of data) {
      const row = normalizeProviderRun(candidate, { workspaceId, windowEnd });
      if (cursor && compareRunKeys(row, cursor) <= 0) {
        throw new Error("Provider-run pages are not strictly ordered by created_at and ID.");
      }
      rows.push(row);
      cursor = row;
    }
  }
  return rows;
}

export async function listWorkspaceIds({ supabase, pageSize = PAGE_SIZE }) {
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) throw new Error("Page size must be a positive integer.");
  const workspaceIds = [];
  let cursor = null;
  while (true) {
    let query = supabase.from("workspaces").select("id").order("id", { ascending: true }).limit(pageSize);
    if (cursor !== null) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error) throw new Error("Unable to enumerate workspaces.");
    if (!Array.isArray(data)) throw new Error("Workspace enumeration returned no data.");
    if (data.length === 0) break;
    const nextCursor = data.at(-1)?.id;
    if (typeof nextCursor !== "string" || !nextCursor || nextCursor === cursor) {
      throw new Error("Workspace pagination did not advance.");
    }
    for (const row of data) {
      if (typeof row?.id !== "string" || !row.id) throw new Error("Workspace enumeration returned an invalid ID.");
      workspaceIds.push(row.id);
    }
    cursor = nextCursor;
  }
  return [...new Set(workspaceIds)].sort();
}

export async function loadActiveProfileVersionRows({ supabase, windowEnd }) {
  assertIsoTimestamp(windowEnd, "Window end");
  const { data, error } = await supabase
    .from("model_profile_versions")
    .select(PROFILE_VERSION_COLUMNS)
    .lt("active_from", windowEnd)
    .or(`active_to.is.null,active_to.gte.${windowEnd}`)
    .order("active_from", { ascending: false })
    .order("id", { ascending: true });
  if (error) throw new Error("Unable to load active model profile versions.");
  if (!Array.isArray(data)) throw new Error("Unable to load active model profile versions: query returned no data.");
  return data;
}

function joinedProfileKey(value) {
  const joined = Array.isArray(value) ? value[0] : value;
  return typeof joined?.key === "string" ? joined.key : null;
}

function finiteNonNegative(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Active model profile version has invalid ${label}.`);
  return parsed;
}

function toPersistedVersion(row) {
  const profileKey = joinedProfileKey(row.model_profiles);
  if (!PROFILE_KEYS.includes(profileKey)) return null;
  if (typeof row.id !== "string" || !row.id || typeof row.model !== "string" || !row.model.trim()) {
    throw new Error("Active model profile version is missing its version ID or model slug.");
  }
  if (!["openai", "openrouter", "azure", "google", "fal"].includes(row.provider)) {
    throw new Error("Active model profile version has an unsupported provider.");
  }
  return {
    id: row.id,
    profileKey,
    provider: row.provider,
    model: row.model,
    inputUsdPerMillionTokens: finiteNonNegative(row.input_usd_per_million_tokens, "input token price"),
    outputUsdPerMillionTokens: finiteNonNegative(row.output_usd_per_million_tokens, "output token price"),
    imageUsdPerUnit: finiteNonNegative(row.image_usd_per_unit, "image unit price"),
    supportsStructuredOutput: row.supports_structured_output === true,
    maxContextTokens: finiteNonNegative(row.max_context_tokens, "context limit"),
    maxLatencyMs: DEFAULT_MAX_LATENCY_MS,
    activeFrom: assertIsoTimestamp(row.active_from, "Active model profile version active_from"),
  };
}

function candidateEvidence(candidate) {
  const versionId = candidate.modelProfileVersionId ?? null;
  const pricingId = candidate.pricingSnapshotId ?? null;
  return {
    provider: candidate.provider,
    model: candidate.model,
    modelProfileVersionIdSha256: versionId ? sha256Text(versionId) : null,
    pricingSnapshotIdSha256: pricingId ? sha256Text(pricingId) : null,
    pricingSource: candidate.pricingSource ?? "default",
    inputUsdPerMillionTokens: candidate.inputUsdPerMillionTokens,
    outputUsdPerMillionTokens: candidate.outputUsdPerMillionTokens,
    imageUsdPerUnit: candidate.imageUsdPerUnit,
    supportsStructuredOutput: candidate.supportsStructuredOutput,
    maxContextTokens: candidate.maxContextTokens,
    maxLatencyMs: candidate.maxLatencyMs,
  };
}

export function resolveModelProfileEvidence(versionRows, resolveProfile) {
  if (typeof resolveProfile !== "function") {
    throw new Error("A committed runtime model-profile resolver is required.");
  }
  const persisted = versionRows
    .map(toPersistedVersion)
    .filter(Boolean)
    .sort((left, right) =>
      String(right.activeFrom).localeCompare(String(left.activeFrom)) || String(left.id).localeCompare(String(right.id)),
    );

  return PROFILE_KEYS.map((profileKey) => {
    const active = persisted.find((version) => version.profileKey === profileKey) ?? null;
    const resolved = resolveProfile(profileKey, persisted);
    return {
      profileKey,
      source: active ? "persisted" : "default",
      activeVersionIdSha256: active ? sha256Text(active.id) : null,
      profile: {
        label: resolved.profile.label,
        task: resolved.profile.task,
        enabled: resolved.profile.enabled,
        requiresStructuredOutput: resolved.profile.requiresStructuredOutput,
        maxRunCostUsd: resolved.profile.maxRunCostUsd,
        defaultTemperature: resolved.profile.defaultTemperature,
      },
      primary: candidateEvidence(resolved.primary),
      fallbacks: resolved.fallbacks.map(candidateEvidence),
    };
  });
}

function decimalFrom(value) {
  if (value === null || value === undefined || value === "") return null;
  const match = String(value).trim().match(/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
  if (!match) return null;
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent)) return null;
  let coefficient = BigInt(`${match[1] === "-" ? "-" : ""}${match[2]}${match[3] ?? ""}`);
  let scale = (match[3]?.length ?? 0) - exponent;
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  return { coefficient, scale };
}

function addDecimal(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return {
    coefficient:
      left.coefficient * 10n ** BigInt(scale - left.scale) +
      right.coefficient * 10n ** BigInt(scale - right.scale),
    scale,
  };
}

function formatDecimal(decimal) {
  const negative = decimal.coefficient < 0n;
  const digits = (negative ? -decimal.coefficient : decimal.coefficient).toString().padStart(decimal.scale + 1, "0");
  if (decimal.scale === 0) return `${negative ? "-" : ""}${digits}`;
  const integer = digits.slice(0, -decimal.scale);
  const fraction = digits.slice(-decimal.scale).replace(/0+$/, "");
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

function usageEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { missing: true, allZero: false, nonZero: false };
  const keys = [
    "inputTokens",
    "outputTokens",
    "imageUnits",
    "input_tokens",
    "output_tokens",
    "image_units",
    "prompt_tokens",
    "completion_tokens",
  ];
  const numbers = keys.filter((key) => Object.hasOwn(value, key)).map((key) => Number(value[key])).filter(Number.isFinite);
  if (numbers.length === 0) return { missing: true, allZero: false, nonZero: false };
  return { missing: false, allZero: numbers.every((number) => number === 0), nonZero: numbers.some((number) => number !== 0) };
}

function dimensionClass(value) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return "null";
  return UNKNOWN_SENTINELS.has(String(value).trim().toLowerCase()) ? "unknown" : "known";
}

function displayDimension(value) {
  const classification = dimensionClass(value);
  if (classification === "null") return "(null)";
  if (classification === "unknown") return "(unknown)";
  return String(value);
}

function groupedCounts(rows, fields) {
  const counts = new Map();
  for (const row of rows) {
    const values = fields.map((field) => displayDimension(row[field]));
    const key = canonicalJson(values);
    const current = counts.get(key) ?? { values, count: 0 };
    current.count += 1;
    counts.set(key, current);
  }
  return [...counts.values()].sort((left, right) => canonicalJson(left.values).localeCompare(canonicalJson(right.values)));
}

function buildPublicSummary(rows, workspaceIds) {
  const sortedWorkspaces = [...workspaceIds].sort();
  const cost = {
    positive: { count: 0, decimal: { coefficient: 0n, scale: 0 } },
    zero: { count: 0, decimal: { coefficient: 0n, scale: 0 } },
    negative: { count: 0, decimal: { coefficient: 0n, scale: 0 } },
    unknownCount: 0,
  };
  let missingUsageCount = 0;
  let allZeroUsageCount = 0;
  let zeroCostUsageAnomalyCount = 0;
  const dimensions = ["task_type", "model_profile", "provider_name", "provider_type", "model_name", "status"];
  const dimensionQuality = Object.fromEntries(
    dimensions.map((field) => [field, { nullCount: 0, unknownCount: 0 }]),
  );

  for (const row of rows) {
    const parsedCost = decimalFrom(row.cost_estimate);
    if (!parsedCost) {
      cost.unknownCount += 1;
    } else {
      const category = parsedCost.coefficient > 0n ? "positive" : parsedCost.coefficient < 0n ? "negative" : "zero";
      cost[category].count += 1;
      cost[category].decimal = addDecimal(cost[category].decimal, parsedCost);
    }
    const usage = usageEvidence(row.usage_json);
    if (usage.missing) missingUsageCount += 1;
    if (usage.allZero) allZeroUsageCount += 1;
    const nonLocal = row.provider_name !== "deterministic_local" && row.provider_type !== "local";
    if (
      nonLocal &&
      TERMINAL_STATUSES.has(String(row.status)) &&
      parsedCost?.coefficient === 0n &&
      usage.nonZero
    ) {
      zeroCostUsageAnomalyCount += 1;
    }
    for (const field of dimensions) {
      const classification = dimensionClass(row[field]);
      if (classification === "null") dimensionQuality[field].nullCount += 1;
      if (classification === "unknown") dimensionQuality[field].unknownCount += 1;
    }
  }

  const workspaceSummaries = sortedWorkspaces.map((workspaceId) => {
    const runIds = rows.filter((row) => row.workspace_id === workspaceId).map((row) => row.id).sort();
    return {
      pseudonym: `workspace-${sha256Canonical(["workspace", workspaceId]).slice(0, 16)}`,
      runCount: runIds.length,
      runIdSetSha256: sha256Canonical(runIds),
    };
  });
  const globalRunIds = rows.map((row) => [row.workspace_id, row.id]).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  const simpleGroup = (field) => groupedCounts(rows, [field]).map(({ values, count }) => ({ value: values[0], count }));
  const providerModel = groupedCounts(rows, ["provider_name", "provider_type", "model_name"]).map(
    ({ values, count }) => ({ providerName: values[0], providerType: values[1], modelName: values[2], count }),
  );
  const linked = (field) => {
    const linkedCount = rows.filter((row) => typeof row[field] === "string" && row[field]).length;
    return { linkedCount, missingCount: rows.length - linkedCount };
  };

  return {
    totalRuns: rows.length,
    workspaceIdSetSha256: sha256Canonical(sortedWorkspaces),
    globalRunIdSetSha256: sha256Canonical(globalRunIds),
    workspaces: workspaceSummaries,
    grouped: {
      taskType: simpleGroup("task_type"),
      modelProfile: simpleGroup("model_profile"),
      providerModel,
      status: simpleGroup("status"),
    },
    cost: {
      positive: { count: cost.positive.count, sum: formatDecimal(cost.positive.decimal) },
      zero: { count: cost.zero.count, sum: formatDecimal(cost.zero.decimal) },
      negative: { count: cost.negative.count, sum: formatDecimal(cost.negative.decimal) },
      unknownCount: cost.unknownCount,
    },
    anomalies: {
      nonLocalTerminalNonZeroUsageZeroCostCount: zeroCostUsageAnomalyCount,
      missingUsageCount,
      allZeroUsageCount,
      missingOrAllZeroUsageCount: missingUsageCount + allZeroUsageCount,
    },
    links: {
      aiRun: linked("ai_run_id"),
      aiUsageLedger: linked("ai_usage_ledger_id"),
    },
    dimensionQuality: {
      taskType: dimensionQuality.task_type,
      modelProfile: dimensionQuality.model_profile,
      providerName: dimensionQuality.provider_name,
      providerType: dimensionQuality.provider_type,
      modelName: dimensionQuality.model_name,
      status: dimensionQuality.status,
    },
  };
}

function sortedNormalizedRows(rows, workspaceIds, windowEnd) {
  const workspaceSet = new Set(workspaceIds);
  const normalized = rows.map((row) => {
    if (!workspaceSet.has(row.workspace_id)) throw new Error("Provider-run evidence references an unenumerated workspace.");
    return normalizeProviderRun(row, { workspaceId: row.workspace_id, windowEnd });
  });
  normalized.sort((left, right) =>
    String(left.workspace_id).localeCompare(String(right.workspace_id)) || compareRunKeys(left, right),
  );
  const runIds = new Set();
  for (const row of normalized) {
    const key = canonicalJson([row.workspace_id, row.id]);
    if (runIds.has(key)) throw new Error("Provider-run evidence contains a duplicate run ID.");
    runIds.add(key);
  }
  return normalized;
}

export function buildProviderBaselineManifest({
  projectRef,
  sourceCommit,
  toolSourceSha256,
  capturedAtStart,
  capturedAtEnd,
  windowEnd,
  workspaceIds,
  firstPassRows,
  secondPassRows,
  modelProfiles,
  secondModelProfiles = modelProfiles,
}) {
  const captureStart = assertIsoTimestamp(capturedAtStart, "Capture start");
  const captureEnd = assertIsoTimestamp(capturedAtEnd, "Capture end");
  assertIsoTimestamp(windowEnd, "Window end");
  if (Date.parse(captureEnd) < Date.parse(captureStart)) throw new Error("Capture end precedes capture start.");
  if (typeof projectRef !== "string" || !projectRef.trim()) throw new Error("Supabase project reference is required.");
  if (typeof sourceCommit !== "string" || !/^[a-f0-9]{40,64}$/.test(sourceCommit)) {
    throw new Error("Source commit must be a lowercase Git object ID.");
  }
  assertHexDigest(toolSourceSha256, 64, "Tool source SHA-256");
  if (!Array.isArray(workspaceIds) || workspaceIds.some((id) => typeof id !== "string" || !id)) {
    throw new Error("Workspace evidence set contains an invalid ID.");
  }
  if (new Set(workspaceIds).size !== workspaceIds.length) {
    throw new Error("Workspace evidence set contains a duplicate ID.");
  }
  if (!Array.isArray(modelProfiles) || !Array.isArray(secondModelProfiles)) {
    throw new Error("Resolved model-profile evidence must be an array.");
  }
  const sortedWorkspaces = [...new Set(workspaceIds)].sort();
  const firstRows = sortedNormalizedRows(firstPassRows, sortedWorkspaces, windowEnd);
  const secondRows = sortedNormalizedRows(secondPassRows, sortedWorkspaces, windowEnd);
  const firstPassSha256 = sha256Canonical(firstRows);
  const secondPassSha256 = sha256Canonical(secondRows);
  const firstModelProfilesSha256 = sha256Canonical(modelProfiles);
  const secondModelProfilesSha256 = sha256Canonical(secondModelProfiles);
  const queryDefinition = {
    version: QUERY_VERSION,
    table: "adstudio_provider_runs",
    columns: PROVIDER_RUN_COLUMNS,
    window: { startInclusive: WINDOW_START, endExclusive: windowEnd },
    workspaceFilter: "workspace_id=eq.<enumerated-workspace>",
    order: ["created_at.asc", "id.asc"],
  };
  const modelProfileQueryDefinition = {
    version: MODEL_PROFILE_QUERY_VERSION,
    table: "model_profile_versions",
    columns: PROFILE_VERSION_COLUMNS.split(","),
    windowEndExclusive: windowEnd,
    filters: ["active_from.lt.<window-end>", "active_to.is.null OR active_to.gte.<window-end>"],
    order: ["active_from.desc", "id.asc"],
  };
  const privateEvidence = {
    workspaces: sortedWorkspaces.map((workspaceId) => {
      const workspaceRows = firstRows.filter((row) => row.workspace_id === workspaceId);
      return {
        workspaceId,
        runIdSetSha256: sha256Canonical(workspaceRows.map((row) => row.id).sort()),
        rows: workspaceRows,
      };
    }),
  };
  const publicSummary = buildPublicSummary(firstRows, sortedWorkspaces);
  const providerRunDriftDetected = firstPassSha256 !== secondPassSha256;
  const modelProfileDriftDetected = firstModelProfilesSha256 !== secondModelProfilesSha256;
  const driftDetected = providerRunDriftDetected || modelProfileDriftDetected;
  const withoutManifestHash = {
    schema: SCHEMA,
    schemaSha256: sha256Canonical({
      schema: SCHEMA,
      providerRunColumns: PROVIDER_RUN_COLUMNS,
      modelProfileVersionColumns: PROFILE_VERSION_COLUMNS.split(","),
    }),
    preliminaryPreFence: true,
    projectRef,
    source: {
      commit: sourceCommit,
      commitSha256: sha256Text(sourceCommit),
      toolSha256: toolSourceSha256,
    },
    capture: {
      capturedAtStart,
      capturedAtEnd,
      window: { startInclusive: WINDOW_START, endExclusive: windowEnd },
    },
    query: {
      ...queryDefinition,
      columnsSha256: sha256Canonical(PROVIDER_RUN_COLUMNS),
      sha256: sha256Canonical(queryDefinition),
    },
    drift: {
      detected: driftDetected,
      firstPassSha256,
      secondPassSha256,
      providerRunsDetected: providerRunDriftDetected,
      modelProfilesDetected: modelProfileDriftDetected,
      firstModelProfilesSha256,
      secondModelProfilesSha256,
    },
    acceptanceEligible: !driftDetected,
    modelProfiles: {
      resolution: "active-persisted-primary-with-committed-defaults-and-fallbacks",
      query: {
        ...modelProfileQueryDefinition,
        sha256: sha256Canonical(modelProfileQueryDefinition),
      },
      sha256: firstModelProfilesSha256,
      profiles: modelProfiles,
    },
    publicSummary,
    privateEvidence,
  };
  return { ...withoutManifestHash, manifestSha256: sha256Canonical(withoutManifestHash) };
}

export async function runProviderBaseline({
  supabase,
  repoRoot,
  outputPath,
  projectRef,
  sourceCommit,
  toolSourceSha256,
  now = () => new Date().toISOString(),
  listWorkspaces = listWorkspaceIds,
  loadRows = loadProviderRunRows,
  loadProfiles = loadActiveProfileVersionRows,
  resolveProfiles,
  writeManifest = legacyWriteSecureManifest,
  logger = console.log,
}) {
  const capturedAtStart = assertIsoTimestamp(now(), "Capture start");
  const windowEnd = capturedAtStart;
  const workspaceIds = [...new Set(await listWorkspaces({ supabase }))].sort();
  const collectPass = async () => {
    const rows = [];
    for (const workspaceId of workspaceIds) {
      rows.push(...await loadRows({ supabase, workspaceId, windowEnd }));
    }
    return rows;
  };
  const firstPassRows = await collectPass();
  if (typeof resolveProfiles !== "function") throw new Error("A runtime profile evidence resolver is required.");
  const firstProfileRows = await loadProfiles({ supabase, windowEnd });
  const modelProfiles = resolveProfiles(firstProfileRows);
  const secondPassRows = await collectPass();
  const secondProfileRows = await loadProfiles({ supabase, windowEnd });
  const secondModelProfiles = resolveProfiles(secondProfileRows);
  const capturedAtEnd = assertIsoTimestamp(now(), "Capture end");
  const manifest = buildProviderBaselineManifest({
    projectRef,
    sourceCommit,
    toolSourceSha256,
    capturedAtStart,
    capturedAtEnd,
    windowEnd,
    workspaceIds,
    firstPassRows,
    secondPassRows,
    modelProfiles,
    secondModelProfiles,
  });
  const written = await writeManifest({ repoRoot, outputPath, manifest });
  logger("Gate 0 provider-run baseline completed in production-read-only mode.");
  logger(`Workspaces scanned: ${workspaceIds.length}`);
  logger(`Runs scanned: ${manifest.publicSummary.totalRuns}`);
  logger(`Workspace set SHA-256: ${manifest.publicSummary.workspaceIdSetSha256}`);
  logger(`Global run ID set SHA-256: ${manifest.publicSummary.globalRunIdSetSha256}`);
  logger(`First pass SHA-256: ${manifest.drift.firstPassSha256}`);
  logger(`Second pass SHA-256: ${manifest.drift.secondPassSha256}`);
  logger(`First model-profile pass SHA-256: ${manifest.drift.firstModelProfilesSha256}`);
  logger(`Second model-profile pass SHA-256: ${manifest.drift.secondModelProfilesSha256}`);
  logger(`Drift detected: ${manifest.drift.detected ? "yes" : "no"}`);
  logger(`Logical manifest SHA-256: ${manifest.manifestSha256}`);
  logger(`Written file SHA-256: ${written.fileSha256}`);
  logger(`Status: ${manifest.acceptanceEligible ? "eligible for Gate 0 evidence review" : "blocked"}`);
  return { manifest, written, exitCode: manifest.acceptanceEligible ? 0 : 1 };
}

function repoRelativePath(repoRoot, target) {
  const relative = path.relative(path.resolve(repoRoot), path.resolve(target));
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Tool source must be a file inside the repository.");
  }
  return relative.split(path.sep).join("/");
}

export async function collectVerifiedToolEvidence({ repoRoot, scriptPath }) {
  const relative = repoRelativePath(repoRoot, scriptPath);
  try {
    await execFileAsync("git", ["ls-files", "--error-unmatch", "--", relative], { cwd: repoRoot, windowsHide: true });
    await execFileAsync("git", ["diff", "--quiet", "HEAD", "--", relative], { cwd: repoRoot, windowsHide: true });
    const { stdout: workingBlob } = await execFileAsync("git", ["hash-object", `--path=${relative}`, relative], {
      cwd: repoRoot,
      encoding: "utf8",
      windowsHide: true,
    });
    const { stdout: committedBlob } = await execFileAsync("git", ["rev-parse", `HEAD:${relative}`], {
      cwd: repoRoot,
      encoding: "utf8",
      windowsHide: true,
    });
    if (workingBlob.trim() !== committedBlob.trim()) throw new Error("source mismatch");
  } catch {
    throw new Error("Provider baseline tool must be tracked and match HEAD before evidence capture.");
  }
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    sourceCommit: stdout.trim(),
    toolSourceSha256: sha256Bytes(await readFile(scriptPath)),
  };
}

async function main() {
  parseCliArgs(process.argv.slice(2));
  const scriptPath = fileURLToPath(import.meta.url);
  const sourceEvidence = await collectVerifiedToolEvidence({ repoRoot: REPO_ROOT, scriptPath });
  await assertIgnoredOutputPath({ repoRoot: REPO_ROOT, outputPath: MANIFEST_PATH });
  const { url } = requireEnv();
  const [{ createClient }, { resolveEffectiveModelProfile }] = await Promise.all([
    import("@supabase/supabase-js"),
    import("../../src/lib/ai/model-registry.ts"),
  ]);
  const supabase = createSupabaseServerClient(createClient, url, process.env, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const projectRef = process.env.SUPABASE_PROJECT_REF?.trim() || new URL(url).hostname.split(".")[0];
  const result = await runProviderBaseline({
    supabase,
    repoRoot: REPO_ROOT,
    outputPath: MANIFEST_PATH,
    projectRef,
    ...sourceEvidence,
    resolveProfiles: (rows) => resolveModelProfileEvidence(rows, resolveEffectiveModelProfile),
  });
  process.exitCode = result.exitCode;
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
