import { NextResponse } from "next/server";

import { requireAdRadarOperator as requireOperator } from "@/lib/operator/auth";
import { createResearchServiceClient } from "@/lib/research/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/operator/research/jobs/[id]/requeue
 * Returns a failed, blocked, or stale-claimed job to pending so the Hermes
 * supervisor picks it up on its next tick. Mirrors the supervisor's own
 * recycle semantics: attempts reset, claim cleared, errors wiped.
 * Every requeue is audited as a queue_operation decision.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const research = createResearchServiceClient().schema("research");

  const { data: job, error: loadError } = await research
    .from("work_queue")
    .select("id,job_type,status,claim_expires_at,blocked_reason,last_error")
    .eq("id", id)
    .maybeSingle();
  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 });
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });

  const staleClaim =
    job.status === "claimed" &&
    job.claim_expires_at !== null &&
    new Date(String(job.claim_expires_at)).getTime() < Date.now();
  const eligible = job.status === "failed" || job.status === "blocked" || staleClaim;
  if (!eligible) {
    return NextResponse.json(
      { error: `job is ${job.status} and not eligible for requeue` },
      { status: 409 },
    );
  }

  const { error: updateError } = await research
    .from("work_queue")
    .update({
      status: "pending",
      available_at: new Date().toISOString(),
      claimed_at: null,
      claimed_by: null,
      claim_token: null,
      claim_expires_at: null,
      attempts: 0,
      last_error: null,
      blocked_reason: null,
      completed_at: null,
    })
    .eq("id", id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  await research.from("agent_decisions").insert({
    decision_type: "queue_operation",
    subject_type: "work_queue",
    subject_id: id,
    decision: {
      action: "requeue",
      operator: guard.email,
      job_type: job.job_type,
      previous_status: job.status,
      previous_blocked_reason: job.blocked_reason,
      previous_last_error: job.last_error,
      was_stale_claim: staleClaim,
    },
    rationale: "Operator requeued the job from the research console",
    confidence: 100,
    hermes_skill: "operator-console",
  });

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.redirect(new URL("/operator/research", req.url), 303);
  }
  return NextResponse.json({ ok: true, requeued: id });
}
