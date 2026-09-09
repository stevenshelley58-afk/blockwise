import { NextResponse, type NextRequest } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { loadMetaPublishPlan } from "@/lib/providers/meta-execution";
import {
  buildOwnedMetaBudgetPayload,
  buildOwnedMetaActivationPayload,
  buildOwnedMetaPausePayload,
  buildMetaPlanMutation,
  type MetaPlanMutationAction,
  type MetaPlanMutationPayload,
} from "@/lib/providers/meta-mutations";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type MutationBody = {
  workspaceId?: string;
  action?: MetaPlanMutationAction;
  payload?: MetaPlanMutationPayload & { dailyBudgetMinorUnits?: number };
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const body = (await request.json().catch(() => ({}))) as MutationBody;

  if (!body.action || !["activate", "pause", "increase_budget", "export_leads"].includes(body.action)) {
    return NextResponse.json({ error: "action must be activate, pause, increase_budget, or export_leads." }, { status: 400 });
  }

  const guard = await requireApiWorkspace(request, "adstudio", body.workspaceId ?? request.nextUrl.searchParams.get("workspaceId"));

  if (!guard.ok) return guard.response;
  const { access } = guard;

  const clientObjectIdField = firstClientObjectIdField(body.payload ?? {});
  if (clientObjectIdField) {
    return NextResponse.json(
      { error: `payload.${clientObjectIdField} is server-derived and must not be supplied.` },
      { status: 400 },
    );
  }

  const serviceSupabase = createSupabaseServiceClient();
  const plan = await loadMetaPublishPlan(serviceSupabase, {
    workspaceId: access.workspaceId,
    planId: id,
  });
  let mutation: ReturnType<typeof buildMetaPlanMutation>;
  try {
    mutation = buildMetaPlanMutation({
      workspaceId: access.workspaceId,
      planId: plan.planId,
      requestedBy: access.userId,
      action: body.action,
      payload: withDefaultMutationPayload(body.action, body.payload ?? {}, plan),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Meta mutation targets are invalid." },
      { status: 400 },
    );
  }
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
    if (body.action === "activate" && mutationError.code === "23505") {
      const { data: existing } = await serviceSupabase.from("meta_publish_plan_mutations")
        .select("id,status,approval_request_id").eq("workspace_id", mutation.workspaceId).eq("id", mutation.mutationId).maybeSingle();
      if (existing) return NextResponse.json({ mutation: existing, reused: true, queueJobId: null });
    }
    return NextResponse.json({ error: mutationError.message }, { status: 500 });
  }

  const { data: approval, error: approvalError } = await serviceSupabase
    .from("approval_requests")
    .insert({
      workspace_id: mutation.workspaceId,
      target_type: mutation.approval.targetType,
      target_id: mutation.approval.targetId,
      status: body.action === "activate" ? "approved" : mutation.approval.status,
      requested_by: access.userId,
      ...(body.action === "activate" ? { approved_by: access.userId, resolved_at: new Date().toISOString() } : {}),
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

  let queueJobId: string | null = null;
  if (body.action === "activate") {
    const { error: approveError } = await serviceSupabase.from("meta_publish_plan_mutations")
      .update({ status: "approved", last_error: null, updated_at: new Date().toISOString() })
      .eq("workspace_id", mutation.workspaceId).eq("id", mutation.mutationId);
    if (approveError) return NextResponse.json({ error: approveError.message }, { status: 500 });
    try {
      const queued = await queueMetaMutationExecution({ workspaceId: mutation.workspaceId, mutationId: mutation.mutationId });
      queueJobId = queued.id ?? null;
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Activation was not queued." }, { status: 502 });
    }
    await serviceSupabase.from("audit_logs").insert({
      workspace_id: access.workspaceId, actor_profile_id: access.userId,
      action: "meta_activation_spend_confirmed", target_type: "meta_publish_plan", target_id: plan.planId,
      metadata: { dailyBudgetMinorUnits: activationExpectedBudget, currency: plan.setup.currency, planToken: plan.complianceSubjectHash, mutationId: mutation.mutationId, queueJobId },
    });
    await updateMetaPublishPlanExecution(serviceSupabase, { ...plan, status: "activating", lastError: null, updatedAt: new Date().toISOString() });
  }

  return NextResponse.json({
    mutation: {
      ...mutation,
      approvalRequestId: approval.id,
    },
    approval,
    queueJobId,
  });
}

function withDefaultMutationPayload(
  action: MetaPlanMutationAction,
  payload: MetaPlanMutationPayload & { dailyBudgetMinorUnits?: number },
  plan: Awaited<ReturnType<typeof loadMetaPublishPlan>>,
): MetaPlanMutationPayload {
  if (action === "activate") {
    return buildOwnedMetaActivationPayload(plan);
  }
  if (action === "pause") {
    return buildOwnedMetaPausePayload(plan);
  }

  if (action === "export_leads") {
    return {
      ...payload,
      destination: payload.destination ?? plan.setup.leadDestination.label,
    };
  }

  if (action === "increase_budget") {
    return buildOwnedMetaBudgetPayload(plan, payload.dailyBudgetMinorUnits ?? 7500);
  }

  return payload;
}

function firstClientObjectIdField(
  payload: MetaPlanMutationPayload & { dailyBudgetMinorUnits?: number },
): string | null {
  for (const field of [
    "campaignId",
    "adSetIds",
    "adIds",
    "reusedCampaignId",
    "reusedAdSetIds",
    "adSetBudgets",
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) return field;
  }
  return null;
}
