import { NextResponse, type NextRequest } from "next/server";

import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { queueLeadDeliveryAttempt } from "@/lib/providers/lead-delivery-queue";
import { queueMetaMutationExecution } from "@/lib/providers/meta-mutation-queue";
import { queueMetaPublishPlanExecution } from "@/lib/providers/meta-publish-queue";
import { loadMetaPublishPlan, persistMetaPublishPlan } from "@/lib/providers/meta-execution";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type ApprovalPatchBody = {
  workspaceId?: string;
  status?: "approved" | "rejected" | "cancelled";
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const body = (await request.json().catch(() => ({}))) as ApprovalPatchBody;
  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, {
    surface: "approvals",
    requestedWorkspaceId: body.workspaceId ?? request.nextUrl.searchParams.get("workspaceId"),
  });

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  if (body.status !== "approved" && body.status !== "rejected" && body.status !== "cancelled") {
    return NextResponse.json({ error: "status must be approved, rejected, or cancelled." }, { status: 400 });
  }

  const serviceSupabase = createSupabaseServiceClient();
  const { data: approval, error } = await serviceSupabase
    .from("approval_requests")
    .update({
      status: body.status,
      approved_by: body.status === "approved" ? access.access.userId : null,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("workspace_id", access.access.workspaceId)
    .select("id,target_type,target_id,status")
    .single();

  if (error || !approval) {
    return NextResponse.json({ error: error?.message ?? "Approval request was not found." }, { status: 404 });
  }

  let triggerRunId: string | null = null;

  if (body.status === "approved" && approval.target_type === "meta_publish_plan_mutation") {
    const queued = await queueMetaMutationExecution({
      workspaceId: access.access.workspaceId,
      mutationId: approval.target_id,
    });
    triggerRunId = queued.id ?? null;
  } else if (body.status === "approved" && approval.target_type === "meta_publish_plan") {
    const plan = await loadMetaPublishPlan(serviceSupabase, {
      workspaceId: access.access.workspaceId,
      planId: approval.target_id,
    });
    const approvedPlan = {
      ...plan,
      status: "approved" as const,
      approvalRequestId: approval.id as string,
      updatedAt: new Date().toISOString(),
    };
    await persistMetaPublishPlan(serviceSupabase, approvedPlan, access.access.userId);
    const queued = await queueMetaPublishPlanExecution(approvedPlan);
    triggerRunId = queued.id ?? null;
  } else if (body.status === "approved" && approval.target_type === "lead_delivery_attempt") {
    const queued = await queueLeadDeliveryAttempt({
      workspaceId: access.access.workspaceId,
      attemptId: approval.target_id,
    });
    triggerRunId = queued.id ?? null;
  }

  return NextResponse.json({
    approval,
    triggerRunId,
  });
}
