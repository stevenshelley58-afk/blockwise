import { NextResponse, type NextRequest } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { queueLeadDeliveryAttempt } from "@/lib/providers/lead-delivery-queue";
import { queueMetaMutationExecution } from "@/lib/providers/meta-mutation-queue";
import { queueMetaPublishPlanExecution } from "@/lib/providers/meta-publish-queue";
import { loadMetaPublishPlan, persistMetaPublishPlan } from "@/lib/providers/meta-execution";
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
  const guard = await requireApiWorkspace(
    request,
    "approvals",
    body.workspaceId ?? request.nextUrl.searchParams.get("workspaceId"),
  );
  if (!guard.ok) return guard.response;
  const { access } = guard;

  if (body.status !== "approved" && body.status !== "rejected" && body.status !== "cancelled") {
    return NextResponse.json({ error: "status must be approved, rejected, or cancelled." }, { status: 400 });
  }

  const serviceSupabase = createSupabaseServiceClient();
  const { data: approval, error } = await serviceSupabase
    .from("approval_requests")
    .update({
      status: body.status,
      approved_by: body.status === "approved" ? access.userId : null,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("workspace_id", access.workspaceId)
    .select("id,target_type,target_id,status")
    .single();

  if (error || !approval) {
    return NextResponse.json({ error: error?.message ?? "Approval request was not found." }, { status: 404 });
  }

  await serviceSupabase.from("audit_logs").insert({
    workspace_id: access.workspaceId,
    actor_profile_id: access.userId,
    action: `approval_${body.status}`,
    target_type: "approval_request",
    target_id: approval.id,
    metadata: {
      targetType: approval.target_type,
      targetId: approval.target_id,
      status: body.status,
    },
  });

  let triggerRunId: string | null = null;

  if (body.status === "approved" && approval.target_type === "meta_publish_plan_mutation") {
    const queued = await queueMetaMutationExecution({
      workspaceId: access.workspaceId,
      mutationId: approval.target_id,
    });
    triggerRunId = queued.id ?? null;
  } else if (body.status === "approved" && approval.target_type === "meta_publish_plan") {
    const plan = await loadMetaPublishPlan(serviceSupabase, {
      workspaceId: access.workspaceId,
      planId: approval.target_id,
    });
    const approvedPlan = {
      ...plan,
      status: "approved" as const,
      approvalRequestId: approval.id as string,
      updatedAt: new Date().toISOString(),
    };
    await persistMetaPublishPlan(serviceSupabase, approvedPlan, access.userId);
    const queued = await queueMetaPublishPlanExecution(approvedPlan);
    triggerRunId = queued.id ?? null;
  } else if (body.status === "approved" && approval.target_type === "lead_delivery_attempt") {
    const queued = await queueLeadDeliveryAttempt({
      workspaceId: access.workspaceId,
      attemptId: approval.target_id,
    });
    triggerRunId = queued.id ?? null;
  }

  return NextResponse.json({
    approval,
    triggerRunId,
  });
}
