import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOperator } from "@/lib/operator/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  scope: z.enum(["postcode", "advertiser_page"]),
  value: z.string().min(1),
});

async function parseBody(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return { body: await req.json(), redirectAfter: false };
  }

  const formData = await req.formData();
  return {
    body: Object.fromEntries(formData.entries()),
    redirectAfter: true,
  };
}

/**
 * POST /api/operator/research/refresh-now
 * Signals the orchestrator to refresh a specific postcode or page on next
 * tick by setting its next_refresh_at to now() (postcode) or its
 * last_checked_at to null (page). Returns immediately; the actual run
 * happens on the VPS-side orchestrator within ORCHESTRATOR_LOOP_INTERVAL_MS.
 */
export async function POST(req: Request) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const { body, redirectAfter } = await parseBody(req);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { scope, value } = parsed.data;

  const research = createSupabaseServiceClient().schema("research");

  if (scope === "postcode") {
    const { error } = await research
      .from("refresh_policies")
      .update({ next_refresh_at: new Date().toISOString() })
      .eq("postcode", value);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await research
      .from("advertiser_pages")
      .update({ last_checked_at: null })
      .eq("id", value);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Audit the operator action.
  await research.from("agent_decisions").insert({
    decision_type: "cadence_change",
    subject_type: scope === "postcode" ? "postcode" : "advertiser_page",
    subject_id: value,
    decision: { action: "refresh_now", operator: guard.email },
    rationale: "Operator triggered immediate refresh",
    confidence: 100,
    hermes_skill: "operator-console",
  });

  if (redirectAfter) {
    return NextResponse.redirect(new URL("/operator/research", req.url), 303);
  }

  return NextResponse.json({ ok: true });
}
