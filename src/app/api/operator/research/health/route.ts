import { NextResponse } from "next/server";

import { requireOperator } from "@/lib/operator/auth";

export const dynamic = "force-dynamic";

type ResearchHealthRow = {
  checked_at: string | null;
  latest_fetch_started_at: string | null;
  latest_ingest_at: string | null;
  due_backlog_size: number | string | null;
  blocked_job_count: number | string | null;
  open_report_count: number | string | null;
  apify_mtd_spend_usd: number | string | null;
  apify_state: string | null;
  paid_spend_without_ingest: boolean | null;
};

type HealthCheck = {
  ok: boolean;
  value: number | string | boolean | null;
  threshold?: number | string;
  message: string;
};

export async function GET() {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const { data, error } = await guard.supabase
    .schema("research")
    .from("v_health")
    .select("*")
    .maybeSingle<ResearchHealthRow>();

  if (error) {
    return NextResponse.json(
      {
        status: "red",
        error: error.message,
        checks: {
          health_view: {
            ok: false,
            value: "unavailable",
            message: "research.v_health could not be read.",
          },
        },
      },
      { status: 503 },
    );
  }

  const checks = researchHealthChecks(data ?? null);
  const healthy = Object.values(checks).every((check) => check.ok);
  return NextResponse.json(
    {
      status: healthy ? "green" : "red",
      health: data ?? null,
      checks,
    },
    { status: healthy ? 200 : 503 },
  );
}

function researchHealthChecks(row: ResearchHealthRow | null): Record<string, HealthCheck> {
  if (!row) {
    return {
      health_view: {
        ok: false,
        value: null,
        message: "research.v_health returned no row.",
      },
    };
  }

  const latestFetchAgeMinutes = ageMinutes(row.latest_fetch_started_at);
  const latestIngestAgeMinutes = ageMinutes(row.latest_ingest_at);
  const activityAges = [latestFetchAgeMinutes, latestIngestAgeMinutes].filter((age): age is number => age !== null);
  const latestActivityAgeMinutes = activityAges.length ? Math.min(...activityAges) : null;
  const hasRecentWork = latestActivityAgeMinutes !== null && latestActivityAgeMinutes <= 120;
  const dueBacklog = numeric(row.due_backlog_size);
  const blockedJobs = numeric(row.blocked_job_count);
  const paidSpendWithoutIngest = row.paid_spend_without_ingest === true;
  const apifyState = row.apify_state || "unknown";

  return {
    worker_activity: {
      ok: hasRecentWork,
      value: latestActivityAgeMinutes,
      threshold: "120 minutes",
      message: hasRecentWork ? "Recent fetch or ingest activity exists." : "No recent research fetch or ingest activity.",
    },
    due_backlog: {
      ok: dueBacklog <= 500,
      value: dueBacklog,
      threshold: 500,
      message: dueBacklog <= 500 ? "Due research backlog is within threshold." : "Due research backlog is not draining.",
    },
    blocked_jobs: {
      ok: blockedJobs <= 100,
      value: blockedJobs,
      threshold: 100,
      message: blockedJobs <= 100 ? "Blocked job count is within threshold." : "Blocked job count needs operator attention.",
    },
    apify_circuit: {
      ok: apifyState !== "circuit_open",
      value: apifyState,
      message:
        apifyState === "circuit_open"
          ? "Paid capture fallback circuit is open."
          : "Paid capture fallback circuit is not open.",
    },
    paid_spend_without_ingest: {
      ok: !paidSpendWithoutIngest,
      value: paidSpendWithoutIngest,
      message: paidSpendWithoutIngest ? "Active paid capture source spent money without a positive-result run." : "No active paid-spend-without-ingest condition detected.",
    },
  };
}

function numeric(value: number | string | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ageMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round((Date.now() - parsed) / 60_000));
}
