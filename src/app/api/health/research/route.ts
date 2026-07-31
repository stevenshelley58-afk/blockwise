import { NextResponse } from "next/server";

import { niche } from "@/config/niche";
import { createResearchServiceClient } from "@/lib/research/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ResearchHealthRow = {
  latest_fetch_started_at: string | null;
  latest_ingest_at: string | null;
  due_backlog_size: number | string | null;
  blocked_job_count: number | string | null;
  apify_state: string | null;
  paid_spend_without_ingest: boolean | null;
};

type PublicCheck = {
  ok: boolean;
  value: number | string | boolean | null;
};

export async function GET(request: Request) {
  if (!niche.features.adRadar) {
    return NextResponse.json({ app: "blockwise", service: "research", status: "disabled" }, { status: 200 });
  }

  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  const authenticated = secret && authorization === `Bearer ${secret}`;

  const { data, error } = await createResearchServiceClient()
    .schema("research")
    .from("v_health")
    .select("latest_fetch_started_at,latest_ingest_at,due_backlog_size,blocked_job_count,apify_state,paid_spend_without_ingest")
    .maybeSingle<ResearchHealthRow>();

  if (error || !data) {
    if (!authenticated) {
      return NextResponse.json({ app: "blockwise", service: "research", status: "red" }, { status: 503 });
    }
    return NextResponse.json(
      {
        app: "blockwise",
        service: "research",
        status: "red",
        checks: {
          health_view: { ok: false, value: error ? "unavailable" : "empty" },
        },
      },
      { status: 503 },
    );
  }

  const checks = publicResearchChecks(data);
  const healthy = Object.values(checks).every((check) => check.ok);

  if (!authenticated) {
    return NextResponse.json({ app: "blockwise", service: "research", status: healthy ? "green" : "red" }, { status: healthy ? 200 : 503 });
  }

  return NextResponse.json(
    {
      app: "blockwise",
      service: "research",
      status: healthy ? "green" : "red",
      checks,
    },
    { status: healthy ? 200 : 503 },
  );
}

function publicResearchChecks(row: ResearchHealthRow): Record<string, PublicCheck> {
  const latestFetchAgeMinutes = ageMinutes(row.latest_fetch_started_at);
  const latestIngestAgeMinutes = ageMinutes(row.latest_ingest_at);
  const activityAges = [latestFetchAgeMinutes, latestIngestAgeMinutes].filter((age): age is number => age !== null);
  const latestActivityAgeMinutes = activityAges.length ? Math.min(...activityAges) : null;
  const dueBacklog = numeric(row.due_backlog_size);
  const blockedJobs = numeric(row.blocked_job_count);
  const apifyState = row.apify_state || "unknown";

  return {
    worker_activity: {
      ok: latestActivityAgeMinutes !== null && latestActivityAgeMinutes <= 120,
      value: latestActivityAgeMinutes,
    },
    due_backlog: {
      ok: dueBacklog <= 500,
      value: dueBacklog,
    },
    blocked_jobs: {
      ok: blockedJobs <= 100,
      value: blockedJobs,
    },
    apify_circuit: {
      ok: apifyState !== "circuit_open",
      value: apifyState,
    },
    paid_spend_without_ingest: {
      ok: row.paid_spend_without_ingest !== true,
      value: row.paid_spend_without_ingest === true,
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
