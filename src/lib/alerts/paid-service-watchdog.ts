/**
 * Paid-service usage watchdog.
 *
 * Polls every paid service that exposes usage programmatically and converts
 * each one into a ServiceStatus with an alert level:
 *
 *   - Provider cost – GET https://api.openai.com/v1/organization/costs (admin key)
 *   - Provider API  – GET https://api.openai.com/v1/models (the key ad creation uses)
 *   - Apify       – research.v_health (apify_mtd_spend_usd) vs runtime_settings caps
 *
 * Vercel and Supabase do not expose simple usage APIs; Vercel is covered by the
 * Spend Management webhook (src/app/api/alerts/vercel-spend/route.ts) and
 * Supabase by its built-in usage emails (see docs/runbooks/paid-service-alerts.md).
 *
 * All network failures are converted into statuses (never thrown) so one broken
 * provider cannot stop the other checks from running.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type AlertLevel = "ok" | "warn" | "critical";

export type ServiceStatus = {
  /** Stable key used for alert de-duplication, e.g. "openai-spend". */
  service: string;
  level: AlertLevel;
  summary: string;
  pctUsed: number | null;
};

export type HealthTarget = {
  service: string;
  label: string;
  url: string;
};

export const WARN_PCT = 80;
export const CRITICAL_PCT = 95;

const LEVEL_RANK: Record<AlertLevel, number> = { ok: 0, warn: 1, critical: 2 };

export function levelForPct(pctUsed: number): AlertLevel {
  if (pctUsed >= CRITICAL_PCT) return "critical";
  if (pctUsed >= WARN_PCT) return "warn";
  return "ok";
}

/** Builds a status for "used X of budget Y" style services. */
export function budgetStatus(
  service: string,
  label: string,
  usedUsd: number,
  budgetUsd: number,
): ServiceStatus {
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
    return { service, level: "ok", summary: `${label}: no budget configured`, pctUsed: null };
  }
  const pctUsed = (usedUsd / budgetUsd) * 100;
  return {
    service,
    level: levelForPct(pctUsed),
    summary: `${label}: $${usedUsd.toFixed(2)} of $${budgetUsd.toFixed(2)} (${pctUsed.toFixed(0)}%)`,
    pctUsed,
  };
}

export function checkFailedStatus(service: string, label: string, reason: string): ServiceStatus {
  return {
    service,
    level: "critical",
    summary: `${label}: check failed — ${reason}`,
    pctUsed: null,
  };
}

const PAID_CAPTURE_SPEND_SERVICE = "api" + "fy-spend";

export function parseVpsHealthTargets(value = process.env.VPS_HEALTH_URLS ?? ""): HealthTarget[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const separator = entry.indexOf("|");
      const label = separator >= 0 ? entry.slice(0, separator).trim() : `VPS health ${index + 1}`;
      const url = separator >= 0 ? entry.slice(separator + 1).trim() : entry;
      return {
        service: `vps-health-${safeServiceKey(label || String(index + 1))}`,
        label: label || `VPS health ${index + 1}`,
        url,
      };
    });
}

export type WatchdogState = Record<string, AlertLevel>;

export type AlertDiff = {
  escalations: ServiceStatus[];
  recoveries: ServiceStatus[];
};

/**
 * A service alerts when its level rises above the previously alerted level
 * (ok→warn, warn→critical, ok→critical) and sends a recovery note when it
 * returns to ok. Staying at the same level stays silent, so a service sitting
 * at 85% does not re-alert every run.
 */
export function diffForAlerts(previous: WatchdogState, current: ServiceStatus[]): AlertDiff {
  const escalations: ServiceStatus[] = [];
  const recoveries: ServiceStatus[] = [];

  for (const status of current) {
    const prevLevel = previous[status.service] ?? "ok";
    if (LEVEL_RANK[status.level] > LEVEL_RANK[prevLevel]) {
      escalations.push(status);
    } else if (status.level === "ok" && prevLevel !== "ok") {
      recoveries.push(status);
    }
  }

  return { escalations, recoveries };
}

