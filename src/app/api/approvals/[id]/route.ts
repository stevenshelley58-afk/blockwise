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

type ApprovalTarget = {
  id: string;
  target_type: string;
  target_id: string;
  status: string;
};

function providerWritesEnabled() {
  return process.env.BLOCKWISE_ENABLE_PROVIDER_WRITES === "true";
}

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
  const { data: currentApproval, error: loadError } = await serviceSupabase
    .from("approval_requests")
    .select("id,target_type,target_id,status")
    .eq("id", id)
    .eq("workspace_id", access.access.workspaceId)
    .single();

  if (loadError || !currentApproval) {
    return NextResponse.json({ error: loadError?.message ?? "Approval request was not found." }, { status: 404 });
  }

  let triggerRunId: string | null = null;

  if (body.status === "approved") {
    try {
      triggerRunId = await queueApprovedTarget({
        serviceSupabase,
        approval: currentApproval as ApprovalTarget,
        workspaceId: access.access.workspaceId,
        userId: access.access.userId,
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unable to queue approval execution." },
        { status: 502 },
      );
    }
  }

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

  await serviceSupabase.from("audit_logs").insert({
    workspace_id: access.access.workspaceId,
    actor_profile_id: access.access.userId,
    action: `approval_${body.status}`,
    target_type: "approval_request",
    target_id: approval.id,
    metadata: {
      targetType: approval.target_type,
      targetId: approval.target_id,
      status: body.status,
    },
  });

  return NextResponse.json({
    approval,
    triggerRunId,
  });
}

async function queueApprovedTarget(input: {
  serviceSupabase: ReturnType<typeof createSupabaseServiceClient>;
  approval: ApprovalTarget;
  workspaceId: string;
  userId: string;
}) {
  if (!isProviderWriteTarget(input.approval.target_type)) {
    return null;
  }

  if (!providerWritesEnabled()) {
    await persistProviderWritesDisabledState(input);
    throw new Error("Provider writes are disabled by BLOCKWISE_ENABLE_PROVIDER_WRITES; approval was not queued.");
  }

  if (input.approval.target_type === "meta_publish_plan_mutation") {
    const queued = await queueMetaMutationExecution({
      workspaceId: input.workspaceId,
      mutationId: input.approval.target_id,
    });

    return queued.id ?? null;
  }

  if (input.approval.target_type === "meta_publish_plan") {
    const plan = await loadMetaPublishPlan(input.serviceSupabase, {
      workspaceId: input.workspaceId,
      planId: input.approval.target_id,
    });
    const approvedPlan = {
      ...plan,
      status: "approved" as const,
      approvalRequestId: input.approval.id,
      updatedAt: new Date().toISOString(),
    };
    const queued = await queueMetaPublishPlanExecution(approvedPlan);
    await persistMetaPublishPlan(input.serviceSupabase, approvedPlan, input.userId);

    return queued.id ?? null;
  }

  if (input.approval.target_type === "lead_delivery_attempt") {
    const queued = await queueLeadDeliveryAttempt({
      workspaceId: input.workspaceId,
      attemptId: input.approval.target_id,
    });

    return queued.id ?? null;
  }

  return null;
}

function isProviderWriteTarget(targetType: string) {
  return targetType === "meta_publish_plan_mutation" || targetType === "meta_publish_plan" || targetType === "lead_delivery_attempt";
}

async function persistProviderWritesDisabledState(input: {
  serviceSupabase: ReturnType<typeof createSupabaseServiceClient>;
  approval: ApprovalTarget;
  workspaceId: string;
  userId: string;
}) {
  const message = "Provider writes are disabled by BLOCKWISE_ENABLE_PROVIDER_WRITES.";

  if (input.approval.target_type === "meta_publish_plan") {
    const plan = await loadMetaPublishPlan(input.serviceSupabase, {
      workspaceId: input.workspaceId,
      planId: input.approval.target_id,
    });
    await persistMetaPublishPlan(
      input.serviceSupabase,
      {
        ...plan,
        status: "failed",
        lastError: message,
        updatedAt: new Date().toISOString(),
      },
      input.userId,
    );
  } else if (input.approval.target_type === "meta_publish_plan_mutation") {
    const { error } = await input.serviceSupabase
      .from("meta_publish_plan_mutations")
      .update({
        status: "failed",
        last_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", input.workspaceId)
      .eq("id", input.approval.target_id);

    if (error) {
      throw new Error(error.message);
    }
  } else if (input.approval.target_type === "lead_delivery_attempt") {
    const { error } = await input.serviceSupabase
      .from("lead_delivery_attempts")
      .update({
        status: "failed",
        response_json: { message },
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", input.workspaceId)
      .eq("id", input.approval.target_id);

    if (error) {
      throw new Error(error.message);
    }
  }
}
