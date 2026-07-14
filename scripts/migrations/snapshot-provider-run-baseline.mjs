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
  writeSecureManifest,
} from "../lib/secure-manifest.mjs";
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
  "model_profile_version_id",
  "pricing_snapshot_id",
  "status",
  "cost_estimate",
  "estimated_cost_usd",
  "actual_cost_usd",
  "billing_status",
  "usage_json",
  "ai_run_id",
  "ai_usage_ledger_id",
]);
export const PROVIDER_ATTEMPT_COLUMNS = Object.freeze([
  "id",
  "workspace_id",
  "provider_run_id",
  "attempt_index",
  "provider_name",
  "provider_type",
  "model_name",
  "model_profile",
  "model_profile_version_id",
  "pricing_snapshot_id",
  "status",
  "request_submitted",
  "billing_status",
  "usage_json",
  "pricing_json",
  "estimated_cost_usd",
  "actual_cost_usd",
  "created_at",
]);
export const PROFILE_KEYS = Object.freeze([
  "image_draft",
  "image_final",
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
const MODEL_PROFILE_QUERY_VERSION = "active-at-window-end-active-from-id-desc-keyset-v2";
const PAGE_SIZE = 1000;
const DEFAULT_MAX_LATENCY_MS = 12_000;
const COST_DECIMAL_PLACES = 6;
const ATTEMPT_ACCOUNTING_POLICY = Object.freeze({
  arithmetic: "exact-base-10",
  formula: "inputTokens*inputUsdPerMillionTokens/1000000 + outputTokens*outputUsdPerMillionTokens/1000000 + imageUnits*imageUsdPerUnit",
  rounding: "half-away-from-zero-to-6-decimal-places",
  comparison: "exact-after-rounding",
  toleranceUsd: "0",
});
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
export { writeSecureManifest };

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

function normalizeProviderAttempt(row, { workspaceId, windowEnd }) {
  const normalized = Object.fromEntries(PROVIDER_ATTEMPT_COLUMNS.map((column) => [column, row?.[column] ?? null]));
  if (typeof normalized.id !== "string" || !normalized.id) {
    throw new Error("Provider-attempt row is missing its ID.");
  }
  if (typeof normalized.provider_run_id !== "string" || !normalized.provider_run_id) {
    throw new Error("Provider-attempt row is missing its provider-run ID.");
  }
  if (normalized.workspace_id !== workspaceId) {
    throw new Error("Provider-attempt row escaped the requested workspace scope.");
  }
  assertIsoTimestamp(normalized.created_at, "Provider-attempt created_at");
  const createdAtMillis = Date.parse(normalized.created_at);
  if (createdAtMillis < Date.parse(WINDOW_START) || createdAtMillis >= Date.parse(windowEnd)) {
    throw new Error("Provider-attempt row escaped the frozen capture window.");
  }
  return normalized;
}

export async function loadProviderAttemptRows({ supabase, workspaceId, windowEnd, pageSize = PAGE_SIZE }) {
  assertIsoTimestamp(windowEnd, "Window end");
  if (typeof workspaceId !== "string" || !workspaceId) throw new Error("Workspace ID is required.");
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) throw new Error("Page size must be a positive integer.");

  const rows = [];
  let cursor = null;
  while (true) {
    let query = supabase
      .from("adstudio_provider_run_attempts")
      .select(PROVIDER_ATTEMPT_COLUMNS.join(","))
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
    if (error) throw new Error("Unable to read provider-attempt evidence.");
    if (!Array.isArray(data)) throw new Error("Provider-attempt evidence query returned no data.");
    if (data.length === 0) break;
    for (const candidate of data) {
      const row = normalizeProviderAttempt(candidate, { workspaceId, windowEnd });
      if (cursor && compareRunKeys(row, cursor) <= 0) {
        throw new Error("Provider-attempt pages are not strictly ordered by created_at and ID.");
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

export async function loadActiveProfileVersionRows({ supabase, windowEnd, pageSize = PAGE_SIZE }) {
  assertIsoTimestamp(windowEnd, "Window end");
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) throw new Error("Page size must be a positive integer.");
  const rows = [];
  const ids = new Set();
  let cursor = null;
  while (true) {
    let query = supabase
      .from("model_profile_versions")
      .select(PROFILE_VERSION_COLUMNS)
      .lt("active_from", windowEnd)
      .or(`active_to.is.null,active_to.gte.${windowEnd}`)
      .order("active_from", { ascending: false })
      .order("id", { ascending: false })
      .limit(pageSize);
    if (cursor !== null) {
      query = query.or(
        `active_from.lt.${cursor.active_from},and(active_from.eq.${cursor.active_from},id.lt.${cursor.id})`,
      );
    }
    const { data, error } = await query;
    if (error) throw new Error("Unable to load active model profile versions.");
    if (!Array.isArray(data)) throw new Error("Unable to load active model profile versions: query returned no data.");
    if (data.length === 0) break;
    for (const row of data) {
      if (typeof row?.id !== "string" || !row.id) throw new Error("Active model profile version is missing its ID.");
      assertIsoTimestamp(row.active_from, "Active model profile version active_from");
      if (ids.has(row.id)) throw new Error("Active model profile query returned a duplicate version ID.");
      if (
        cursor !== null &&
        !(
          Date.parse(row.active_from) < Date.parse(cursor.active_from) ||
          (Date.parse(row.active_from) === Date.parse(cursor.active_from) && row.id.localeCompare(cursor.id) < 0)
        )
      ) {
        throw new Error("Active model profile keyset pagination did not advance by active_from and ID.");
      }
      ids.add(row.id);
      rows.push(row);
      cursor = { active_from: row.active_from, id: row.id };
    }
  }
  return rows;
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
  const profileKeys = new Set();
  for (const version of persisted) {
    if (profileKeys.has(version.profileKey)) {
      throw new Error(`Ambiguous active model profile versions exist for ${version.profileKey}.`);
    }
    profileKeys.add(version.profileKey);
  }

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

function multiplyDecimal(left, right) {
  return {
    coefficient: left.coefficient * right.coefficient,
    scale: left.scale + right.scale,
  };
}

function divideDecimalByMillion(value) {
  return { coefficient: value.coefficient, scale: value.scale + 6 };
}

function roundDecimal(value, decimalPlaces) {
  if (value.scale <= decimalPlaces) return value;
  const divisor = 10n ** BigInt(value.scale - decimalPlaces);
  let coefficient = value.coefficient / divisor;
  const remainder = value.coefficient < 0n ? -(value.coefficient % divisor) : value.coefficient % divisor;
  if (remainder * 2n >= divisor) coefficient += value.coefficient < 0n ? -1n : 1n;
  return { coefficient, scale: decimalPlaces };
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

function sortedNormalizedAttempts(attempts, workspaceIds, windowEnd, providerRuns) {
  const workspaceSet = new Set(workspaceIds);
  const providerRunKeys = new Set(providerRuns.map((row) => canonicalJson([row.workspace_id, row.id])));
  const ids = new Set();
  const indexes = new Set();
  const normalized = attempts.map((attempt) => {
    if (!workspaceSet.has(attempt.workspace_id)) {
      throw new Error("Provider-attempt evidence references an unenumerated workspace.");
    }
    const row = normalizeProviderAttempt(attempt, { workspaceId: attempt.workspace_id, windowEnd });
    if (!providerRunKeys.has(canonicalJson([row.workspace_id, row.provider_run_id]))) {
      throw new Error("Provider-attempt evidence references an uncaptured provider run.");
    }
    const idKey = canonicalJson([row.workspace_id, row.id]);
    if (ids.has(idKey)) throw new Error("Provider-attempt evidence contains a duplicate attempt ID.");
    ids.add(idKey);
    const indexKey = canonicalJson([row.workspace_id, row.provider_run_id, row.attempt_index]);
    if (indexes.has(indexKey)) throw new Error("Provider-attempt evidence contains a duplicate attempt index.");
    indexes.add(indexKey);
    return row;
  });
  return normalized.sort((left, right) =>
    String(left.workspace_id).localeCompare(String(right.workspace_id)) || compareRunKeys(left, right),
  );
}

function decimalsEqual(left, right) {
  const parsedLeft = decimalFrom(left);
  const parsedRight = decimalFrom(right);
  return Boolean(parsedLeft && parsedRight && formatDecimal(parsedLeft) === formatDecimal(parsedRight));
}

function usageTotals(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const totals = {};
  for (const key of ["inputTokens", "outputTokens", "imageUnits"]) {
    const number = Number(value[key]);
    if (!Number.isFinite(number) || number < 0) return null;
    totals[key] = number;
  }
  return totals;
}

function expectedAttemptEstimatedCost(attempt) {
  if (
    attempt.usage_json?.complete !== true ||
    !pricingEvidenceComplete(attempt.pricing_json, attempt.pricing_snapshot_id)
  ) return null;
  const usage = ["inputTokens", "outputTokens", "imageUnits"].map((key) => decimalFrom(attempt.usage_json[key]));
  const pricing = ["inputUsdPerMillionTokens", "outputUsdPerMillionTokens", "imageUsdPerUnit"]
    .map((key) => decimalFrom(attempt.pricing_json[key]));
  if ([...usage, ...pricing].some((value) => !value || value.coefficient < 0n)) return null;
  const inputCost = divideDecimalByMillion(multiplyDecimal(usage[0], pricing[0]));
  const outputCost = divideDecimalByMillion(multiplyDecimal(usage[1], pricing[1]));
  const imageCost = multiplyDecimal(usage[2], pricing[2]);
  return roundDecimal(addDecimal(addDecimal(inputCost, outputCost), imageCost), COST_DECIMAL_PLACES);
}

function summarizeAttemptAccounting(providerRuns, attempts) {
  const grouped = new Map();
  for (const attempt of attempts) {
    const key = canonicalJson([attempt.workspace_id, attempt.provider_run_id]);
    const values = grouped.get(key) ?? [];
    values.push(attempt);
    grouped.set(key, values);
  }
  let failedBilledCount = 0;
  let runMismatchCount = 0;
  let estimatedCost = { coefficient: 0n, scale: 0 };
  let actualCost = { coefficient: 0n, scale: 0 };
  let failedBilledCost = { coefficient: 0n, scale: 0 };
  for (const attempt of attempts) {
    const parsedEstimated = decimalFrom(attempt.estimated_cost_usd);
    const parsedActual = decimalFrom(attempt.actual_cost_usd);
    if (parsedEstimated) estimatedCost = addDecimal(estimatedCost, parsedEstimated);
    if (attempt.billing_status === "actual" && parsedActual) actualCost = addDecimal(actualCost, parsedActual);
    const cost = attempt.billing_status === "actual" ? attempt.actual_cost_usd : attempt.estimated_cost_usd;
    const parsed = decimalFrom(cost);
    if (attempt.status === "failed" && attempt.request_submitted === true && parsed?.coefficient > 0n) {
      failedBilledCount += 1;
      failedBilledCost = addDecimal(failedBilledCost, parsed);
    }
  }
  for (const run of providerRuns) {
    const runAttempts = grouped.get(canonicalJson([run.workspace_id, run.id])) ?? [];
    if (runAttempts.length === 0) continue;
    let estimated = { coefficient: 0n, scale: 0 };
    let actual = { coefficient: 0n, scale: 0 };
    let actualCount = 0;
    let incompleteActual = false;
    const usage = { inputTokens: 0, outputTokens: 0, imageUnits: 0 };
    let valid = true;
    for (const attempt of runAttempts) {
      const parsedEstimated = decimalFrom(attempt.estimated_cost_usd);
      const attemptUsage = usageTotals(attempt.usage_json);
      if (!parsedEstimated || !attemptUsage) {
        valid = false;
        continue;
      }
      estimated = addDecimal(estimated, parsedEstimated);
      for (const key of Object.keys(usage)) usage[key] += attemptUsage[key];
      if (["estimated", "unreconciled"].includes(attempt.billing_status)) incompleteActual = true;
      if (attempt.billing_status === "actual") {
        const parsedActual = decimalFrom(attempt.actual_cost_usd);
        if (!parsedActual) valid = false;
        else {
          actual = addDecimal(actual, parsedActual);
          actualCount += 1;
        }
      }
    }
    const expectedBilling = runAttempts.some((attempt) => attempt.billing_status === "unreconciled")
      ? "unreconciled"
      : runAttempts.some((attempt) => attempt.billing_status === "estimated")
        ? "estimated"
        : runAttempts.some((attempt) => attempt.billing_status === "actual")
          ? "actual"
          : "unbilled";
    const expectedActual = incompleteActual || actualCount === 0 ? null : formatDecimal(actual);
    const runUsage = usageTotals(run.usage_json);
    const usageMatches = runUsage && Object.keys(usage).every((key) => runUsage[key] === usage[key]);
    if (
      !valid ||
      !decimalsEqual(run.estimated_cost_usd, formatDecimal(estimated)) ||
      (expectedActual === null ? run.actual_cost_usd !== null : !decimalsEqual(run.actual_cost_usd, expectedActual)) ||
      run.billing_status !== expectedBilling ||
      !usageMatches
    ) {
      runMismatchCount += 1;
    }
  }
  return {
    failedBilledCount,
    failedBilledCostUsd: formatDecimal(failedBilledCost),
    estimatedCostUsd: formatDecimal(estimatedCost),
    actualCostUsd: formatDecimal(actualCost),
    runMismatchCount,
  };
}

function pricingEvidenceComplete(value, pricingSnapshotId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const attemptSnapshotValid = pricingSnapshotId === null || (typeof pricingSnapshotId === "string" && pricingSnapshotId.length > 0);
  const evidenceSnapshotValid = value.snapshotId === null || (typeof value.snapshotId === "string" && value.snapshotId.length > 0);
  if (!attemptSnapshotValid || !evidenceSnapshotValid || value.snapshotId !== pricingSnapshotId) return false;
  for (const key of ["inputUsdPerMillionTokens", "outputUsdPerMillionTokens", "imageUsdPerUnit"]) {
    const price = decimalFrom(value[key]);
    if (!price || price.coefficient < 0n) return false;
  }
  return value.currency === "USD" &&
    value.inputTokenBasis === "per_million_tokens" &&
    value.outputTokenBasis === "per_million_tokens" &&
    value.imageBasis === "per_output_image" &&
    ((value.source === "persisted" && value.snapshotId !== null) ||
      (value.source === "default" && value.snapshotId === null));
}

function attemptSemanticsCoherent(attempt) {
  if (!["completed", "failed"].includes(attempt.status) || typeof attempt.request_submitted !== "boolean") return false;
  if (attempt.status === "completed" && attempt.request_submitted !== true) return false;
  const estimated = decimalFrom(attempt.estimated_cost_usd);
  const actual = decimalFrom(attempt.actual_cost_usd);
  const actualMissing = attempt.actual_cost_usd === null || attempt.actual_cost_usd === undefined || attempt.actual_cost_usd === "";
  switch (attempt.billing_status) {
    case "actual":
      return attempt.request_submitted === true && Boolean(actual);
    case "estimated":
      return attempt.request_submitted === true && attempt.usage_json?.complete === true && actualMissing;
    case "unbilled":
      return attempt.request_submitted === false && estimated?.coefficient === 0n && actualMissing;
    case "unreconciled":
      return attempt.request_submitted === true && estimated?.coefficient === 0n && actualMissing;
    default:
      return false;
  }
}

function buildBlockingAnomalies(providerRuns, attempts, attemptAccounting) {
  const validBillingStatuses = new Set(["actual", "estimated", "unbilled", "unreconciled"]);
  let negativeCostCount = 0;
  let unknownCostCount = 0;
  let nonLocalChargedZeroCount = 0;
  let missingUsageCount = 0;
  let incompleteUsageCount = 0;
  let allZeroNonLocalUsageCount = 0;
  let missingPricingCount = 0;
  let pricingMismatchCount = 0;
  let attemptSemanticsMismatchCount = 0;
  const attemptsByRun = new Map();
  for (const attempt of attempts) {
    const key = canonicalJson([attempt.workspace_id, attempt.provider_run_id]);
    attemptsByRun.set(key, (attemptsByRun.get(key) ?? 0) + 1);
  }
  let runsMissingAttemptsCount = 0;

  const inspectCost = (record, { attempt = false } = {}) => {
    const estimated = decimalFrom(record.estimated_cost_usd);
    const actual = record.actual_cost_usd === null ? null : decimalFrom(record.actual_cost_usd);
    const legacy = attempt ? null : decimalFrom(record.cost_estimate);
    if ([estimated, actual, legacy].some((value) => value?.coefficient < 0n)) negativeCostCount += 1;
    const billingKnown = validBillingStatuses.has(record.billing_status);
    if (!estimated || !billingKnown || record.billing_status === "unreconciled" || (record.billing_status === "actual" && !actual)) {
      unknownCostCount += 1;
    }
    const chargedCost = record.billing_status === "actual" ? actual : record.billing_status === "estimated" ? estimated : null;
    const nonLocal = record.provider_name !== "deterministic_local" && record.provider_type !== "local";
    if (nonLocal && chargedCost?.coefficient === 0n) nonLocalChargedZeroCount += 1;
  };

  for (const run of providerRuns) {
    inspectCost(run);
    const nonLocal = run.provider_name !== "deterministic_local" && run.provider_type !== "local";
    const runUsage = usageTotals(run.usage_json);
    if (!runUsage) missingUsageCount += 1;
    else if (nonLocal && Object.values(runUsage).every((value) => value === 0)) allZeroNonLocalUsageCount += 1;
    if (
      nonLocal &&
      ["actual", "estimated"].includes(run.billing_status) &&
      !attemptsByRun.has(canonicalJson([run.workspace_id, run.id]))
    ) {
      runsMissingAttemptsCount += 1;
    }
  }
  for (const attempt of attempts) {
    inspectCost(attempt, { attempt: true });
    const attemptUsage = usageTotals(attempt.usage_json);
    if (!attemptUsage) missingUsageCount += 1;
    else if (
      attempt.provider_name !== "deterministic_local" &&
      attempt.provider_type !== "local" &&
      Object.values(attemptUsage).every((value) => value === 0)
    ) {
      allZeroNonLocalUsageCount += 1;
    }
    if (attempt.usage_json?.complete !== true) incompleteUsageCount += 1;
    if (!pricingEvidenceComplete(attempt.pricing_json, attempt.pricing_snapshot_id)) missingPricingCount += 1;
    if (!attemptSemanticsCoherent(attempt)) attemptSemanticsMismatchCount += 1;
    const expectedEstimatedCost = expectedAttemptEstimatedCost(attempt);
    const recordedEstimatedCost = decimalFrom(attempt.estimated_cost_usd);
    if (
      expectedEstimatedCost &&
      recordedEstimatedCost &&
      formatDecimal(roundDecimal(recordedEstimatedCost, COST_DECIMAL_PLACES)) !== formatDecimal(expectedEstimatedCost)
    ) {
      pricingMismatchCount += 1;
    }
  }
  const blockingCount = negativeCostCount + unknownCostCount + nonLocalChargedZeroCount + missingUsageCount +
    incompleteUsageCount + allZeroNonLocalUsageCount + missingPricingCount + pricingMismatchCount +
    attemptSemanticsMismatchCount + runsMissingAttemptsCount +
    attemptAccounting.runMismatchCount;
  return {
    negativeCostCount,
    unknownCostCount,
    nonLocalChargedZeroCount,
    missingUsageCount,
    incompleteUsageCount,
    allZeroNonLocalUsageCount,
    missingPricingCount,
    pricingMismatchCount,
    attemptSemanticsMismatchCount,
    runsMissingAttemptsCount,
    runAttemptMismatchCount: attemptAccounting.runMismatchCount,
    blockingCount,
  };
}

export function buildProviderBaselineManifest({
  projectRef,
  sourceCommit,
  toolSourceSha256,
  dependencyClosureSha256,
  dependencyClosure,
  capturedAtStart,
  capturedAtEnd,
  windowEnd,
  workspaceIds,
  firstPassRows,
  secondPassRows,
  firstPassAttempts = [],
  secondPassAttempts = [],
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
  assertHexDigest(dependencyClosureSha256, 64, "Dependency closure SHA-256");
  if (
    !Array.isArray(dependencyClosure) ||
    dependencyClosure.length === 0 ||
    dependencyClosure.some((file) =>
      !file || typeof file.path !== "string" || !file.path || !/^[a-f0-9]{64}$/.test(file.sha256)
    )
  ) {
    throw new Error("Dependency closure evidence is invalid.");
  }
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
  const firstAttempts = sortedNormalizedAttempts(firstPassAttempts, sortedWorkspaces, windowEnd, firstRows);
  const secondAttempts = sortedNormalizedAttempts(secondPassAttempts, sortedWorkspaces, windowEnd, secondRows);
  const firstPassSha256 = sha256Canonical({ providerRuns: firstRows, providerAttempts: firstAttempts });
  const secondPassSha256 = sha256Canonical({ providerRuns: secondRows, providerAttempts: secondAttempts });
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
  const attemptQueryDefinition = {
    version: QUERY_VERSION,
    table: "adstudio_provider_run_attempts",
    columns: PROVIDER_ATTEMPT_COLUMNS,
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
    order: ["active_from.desc", "id.desc"],
    pagination: "active-from-id-descending-keyset-until-empty",
  };
  const privateEvidence = {
    workspaces: sortedWorkspaces.map((workspaceId) => {
      const workspaceRows = firstRows.filter((row) => row.workspace_id === workspaceId);
      return {
        workspaceId,
        runIdSetSha256: sha256Canonical(workspaceRows.map((row) => row.id).sort()),
        rows: workspaceRows,
        attempts: firstAttempts.filter((attempt) => attempt.workspace_id === workspaceId),
      };
    }),
  };
  const basePublicSummary = buildPublicSummary(firstRows, sortedWorkspaces);
  const globalAttemptIds = firstAttempts
    .map((attempt) => [attempt.workspace_id, attempt.id])
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  const workspaceSummaries = basePublicSummary.workspaces.map((summary, index) => {
    const workspaceId = sortedWorkspaces[index];
    const attemptIds = firstAttempts
      .filter((attempt) => attempt.workspace_id === workspaceId)
      .map((attempt) => attempt.id)
      .sort();
    return {
      ...summary,
      attemptCount: attemptIds.length,
      attemptIdSetSha256: sha256Canonical(attemptIds),
    };
  });
  const attemptAccounting = summarizeAttemptAccounting(firstRows, firstAttempts);
  const blockingAnomalies = buildBlockingAnomalies(firstRows, firstAttempts, attemptAccounting);
  const publicSummary = {
    ...basePublicSummary,
    workspaces: workspaceSummaries,
    totalAttempts: firstAttempts.length,
    globalAttemptIdSetSha256: sha256Canonical(globalAttemptIds),
    attemptAccounting,
    attemptAccountingPolicy: ATTEMPT_ACCOUNTING_POLICY,
    anomalies: { ...basePublicSummary.anomalies, ...blockingAnomalies },
  };
  const providerRunDriftDetected = firstPassSha256 !== secondPassSha256;
  const modelProfileDriftDetected = firstModelProfilesSha256 !== secondModelProfilesSha256;
  const driftDetected = providerRunDriftDetected || modelProfileDriftDetected;
  const withoutManifestHash = {
    schema: SCHEMA,
    schemaSha256: sha256Canonical({
      schema: SCHEMA,
      providerRunColumns: PROVIDER_RUN_COLUMNS,
      providerAttemptColumns: PROVIDER_ATTEMPT_COLUMNS,
      modelProfileVersionColumns: PROFILE_VERSION_COLUMNS.split(","),
    }),
    preliminaryPreFence: true,
    projectRef,
    source: {
      commit: sourceCommit,
      commitSha256: sha256Text(sourceCommit),
      toolSha256: toolSourceSha256,
      dependencyClosureSha256,
      dependencyClosure,
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
    attemptQuery: {
      ...attemptQueryDefinition,
      columnsSha256: sha256Canonical(PROVIDER_ATTEMPT_COLUMNS),
      sha256: sha256Canonical(attemptQueryDefinition),
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
    acceptanceEligible: !driftDetected && blockingAnomalies.blockingCount === 0,
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
  dependencyClosureSha256,
  dependencyClosure,
  now = () => new Date().toISOString(),
  listWorkspaces = listWorkspaceIds,
  loadRows = loadProviderRunRows,
  loadAttempts = loadProviderAttemptRows,
  loadProfiles = loadActiveProfileVersionRows,
  resolveProfiles,
  writeManifest = writeSecureManifest,
  logger = console.log,
}) {
  const capturedAtStart = assertIsoTimestamp(now(), "Capture start");
  const windowEnd = capturedAtStart;
  const workspaceIds = [...new Set(await listWorkspaces({ supabase }))].sort();
  const collectPass = async () => {
    const rows = [];
    const attempts = [];
    for (const workspaceId of workspaceIds) {
      rows.push(...await loadRows({ supabase, workspaceId, windowEnd }));
      attempts.push(...await loadAttempts({ supabase, workspaceId, windowEnd }));
    }
    return { rows, attempts };
  };
  const firstPass = await collectPass();
  if (typeof resolveProfiles !== "function") throw new Error("A runtime profile evidence resolver is required.");
  const firstProfileRows = await loadProfiles({ supabase, windowEnd });
  const modelProfiles = resolveProfiles(firstProfileRows);
  const secondPass = await collectPass();
  const secondProfileRows = await loadProfiles({ supabase, windowEnd });
  const secondModelProfiles = resolveProfiles(secondProfileRows);
  const capturedAtEnd = assertIsoTimestamp(now(), "Capture end");
  const manifest = buildProviderBaselineManifest({
    projectRef,
    sourceCommit,
    toolSourceSha256,
    dependencyClosureSha256,
    dependencyClosure,
    capturedAtStart,
    capturedAtEnd,
    windowEnd,
    workspaceIds,
    firstPassRows: firstPass.rows,
    secondPassRows: secondPass.rows,
    firstPassAttempts: firstPass.attempts,
    secondPassAttempts: secondPass.attempts,
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

function localImportSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /\bimport\s+(?!type\b)[^"'()]*?\sfrom\s*["']([^"']+)["']/gsu,
    /\bimport\s*["']([^"']+)["']/gu,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu,
    /\bexport\s+[^"']*?\sfrom\s*["']([^"']+)["']/gsu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]?.startsWith(".")) specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

async function collectLocalDependencyPaths({ repoRoot, scriptPath }) {
  const pending = [path.resolve(scriptPath)];
  const visited = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    const relative = repoRelativePath(repoRoot, current);
    if (visited.has(relative)) continue;
    visited.add(relative);
    const source = await readFile(current, "utf8");
    for (const specifier of localImportSpecifiers(source)) {
      const dependency = path.resolve(path.dirname(current), specifier);
      repoRelativePath(repoRoot, dependency);
      pending.push(dependency);
    }
  }
  return [...visited].sort();
}

async function assertTrackedFileMatchesHead(repoRoot, relative) {
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
}

export async function collectVerifiedToolEvidence({ repoRoot, scriptPath }) {
  let dependencyPaths;
  try {
    dependencyPaths = await collectLocalDependencyPaths({ repoRoot, scriptPath });
    for (const relative of dependencyPaths) await assertTrackedFileMatchesHead(repoRoot, relative);
  } catch {
    throw new Error("Provider baseline dependency closure must be tracked and match HEAD before evidence capture.");
  }
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  const dependencyClosure = await Promise.all(dependencyPaths.map(async (relative) => ({
    path: relative,
    sha256: sha256Bytes(await readFile(path.resolve(repoRoot, relative))),
  })));
  const scriptRelative = repoRelativePath(repoRoot, scriptPath);
  const scriptEvidence = dependencyClosure.find((file) => file.path === scriptRelative);
  return {
    sourceCommit: stdout.trim(),
    toolSourceSha256: scriptEvidence.sha256,
    dependencyClosureSha256: sha256Canonical(dependencyClosure),
    dependencyClosure,
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
