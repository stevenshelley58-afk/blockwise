import { NextResponse } from "next/server";

import { requireAdRadarOperator as requireOperator } from "@/lib/operator/auth";
import { createResearchServiceClient } from "@/lib/research/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/operator/research/runs?limit=50&status=failed
 * Returns the most recent ad_fetch_runs for the operator console.
 */
export async function GET(req: Request) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);
  const status = url.searchParams.get("status");
  const since = url.searchParams.get("since");

  let q = createResearchServiceClient()
    .schema("research")
    .from("ad_fetch_runs")
    .select(
      "id, source_provider, role, trigger, target_kind, target_value, started_at, completed_at, status, cost_usd, result_summary, error",
    )
    .order("started_at", { ascending: false })
    .limit(limit);
  if (status) q = q.eq("status", status);
  if (since) q = q.gte("started_at", since);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ runs: data ?? [] });
}