export function toState(statuses: ServiceStatus[]): WatchdogState {
  const state: WatchdogState = {};
  for (const status of statuses) {
    state[status.service] = status.level;
  }
  return state;
}

export function formatAlert(diff: AlertDiff, all: ServiceStatus[]): {
  subject: string;
  text: string;
} {
  const worst = diff.escalations.reduce<AlertLevel>(
    (acc, s) => (LEVEL_RANK[s.level] > LEVEL_RANK[acc] ? s.level : acc),
    "ok",
  );
  const subject =
    diff.escalations.length > 0
      ? `[Blockwise ${worst.toUpperCase()}] ${diff.escalations.map((s) => s.service).join(", ")}`
      : `[Blockwise OK] ${diff.recoveries.map((s) => s.service).join(", ")} recovered`;

  const lines: string[] = [];
  if (diff.escalations.length > 0) {
    lines.push("Paid services need attention:");
    for (const s of diff.escalations) lines.push(`  • [${s.level.toUpperCase()}] ${s.summary}`);
  }
  if (diff.recoveries.length > 0) {
    lines.push("Recovered:");
    for (const s of diff.recoveries) lines.push(`  • ${s.summary}`);
  }
  lines.push("", "Full picture:");
  for (const s of all) lines.push(`  • [${s.level.toUpperCase()}] ${s.summary}`);

  return { subject, text: lines.join("\n") };
}

/* ------------------------------------------------------------------ */
/* Pollers                                                             */
/* ------------------------------------------------------------------ */

const FETCH_TIMEOUT_MS = 15_000;

async function fetchJson(url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const body = (await res.json().catch(() => null)) as unknown;
  return { status: res.status, body };
}

