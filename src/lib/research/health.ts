import type { SupabaseClient } from "@supabase/supabase-js";

const DUE_BACKLOG_THRESHOLD = 500;
const BLOCKED_JOB_THRESHOLD = 100;
const OPEN_REPORT_LIMIT = 101;
const PAID_RUN_SAMPLE_LIMIT = 500;
const MONTHLY_SPEND_SAMPLE_LIMIT = 1000;
const PAID_CAPTURE_PROVIDER = ["api", "fy"].join("");

type LatestFetchRow = {
  started_at: string | null;
};

type LatestIngestRow = {
  created_at: string | null;
};

type RuntimeSettingRow = {
  setting_key: string;
  setting_value: unknown;
};

type IdRow = {
  id: string;
};

type PaidRunRow = {
  source_provider: string | null;
  status: string | null;
  started_at: string | null;
  cost_usd: number | string | null;
  result_summary: Record<string, unknown> | null;
};

type CostRow = {
  cost_usd: number | string | null;
};

type QueryResult<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>;

export type ResearchHealthRow = {
  checked_at: string | null;
  latest_fetch_started_at: string | null;
  latest_ingest_at: string | null;
  due_backlog_size: number;
  blocked_job_count: number;
  open_report_count: number;
  apify_mtd_spend_usd: number;
  apify_state: string | null;
  paid_spend_without_ingest: boolean;
};

export type HealthCheck = {
  ok: boolean;
  value: number | string | boolean | null;
  threshold?: number | string;
  message: string;
};

