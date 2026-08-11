import { NextResponse, type NextRequest } from "next/server";

import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { loadMetaPublishPlan, loadMetaPublishPlanComplianceStatus, validateMetaPublishPlanReadiness } from "@/lib/providers/meta-execution";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };
type ReadinessBlocker = { code: string; message: string };

/** The customer UI and publish POST share this plan-level, read-only gate. */
export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, {
    surface: "adstudio",
    requestedWorkspaceId: request.nextUrl.searchParams.get("workspaceId"),
  });
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const service = createSupabaseServiceClient();
  try {
    const plan = await loadMetaPublishPlan(service, { workspaceId: access.access.workspaceId, planId: id });
    const [{ data: connection }, { data: approval }, complianceStatus] = await Promise.all([
      service.from("provider_connections").select("status").eq("workspace_id", plan.workspaceId).eq("id", plan.providerConnectionId).maybeSingle(),
      plan.approvalRequestId
        ? service.from("approval_requests").select("status").eq("workspace_id", plan.workspaceId).eq("id", plan.approvalRequestId).maybeSingle()
        : Promise.resolve({ data: null }),
      loadMetaPublishPlanComplianceStatus(service, plan),
    ]);
    const readiness = validateMetaPublishPlanReadiness(plan, {
      providerConnectionStatus: connection?.status === "connected" || connection?.status === "needs_attention" ? connection.status : "not_connected",
      approvalStatus: approval?.status === "approved" || approval?.status === "requested" || approval?.status === "rejected" || approval?.status === "cancelled" ? approval.status : "draft",
      complianceStatus,
      requireRuntimeBinding: true,
    });
    const blockers: ReadinessBlocker[] = [
      ...(complianceStatus === "blocked" && !readiness.blockers.some((blocker) => /compliance/i.test(blocker))
        ? [{ code: "compliance_stale_or_missing", message: "The compliance check for this exact ad is missing, stale, or blocking." }]
        : []),
      ...readiness.blockers.map((message) => ({ code: blockerCode(message), message })),
    ];
    return NextResponse.json({ ready: blockers.length === 0, blockers, budget: {
      dailyMinorUnits: plan.controls.dailyBudgetMinorUnits ?? 0,
      currency: plan.setup.currency,
    } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Meta publish plan was not found." }, { status: 404 });
  }
}

function blockerCode(message: string): string {
  return message.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 80) || "publish_blocked";
}
