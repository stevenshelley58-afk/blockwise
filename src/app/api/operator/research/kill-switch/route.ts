import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOperator } from "@/lib/operator/auth";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  paused: z.boolean(),
  reason: z.string().nullable().optional(),
});

/**
 * POST /api/operator/research/kill-switch
 * Sets all refresh_policies.active = paused?false:true. The orchestrator
 * skips inactive policies, so this halts scheduled scraping immediately.
 * Manual one-off runs via refresh-now still work — kill-switch only
 * stops the scheduler.
 */
export async function POST(req: Request) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { paused, reason } = parsed.data;

  const research = guard.supabase.schema("research");
  const { error } = await research
    .from("refresh_policies")
    .update({ active: !paused })
    .neq("postcode", "__never__");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await research.from("agent_decisions").insert({
    decision_type: "cadence_change",
    subject_type: "operator_query",
    subject_id: "kill-switch",
    decision: { paused, operator: guard.email, operatorProfileId: guard.profileId },
    rationale: reason ?? (paused ? "Operator paused all scheduled scraping" : "Operator resumed all scheduled scraping"),
    confidence: 100,
    hermes_skill: "operator-console",
  });

  return NextResponse.json({ ok: true, paused });
}
