import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOperator } from "@/lib/operator/auth";
import { listHermesSkills } from "@/lib/operator/hermes-assets";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CoverageRow = {
  postcode: string;
  state: string;
  last_audit_score?: number | null;
  last_refreshed_at: string | null;
  live_active_ads: number;
  live_advertiser_pages?: number;
  health: string;
};

type WorkQueueRow = {
  status: string;
  is_stale_claim: boolean | null;
};

const bodySchema = z.object({
  query: z.string().min(1).max(1000),
});

const coverageSelects = [
  "postcode,state,last_audit_score,last_refreshed_at,live_active_ads,live_advertiser_pages,health",
  "postcode,state,last_refreshed_at,live_active_ads,live_advertiser_pages,health",
  "postcode,state,last_audit_score,last_refreshed_at,live_active_ads,health",
  "postcode,state,last_refreshed_at,live_active_ads,health",
] as const;

export async function POST(req: Request) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const research = createSupabaseServiceClient().schema("research");
  const queryCoverage = (columns: (typeof coverageSelects)[number]) =>
    research.from("v_coverage_status").select(columns).order("priority").order("postcode").limit(250);
  const loadCoverage = async () => {
    const [firstSelect, ...fallbackSelects] = coverageSelects;
    let result = await queryCoverage(firstSelect);

    if (!isMissingOptionalCoverageColumn(result.error)) return result;

    for (const columns of fallbackSelects) {
      result = await queryCoverage(columns);
      if (!isMissingOptionalCoverageColumn(result.error)) return result;
    }

    return result;
  };

  const [coverageResult, jobsResult, defectsResult, runsResult, skills] = await Promise.all([
    loadCoverage(),
    research.from("v_operator_work_queue_diagnostics").select("status,is_stale_claim").limit(500),
    research.from("v_missing_competitors").select("id").limit(500),
    research.from("ad_fetch_runs").select("id,status,cost_usd,started_at").order("started_at", { ascending: false }).limit(50),
    listHermesSkills().catch(() => []),
  ]);

  if (coverageResult.error) return NextResponse.json({ error: coverageResult.error.message }, { status: 500 });
  if (jobsResult.error) return NextResponse.json({ error: jobsResult.error.message }, { status: 500 });
  if (defectsResult.error) return NextResponse.json({ error: defectsResult.error.message }, { status: 500 });
  if (runsResult.error) return NextResponse.json({ error: runsResult.error.message }, { status: 500 });

  const coverage = ((coverageResult.data ?? []) as unknown as CoverageRow[]).map(toCoverageSummary).sort((left, right) => left.score - right.score);
  const jobs = (jobsResult.data ?? []) as WorkQueueRow[];
  const activeJobs = jobs.filter((job) => job.status === "pending" || job.status === "claimed").length;
  const staleJobs = jobs.filter((job) => job.is_stale_claim).length;
  const failedJobs = jobs.filter((job) => job.status === "failed" || job.status === "blocked").length;
  const spend24h = (runsResult.data ?? [])
    .filter((run) => new Date(String(run.started_at)).getTime() > Date.now() - 24 * 3600 * 1000)
    .reduce((sum, run) => sum + (Number(run.cost_usd) || 0), 0);
  const rows = coverage.slice(0, 4);
  const proposedPostcode = rows[0]?.postcode ?? null;

  const answer = [
    `${coverage.length} coverage rows loaded from research.v_coverage_status.`,
    `${activeJobs} active jobs, ${failedJobs} failed or blocked jobs, ${staleJobs} stale claims.`,
    `${defectsResult.data?.length ?? 0} coverage defects are visible to the operator view.`,
    `${skills.length} Hermes skill files are available from hermes/skills.`,
    `24h collector spend is $${spend24h.toFixed(2)}.`,
  ].join(" ");

  await research.from("agent_decisions").insert({
    decision_type: "operator_chat",
    subject_type: "operator_query",
    subject_id: `operator-chat:${Date.now()}`,
    decision: {
      query: parsed.data.query,
      answer,
      row_count: rows.length,
      sources: ["research.v_coverage_status", "research.v_operator_work_queue_diagnostics", "research.v_missing_competitors", "research.ad_fetch_runs", "hermes/skills"],
    },
    rationale: "Operator chat response assembled from approved dashboard data sources.",
    confidence: 100,
    hermes_skill: "blockwise-operator-chat",
  });

  return NextResponse.json({
    answer,
    rows,
    proposedAction: proposedPostcode
      ? {
          scope: "postcode",
          value: proposedPostcode,
          label: `Refresh postcode ${proposedPostcode}`,
        }
      : undefined,
  });
}

function toCoverageSummary(row: CoverageRow) {
  return {
    postcode: row.postcode,
    state: row.state,
    score: coverageScore(row),
    activeAds: row.live_active_ads ?? 0,
    advertiserPages: row.live_advertiser_pages ?? 0,
    health: row.health,
  };
}

function coverageScore(row: CoverageRow): number {
  if (typeof row.last_audit_score === "number") {
    return clamp(Math.round(row.last_audit_score), 0, 100);
  }
  if (row.live_active_ads > 0) {
    return clamp(55 + row.live_active_ads * 8, 55, 100);
  }
  if (row.last_refreshed_at) {
    return 35;
  }
  return 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isMissingOptionalCoverageColumn(error: { code?: string; message?: string; details?: string; hint?: string } | null): boolean {
  if (!error) return false;
  const text = [error.code, error.message, error.details, error.hint].filter(Boolean).join(" ").toLowerCase();
  const mentionsOptionalColumn = text.includes("last_audit_score") || text.includes("live_advertiser_pages");
  return mentionsOptionalColumn && (text.includes("does not exist") || text.includes("could not find") || text.includes("schema cache") || text.includes("42703"));
}