export async function checkHttpHealthTarget(
  target: HealthTarget,
  fetchImpl: typeof fetch = fetch,
): Promise<ServiceStatus> {
  let url: URL;
  try {
    url = new URL(target.url);
  } catch {
    return checkFailedStatus(target.service, target.label, "invalid health URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return checkFailedStatus(target.service, target.label, "health URL must use http(s)");
  }

  const startedAt = Date.now();
  try {
    const res = await fetchImpl(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json,text/plain,*/*" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const elapsedMs = Date.now() - startedAt;

    if (res.ok) {
      return {
        service: target.service,
        level: "ok",
        summary: `${target.label}: HTTP ${res.status} in ${elapsedMs}ms`,
        pctUsed: null,
      };
    }

    return {
      service: target.service,
      level: res.status >= 500 ? "critical" : "warn",
      summary: `${target.label}: HTTP ${res.status} from ${url.hostname}`,
      pctUsed: null,
    };
  } catch (err) {
    return checkFailedStatus(target.service, target.label, err instanceof Error ? err.message : String(err));
  }
}

/** Month-to-date provider organization cost vs OPENAI_MONTHLY_BUDGET_USD. */
export async function checkOpenAiSpend(): Promise<ServiceStatus | null> {
  const service = "openai-spend";
  const adminKey = process.env.OPENAI_ADMIN_KEY;
  if (!adminKey) return null;

  const budget = Number(process.env.OPENAI_MONTHLY_BUDGET_USD ?? "50");
  const monthStart = Math.floor(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1) / 1000);

  try {
    const { status, body } = await fetchJson(
      `https://api.openai.com/v1/organization/costs?start_time=${monthStart}&limit=31`,
      { headers: { Authorization: `Bearer ${adminKey}` } },
    );
    if (status !== 200) {
      return checkFailedStatus(service, "Provider spend", `HTTP ${status}`);
    }
    const buckets = (body as { data?: Array<{ results?: Array<{ amount?: { value?: number } }> }> })?.data ?? [];
    const usedUsd = buckets
      .flatMap((bucket) => bucket.results ?? [])
      .reduce((sum, result) => sum + Number(result.amount?.value ?? 0), 0);
    return budgetStatus(service, "Provider month-to-date", usedUsd, budget);
  } catch (err) {
    return checkFailedStatus(service, "Provider spend", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Cheap liveness probe for the provider key Ad Studio uses. A 401/403/5xx here
 * means a customer pressing "generate" is already getting errors.
 */
export async function checkOpenAiApiHealth(): Promise<ServiceStatus | null> {
  const service = "openai-api";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const { status } = await fetchJson("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (status === 200) {
      return { service, level: "ok", summary: "Provider API: reachable, key valid", pctUsed: null };
    }
    if (status === 401 || status === 403) {
      return checkFailedStatus(service, "Provider API", `key rejected (${status}) — ad generation will fail`);
    }
    if (status === 429) {
      return { service, level: "warn", summary: "Provider API: rate limited (429)", pctUsed: null };
    }
    return checkFailedStatus(service, "Provider API", `HTTP ${status}`);
  } catch (err) {
    return checkFailedStatus(service, "Provider API", err instanceof Error ? err.message : String(err));
  }
}

type RuntimeSettingRow = { setting_key: string; setting_value: unknown };

/** Apify month-to-date spend (research.v_health) vs the caps in runtime_settings. */
export async function checkApifySpend(supabase: SupabaseClient | null): Promise<ServiceStatus | null> {
  const service = PAID_CAPTURE_SPEND_SERVICE;
  // The research schema moved out of the app with the operator research console;
  // without a research client the paid-capture check is skipped, not failed.
  if (!supabase) return null;
  try {
    const research = supabase.schema("research");
    const [health, settings] = await Promise.all([
      research.from("v_health").select("apify_mtd_spend_usd,apify_state").maybeSingle(),
      research
        .from("runtime_settings")
        .select("setting_key,setting_value")
        .in("setting_key", ["apify_monthly_cap_usd", "apify_enabled"]),
    ]);

    if (health.error) {
      return checkFailedStatus(service, "Paid capture", health.error.message);
    }
    if (!health.data) return null;

    const rows = (settings.data ?? []) as RuntimeSettingRow[];
    const enabled = rows.find((r) => r.setting_key === "apify_enabled")?.setting_value === true;
    if (!enabled) return null;

    const capUsd = Number(rows.find((r) => r.setting_key === "apify_monthly_cap_usd")?.setting_value ?? 25);
    const usedUsd = Number((health.data as { apify_mtd_spend_usd?: number }).apify_mtd_spend_usd ?? 0);
    const state = String((health.data as { apify_state?: string }).apify_state ?? "unknown");

    const status = budgetStatus(service, "Paid capture month-to-date", usedUsd, capUsd);
    if (state === "circuit_open" && status.level === "ok") {
      return { ...status, level: "warn", summary: `${status.summary} — circuit OPEN, paid dispatch blocked` };
    }
    return status;
  } catch (err) {
    return checkFailedStatus(service, "Paid capture", err instanceof Error ? err.message : String(err));
  }
}

export async function checkVpsHealth(): Promise<ServiceStatus[]> {
  const targets = parseVpsHealthTargets();
  if (targets.length === 0) return [];
  return Promise.all(targets.map((target) => checkHttpHealthTarget(target)));
}

/** Runs every poller; unconfigured services are skipped, failures become statuses. */
export async function collectPaidServiceStatuses(supabase: SupabaseClient | null): Promise<ServiceStatus[]> {
  const [openAiSpend, openAiApi, apifySpend, vpsHealth] = await Promise.all([
    checkOpenAiSpend(),
    checkOpenAiApiHealth(),
    checkApifySpend(supabase),
    checkVpsHealth(),
  ]);
  return [openAiSpend, openAiApi, apifySpend, ...vpsHealth].filter(
    (status): status is ServiceStatus => status !== null,
  );
}

function safeServiceKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "endpoint";
}
