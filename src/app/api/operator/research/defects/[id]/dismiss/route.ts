import { NextResponse } from "next/server";

import { requireAdRadarOperator as requireOperator } from "@/lib/operator/auth";
import { createResearchServiceClient } from "@/lib/research/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/operator/research/defects/[id]/dismiss
 * Dismisses a coverage defect with an audit decision row linked as the
 * resolution decision. Does not delete anything; the defect stays queryable.
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
    .select("id,status,resolution")
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
      decision: { action: "dismiss", operator: guard.email, previous_status: defect.status },
      rationale: "Operator dismissed the defect from the research console",
      confidence: 100,
      hermes_skill: "operator-console",
    })
    .select("id");
  if (decisionError) return NextResponse.json({ error: decisionError.message }, { status: 500 });
  const resolutionDecisionId = decisionRows?.[0]?.id ?? null;

  const previousResolution =
    defect.resolution && typeof defect.resolution === "object" ? (defect.resolution as Record<string, unknown>) : {};
  const { error: updateError } = await research
    .from("coverage_defects")
    .update({
      status: "dismissed",
      resolution: { ...previousResolution, dismissed_by: guard.email, dismissed_via: "operator-console" },
      resolution_decision_id: resolutionDecisionId,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.redirect(new URL("/operator/research", req.url), 303);
  }
  return NextResponse.json({ ok: true, dismissed: id });
}