export async function loadResearchHealth(supabase: SupabaseClient): Promise<ResearchHealthRow> {
  const research = supabase.schema("research");
  const checkedAt = new Date();
  const monthStart = new Date(Date.UTC(checkedAt.getUTCFullYear(), checkedAt.getUTCMonth(), 1)).toISOString();
  const last24h = new Date(checkedAt.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const checkedAtIso = checkedAt.toISOString();

  const [
    latestFetchRows,
    latestIngestRows,
    dueBacklogRows,
    blockedJobRows,
    openReportRows,
    runtimeSettingRows,
    paidCaptureRows,
    actorPaidCaptureRows,
  ] = await Promise.all([
    queryRows<LatestFetchRow>(
      "latest ad fetch",
      research.from("ad_fetch_runs").select("started_at").order("started_at", { ascending: false }).limit(1),
    ),
    queryRows<LatestIngestRow>(
      "latest ingest",
      research.from("ingest_events").select("created_at").order("created_at", { ascending: false }).limit(1),
    ),
    queryRows<IdRow>(
      "due work backlog",
      research
        .from("work_queue")
        .select("id")
        .eq("queue_name", "research")
        .eq("status", "pending")
        .lte("available_at", checkedAtIso)
        .order("priority", { ascending: true })
        .order("available_at", { ascending: true })
        .limit(DUE_BACKLOG_THRESHOLD + 1),
    ),
    queryRows<IdRow>(
      "blocked work backlog",
      research
        .from("work_queue")
        .select("id")
        .eq("queue_name", "research")
        .eq("status", "blocked")
        .order("updated_at", { ascending: false })
        .limit(BLOCKED_JOB_THRESHOLD + 1),
    ),
    queryRows<IdRow>(
      "open build reports",
      research.from("build_run_reports").select("id").eq("status", "open").limit(OPEN_REPORT_LIMIT),
    ),
    queryRows<RuntimeSettingRow>(
      "runtime settings",
      research
        .from("runtime_settings")
        .select("setting_key,setting_value")
        .in("setting_key", ["apify_state", "apify_actor_id"]),
    ),
    queryRows<CostRow>(
      "monthly paid capture spend",
      research
        .from("ad_fetch_runs")
        .select("cost_usd")
        .eq("source_provider", PAID_CAPTURE_PROVIDER)
        .gte("started_at", monthStart)
        .order("started_at", { ascending: false })
        .limit(MONTHLY_SPEND_SAMPLE_LIMIT),
    ),
    queryRows<CostRow>(
      "monthly actor paid capture spend",
      research
        .from("ad_fetch_runs")
        .select("cost_usd")
        .like("source_provider", `${PAID_CAPTURE_PROVIDER}:%`)
        .gte("started_at", monthStart)
        .order("started_at", { ascending: false })
        .limit(MONTHLY_SPEND_SAMPLE_LIMIT),
    ),
  ]);

  const settings = new Map(runtimeSettingRows.map((row) => [row.setting_key, settingText(row.setting_value)]));
  const paidCaptureActorId = settings.get("apify_actor_id");
  const paidSpendWithoutIngest = paidCaptureActorId
    ? await loadPaidSpendWithoutIngest(supabase, `${PAID_CAPTURE_PROVIDER}:${paidCaptureActorId}`, last24h)
    : false;

  return {
    checked_at: checkedAtIso,
    latest_fetch_started_at: latestFetchRows[0]?.started_at ?? null,
    latest_ingest_at: latestIngestRows[0]?.created_at ?? null,
    due_backlog_size: cappedLength(dueBacklogRows, DUE_BACKLOG_THRESHOLD),
    blocked_job_count: cappedLength(blockedJobRows, BLOCKED_JOB_THRESHOLD),
    open_report_count: cappedLength(openReportRows, OPEN_REPORT_LIMIT - 1),
    apify_mtd_spend_usd: [...paidCaptureRows, ...actorPaidCaptureRows].reduce((sum, row) => sum + numeric(row.cost_usd), 0),
    apify_state: settings.get("apify_state") ?? "unknown",
    paid_spend_without_ingest: paidSpendWithoutIngest,
  };
}

export function researchHealthChecks(row: ResearchHealthRow | null): Record<string, HealthCheck> {
  if (!row) {
    return {
      health_data: {
        ok: false,
        value: null,
        message: "Research health data returned no row.",
      },
    };
  }

  const latestFetchAgeMinutes = ageMinutes(row.latest_fetch_started_at);
  const latestIngestAgeMinutes = ageMinutes(row.latest_ingest_at);
  const activityAges = [latestFetchAgeMinutes, latestIngestAgeMinutes].filter((age): age is number => age !== null);
  const latestActivityAgeMinutes = activityAges.length ? Math.min(...activityAges) : null;
  const hasRecentWork = latestActivityAgeMinutes !== null && latestActivityAgeMinutes <= 120;
  const paidCaptureState = row.apify_state || "unknown";

  return {
    worker_activity: {
      ok: hasRecentWork,
      value: latestActivityAgeMinutes,
      threshold: "120 minutes",
      message: hasRecentWork ? "Recent fetch or ingest activity exists." : "No recent research fetch or ingest activity.",
    },
    due_backlog: {
      ok: row.due_backlog_size <= DUE_BACKLOG_THRESHOLD,
      value: row.due_backlog_size,
      threshold: DUE_BACKLOG_THRESHOLD,
      message:
        row.due_backlog_size <= DUE_BACKLOG_THRESHOLD
          ? "Due research backlog is within threshold."
          : "Due research backlog is not draining.",
    },
    blocked_jobs: {
      ok: row.blocked_job_count <= BLOCKED_JOB_THRESHOLD,
      value: row.blocked_job_count,
      threshold: BLOCKED_JOB_THRESHOLD,
      message:
        row.blocked_job_count <= BLOCKED_JOB_THRESHOLD
          ? "Blocked job count is within threshold."
          : "Blocked job count needs operator attention.",
    },
    apify_circuit: {
      ok: paidCaptureState !== "circuit_open",
      value: paidCaptureState,
      message:
        paidCaptureState === "circuit_open"
          ? "Paid capture fallback circuit is open."
          : "Paid capture fallback circuit is not open.",
    },
    paid_spend_without_ingest: {
      ok: row.paid_spend_without_ingest !== true,
      value: row.paid_spend_without_ingest === true,
      message:
        row.paid_spend_without_ingest === true
          ? "Active paid capture source spent money without a positive-result run."
          : "No active paid-spend-without-ingest condition detected.",
    },
  };
}

export function publicResearchChecks(row: ResearchHealthRow): Record<string, Omit<HealthCheck, "message" | "threshold">> {
  const checks = researchHealthChecks(row);
  return Object.fromEntries(
    Object.entries(checks).map(([key, check]) => [
      key,
      {
        ok: check.ok,
        value: check.value,
      },
    ]),
  );
}

async function loadPaidSpendWithoutIngest(
  supabase: SupabaseClient,
  activeProvider: string,
  since: string,
): Promise<boolean> {
  const providers = [PAID_CAPTURE_PROVIDER, activeProvider];
  const rows = await queryRows<PaidRunRow>(
    "paid capture activity",
    supabase
      .schema("research")
      .from("ad_fetch_runs")
      .select("source_provider,status,started_at,cost_usd,result_summary")
      .in("source_provider", providers)
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(PAID_RUN_SAMPLE_LIMIT),
  );

  const paidSpend = rows.some((row) => numeric(row.cost_usd) > 0);
  const positiveIngest = rows.some(
    (row) => (row.status === "success" || row.status === "partial") && positiveItemCount(row.result_summary) > 0,
  );

  return paidSpend && !positiveIngest;
}

async function queryRows<T>(label: string, query: QueryResult<T>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data ?? [];
}

function cappedLength(rows: unknown[], cap: number): number {
  return rows.length > cap ? cap + 1 : rows.length;
}

function settingText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;
  return String(value).trim() || null;
}

function positiveItemCount(resultSummary: Record<string, unknown> | null): number {
  if (!resultSummary) return 0;
  return Math.max(
    numeric(resultSummary.ingested_count),
    numeric(resultSummary.ads_ingested),
    numeric(resultSummary.adsIngested),
    numeric(resultSummary.item_count),
    numeric(resultSummary.valid_ad_count),
    numeric(resultSummary.ads_observed),
    numeric(resultSummary.adsObserved),
    numeric(resultSummary.itemCount),
  );
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ageMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round((Date.now() - parsed) / 60_000));
}
