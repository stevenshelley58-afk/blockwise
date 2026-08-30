import { NextResponse, type NextRequest } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import {
  buildMetaPlanMutation,
  type MetaPlanMutationAction,
  type MetaPlanMutationPayload,
} from "@/lib/providers/meta-mutations";
import { loadMutation } from "@/lib/providers/meta-mutation-worker";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS: MetaPlanMutationAction[] = ["activate", "pause", "increase_budget", "export_leads"];

type ManageBody = {
  workspaceId?: string;
  action?: MetaPlanMutationAction;
  /** export_leads destination. */
  destination?: string;
};

function buildPayload(body: ManageBody): { payload: MetaPlanMutationPayload } | { error: string } {
  if (body.action !== "export_leads") {
    return {
      error: "Live Meta objects can be mutated only through a publish plan with durable ownership proof.",
    };
  }

  return { payload: body.destination ? { destination: body.destination } : {} };
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as ManageBody;

  if (!body.action || !ACTIONS.includes(body.action)) {
    return NextResponse.json(
      { error: "action must be activate, pause, increase_budget, or export_leads." },
      { status: 400 },
    );
  }

  const guard = await requireApiWorkspace(
    request,
    "monitor",
    body.workspaceId ?? request.nextUrl.searchParams.get("workspaceId"),
  );
  if (!guard.ok) return guard.response;
  const { access } = guard;

  const built = buildPayload(body);
  if ("error" in built) {
    return NextResponse.json({ error: built.error }, { status: 400 });
  }

  const serviceSupabase = createSupabaseServiceClient();

  // Lead export is non-provider-mutating and may remain planless.
  const mutation = buildMetaPlanMutation({
    workspaceId: access.workspaceId,
    planId: null,
    requestedBy: access.userId,
    action: body.action,
    payload: built.payload,
  });

  const { error: mutationError } = await serviceSupabase.from("meta_publish_plan_mutations").insert({
    id: mutation.mutationId,
    workspace_id: mutation.workspaceId,
    meta_publish_plan_id: null,
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
      requested_by: access.userId,
      risk_summary: mutation.approval.riskSummary,
    })
    .select("id,status,risk_summary")
    .single();

  if (approvalError || !approval) {
    return NextResponse.json(
      { error: approvalError?.message ?? "Unable to create approval request." },
      { status: 500 },
    );
  }

  await serviceSupabase
    .from("meta_publish_plan_mutations")
    .update({ approval_request_id: approval.id, updated_at: new Date().toISOString() })
    .eq("workspace_id", mutation.workspaceId)
    .eq("id", mutation.mutationId);

  return NextResponse.json({
    mutation: {
      mutationId: mutation.mutationId,
      action: mutation.action,
      status: mutation.status,
      riskSummary: mutation.approval.riskSummary,
      approvalRequestId: approval.id,
    },
  });
}

export async function GET(request: NextRequest) {
  const mutationId = request.nextUrl.searchParams.get("mutationId");
  if (!mutationId) {
    return NextResponse.json({ error: "mutationId is required." }, { status: 400 });
  }

  const guard = await requireApiWorkspace(request, "monitor", request.nextUrl.searchParams.get("workspaceId"));
  if (!guard.ok) return guard.response;

  const serviceSupabase = createSupabaseServiceClient();
  try {
    const mutation = await loadMutation(serviceSupabase, guard.access.workspaceId, mutationId);
    return NextResponse.json({
      mutation: {
        mutationId: mutation.mutationId,
        action: mutation.action,
        status: mutation.status,
        lastError: mutation.lastError,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Mutation not found." },
      { status: 404 },
    );
  }
}
