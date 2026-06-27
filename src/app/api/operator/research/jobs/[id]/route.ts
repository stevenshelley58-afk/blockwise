import { NextResponse } from "next/server";

import { requireOperator } from "@/lib/operator/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const research = createSupabaseServiceClient().schema("research");
  const [jobResult, runResult, eventResult] = await Promise.all([
    research
      .from("work_queue")
      .select("*")
      .eq("id", id)
      .maybeSingle(),
    research
      .from("ad_fetch_runs")
      .select("id,source_provider,role,trigger,target_kind,target_value,input_payload,started_at,completed_at,status,result_summary,error,cost_usd,source_document_id")
      .eq("work_queue_id", id)
      .order("started_at", { ascending: false })
      .limit(20),
    research
      .from("ingest_events")
      .select("id,event_type,table_name,row_id,source_provider,payload,created_at")
      .eq("work_queue_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (jobResult.error) return NextResponse.json({ error: jobResult.error.message }, { status: 500 });
  if (!jobResult.data) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  if (runResult.error) return NextResponse.json({ error: runResult.error.message }, { status: 500 });
  if (eventResult.error) return NextResponse.json({ error: eventResult.error.message }, { status: 500 });

  return NextResponse.json({
    job: jobResult.data,
    fetchRuns: runResult.data ?? [],
    ingestEvents: eventResult.data ?? [],
  });
}
