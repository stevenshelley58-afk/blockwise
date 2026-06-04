import { NextResponse } from "next/server";

import { requireOperator } from "@/lib/operator/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/operator/research/defects/[id]/investigate
 * Marks a coverage defect as investigating and queues a
 * blockwise-defect-investigator job for the Hermes runtime. The dedupe key
 * keeps a single active investigation per defect; hitting an existing one is
 * treated as success. Audited as a defect_investigation decision.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const research = createSupabaseServiceClient().schema("research");

  const { data: defect, error: loadError } = await research
    .from("coverage_defects")
    .select("id,status,notes,postcode,state")
    .eq("id", id)
    .maybeSingle();
  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 });
  if (!defect) return NextResponse.json({ error: "defect not found" }, { status: 404 });
  if (defect.status === "resolved" || defect.status === "dismissed") {
    return NextResponse.json({ error: `defect is already ${defect.status}` }, { status: 409 });
  }

  const { data: decisionRows, error: decisionError } = await research
    .from("agent_decisions")
    .insert({
      decision_type: "defect_investigation",
      subject_type: "coverage_defect",
      subject_id: id,
      decision: {
        action: "queue_investigation",
        operator: guard.email,
        postcode: defect.postcode,
        state: defect.state,
      },
      rationale: "Operator queued a defect investigation from the research console",
      confidence: 100,
      hermes_skill: "operator-console",
    })
    .select("id");
  if (decisionError) return NextResponse.json({ error: decisionError.message }, { status: 500 });
  const operatorDecisionId = decisionRows?.[0]?.id ?? null;

  const { error: queueError } = await research.from("work_queue").insert({
    queue_name: "research",
    job_type: "blockwise-defect-investigator",
    dedupe_key: `defect-investigate:${id}`,
    priority: 15,
    payload: { coverageDefectId: id, operatorDecisionId },
    status: "pending",
    max_attempts: 3,
  });
  if (queueError && !/duplicate key|work_queue_active_dedupe_idx/iu.test(queueError.message)) {
    return NextResponse.json({ error: queueError.message }, { status: 500 });
  }

  const { error: updateError } = await research
    .from("coverage_defects")
    .update({ status: "investigating", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.redirect(new URL("/operator/research", req.url), 303);
  }
  return NextResponse.json({ ok: true, defect: id, alreadyQueued: Boolean(queueError) });
}
