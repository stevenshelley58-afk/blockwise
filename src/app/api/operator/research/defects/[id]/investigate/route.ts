import { NextResponse } from "next/server";

import { requireAdRadarOperator as requireOperator } from "@/lib/operator/auth";
import { createResearchServiceClient } from "@/lib/research/service";

export const dynamic = "force-dynamic";

async function queueDefectInvestigation(
  research: ReturnType<ReturnType<typeof createResearchServiceClient>["schema"]>,
  defectId: string,
  operatorDecisionId: string | null,
) {
  const dedupeKey = `defect-investigate:${defectId}`;
  const payload = { coverageDefectId: defectId, operatorDecisionId };
  const { data: existing, error: loadError } = await research
    .from("work_queue")
    .select("id,status,claim_expires_at")
    .eq("queue_name", "research")
    .eq("dedupe_key", dedupeKey)
    .in("status", ["pending", "claimed", "failed", "blocked"])
    .limit(1)
    .maybeSingle();
  if (loadError) return { error: loadError, alreadyQueued: false };

  if (existing) {
    const staleClaim =
      existing.status === "claimed" &&
      existing.claim_expires_at !== null &&
      new Date(String(existing.claim_expires_at)).getTime() < Date.now();
    if (existing.status === "pending" || (existing.status === "claimed" && !staleClaim)) {
      return { error: null, alreadyQueued: true };
    }

    const { error: updateError } = await research
      .from("work_queue")
      .update({
        queue_name: "research",
        job_type: "blockwise-defect-investigator",
        priority: 15,
        payload,
        status: "pending",
        available_at: new Date().toISOString(),
        claimed_at: null,
        claimed_by: null,
        claim_token: null,
        claim_expires_at: null,
        attempts: 0,
        max_attempts: 3,
        last_error: null,
        blocked_reason: null,
        result: {},
        completed_at: null,
      })
      .eq("id", existing.id);
    return { error: updateError, alreadyQueued: false };
  }

  const { error } = await research.from("work_queue").insert({
    queue_name: "research",
    job_type: "blockwise-defect-investigator",
    dedupe_key: dedupeKey,
    priority: 15,
    payload,
    status: "pending",
    max_attempts: 3,
  });
  if (error && !/duplicate key|work_queue_active_dedupe_idx/iu.test(error.message)) {
    return { error, alreadyQueued: false };
  }
  return { error: null, alreadyQueued: Boolean(error) };
}

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
  const research = createResearchServiceClient().schema("research");

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

  const { error: queueError, alreadyQueued } = await queueDefectInvestigation(research, id, operatorDecisionId);
  if (queueError) {
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
  return NextResponse.json({ ok: true, defect: id, alreadyQueued });
}
