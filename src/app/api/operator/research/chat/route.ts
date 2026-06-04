import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOperator } from "@/lib/operator/auth";
import { listHermesSkills } from "@/lib/operator/hermes-assets";
import {
  buildResearchChatAnswer,
  summarizeCoverageRows,
  type ResearchChatCoverageRow,
} from "@/lib/operator/research-chat";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  query: z.string().min(1).max(1000),
});

export async function POST(req: Request) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const research = createSupabaseServiceClient().schema("research");
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [
    coverageResult,
    pendingJobs,
    claimedJobs,
    failedJobs,
    blockedJobs,
    staleJobs,
    defectsResult,
    runsResult,
    skills,
  ] = await Promise.all([
    research.from("v_coverage_status").select("*", { count: "exact" }).order("priority").order("postcode").limit(1000),
    research.from("v_operator_work_queue_diagnostics").select("id", { count: "exact", head: true }).eq("status", "pending"),
    research.from("v_operator_work_queue_diagnostics").select("id", { count: "exact", head: true }).eq("status", "claimed"),
    research.from("v_operator_work_queue_diagnostics").select("id", { count: "exact", head: true }).eq("status", "failed"),
    research.from("v_operator_work_queue_diagnostics").select("id", { count: "exact", head: true }).eq("status", "blocked"),
    research.from("v_operator_work_queue_diagnostics").select("id", { count: "exact", head: true }).eq("is_stale_claim", true),
    research.from("v_missing_competitors").select("id", { count: "exact", head: true }),
    research.from("ad_fetch_runs").select("cost_usd").gte("started_at", since).limit(1000),
    listHermesSkills().catch(() => []),
  ]);

  if (coverageResult.error) return NextResponse.json({ error: coverageResult.error.message }, { status: 500 });
  if (pendingJobs.error) return NextResponse.json({ error: pendingJobs.error.message }, { status: 500 });
  if (claimedJobs.error) return NextResponse.json({ error: claimedJobs.error.message }, { status: 500 });
  if (failedJobs.error) return NextResponse.json({ error: failedJobs.error.message }, { status: 500 });
  if (blockedJobs.error) return NextResponse.json({ error: blockedJobs.error.message }, { status: 500 });
  if (staleJobs.error) return NextResponse.json({ error: staleJobs.error.message }, { status: 500 });
  if (defectsResult.error) return NextResponse.json({ error: defectsResult.error.message }, { status: 500 });
  if (runsResult.error) return NextResponse.json({ error: runsResult.error.message }, { status: 500 });

  const rows = summarizeCoverageRows((coverageResult.data ?? []) as ResearchChatCoverageRow[]);
  const activeJobs = (pendingJobs.count ?? 0) + (claimedJobs.count ?? 0);
  const failedOrBlockedJobs = (failedJobs.count ?? 0) + (blockedJobs.count ?? 0);
  const spend24h = (runsResult.data ?? []).reduce((sum, run) => sum + (Number(run.cost_usd) || 0), 0);
  const proposedPostcode = rows[0]?.postcode ?? null;

  const answer = buildResearchChatAnswer({
    coverageRows: coverageResult.count ?? rows.length,
    activeJobs,
    failedJobs: failedOrBlockedJobs,
    staleJobs: staleJobs.count ?? 0,
    defects: defectsResult.count ?? 0,
    skillFiles: skills.length,
    spend24h,
  });

  await research.from("agent_decisions").insert({
    decision_type: "operator_chat",
    subject_type: "operator_query",
    subject_id: `operator-chat:${Date.now()}`,
    decision: {
      query: parsed.data.query,
      answer,
      row_count: rows.length,
      sources: [
        "research.v_coverage_status",
        "research.v_operator_work_queue_diagnostics",
        "research.v_missing_competitors",
        "research.ad_fetch_runs",
        "hermes/skills",
      ],
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
