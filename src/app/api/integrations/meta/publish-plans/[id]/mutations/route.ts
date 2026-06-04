import { NextResponse, type NextRequest } from "next/server";

import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { loadMetaPublishPlan } from "@/lib/providers/meta-execution";
import {
  buildMetaPlanMutation,
  type MetaPlanMutationAction,
  type MetaPlanMutationPayload,
} from "@/lib/providers/meta-mutations";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type MutationBody = {
  workspaceId?: string;
  action?: MetaPlanMutationAction;
  payload?: MetaPlanMutationPayload;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const body = (await request.json().catch(() => ({}))) as MutationBody;

  if (!body.action || !["activate", "pause", "increase_budget", "export_leads"].includes(body.action)) {
    return NextResponse.json({ error: "action must be activate, pause, increase_budget, or export_leads." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, {
    surface: "adstudio",
    requestedWorkspaceId: body.workspaceId ?? request.nextUrl.searchParams.get("workspaceId"),
  });

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const serviceSupabase = createSupabaseServiceClient();
  const plan = await loadMetaPublishPlan(serviceSupabase, {
    workspaceId: access.access.workspaceId,
    planId: id,
  });
  const mutation = buildMetaPlanMutation({
    workspaceId: access.access.workspaceId,
    planId: plan.planId,
    requestedBy: access.access.userId,
    action: body.action,
    payload: withDefaultMutationPayload(body.action, body.payload ?? {}, plan),
  });
  const { error: mutationError } = await serviceSupabase
    .from("meta_publish_plan_mutations")
    .insert({
      id: mutation.mutationId,
      workspace_id: mutation.workspaceId,
      meta_publish_plan_id: mutation.planId,
      action: mutation.action,
      status: mutation.status,
      payload_json: mutation.payload,
      requested_by: mutation.requestedBy,
      request_log_json: mutation.requestLog,
      response_log_json: mutation.responseLog,
      last_error: mutation.lastError,
      updated_at: mutation.updatedAt,
    });

  if (mutationError) {
    return NextResponse.json({ error: mutationError.message }, { status: 500 });
  }

  const { data: approval, error: approvalError } = await serviceSupabase
    .from("approval_requests")
    .insert({
      workspace_id: mutation.workspaceId,
      target_type: mutation.approval.targetType,
      target_id: mutation.approval.targetId,
      status: mutation.approval.status,
      requested_by: access.access.userId,
      risk_summary: mutation.approval.riskSummary,
    })
    .select("id,status,risk_summary")
    .single();

  if (approvalError || !approval) {
    return NextResponse.json({ error: approvalError?.message ?? "Unable to create approval request." }, { status: 500 });
  }

  await serviceSupabase
    .from("meta_publish_plan_mutations")
    .update({
      approval_request_id: approval.id,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", mutation.workspaceId)
    .eq("id", mutation.mutationId);

  return NextResponse.json({
    mutation: {
      ...mutation,
      approvalRequestId: approval.id,
    },
    approval,
  });
}

function withDefaultMutationPayload(
  action: MetaPlanMutationAction,
  payload: MetaPlanMutationPayload,
  plan: Awaited<ReturnType<typeof loadMetaPublishPlan>>,
): MetaPlanMutationPayload {
  if (action === "activate" || action === "pause") {
    return {
      ...payload,
      campaignId: payload.campaignId ?? plan.reconciledObjects.campaignId,
      adSetIds: payload.adSetIds ?? Object.values(plan.reconciledObjects.adSetIds),
      adIds: payload.adIds ?? Object.values(plan.reconciledObjects.adIds),
    };
  }

  if (action === "export_leads") {
    return {
      ...payload,
      destination: payload.destination ?? plan.setup.leadDestination.label,
    };
  }

  if (action === "increase_budget" && !payload.adSetBudgets?.length) {
    return {
      ...payload,
      adSetBudgets: Object.values(plan.reconciledObjects.adSetIds).map((adSetId) => ({
        adSetId,
        dailyBudgetMinorUnits: 7500,
      })),
    };
  }

  return payload;
}
