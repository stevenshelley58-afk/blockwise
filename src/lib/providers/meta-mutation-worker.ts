import { executeMetaPlanMutation, type MetaPlanMutation, type MetaPlanMutationAction } from "./meta-mutations.ts";
import { loadStoredProviderTokens } from "./provider-connections.ts";
import { loadMetaPublishPlan } from "./meta-execution.ts";
import type { createSupabaseServiceClient } from "../supabase/service.ts";
import type { ApprovalStatus } from "../publishing/readiness.ts";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

function providerWritesEnabled() {
  return process.env.BLOCKWISE_ENABLE_PROVIDER_WRITES === "true";
}

type MetaMutationRow = {
  id: string;
  workspace_id: string;
  meta_publish_plan_id: string | null;
  action: MetaPlanMutationAction;
  status: MetaPlanMutation["status"];
  payload_json: Record<string, unknown>;
  approval_request_id: string | null;
  request_log_json: MetaPlanMutation["requestLog"];
  response_log_json: MetaPlanMutation["responseLog"];
  last_error: string | null;
  requested_by: string | null;
  created_at: string;
  updated_at: string;
};

export async function executeMetaMutationById(input: {
  serviceSupabase: SupabaseServiceClient;
  workspaceId: string;
  mutationId: string;
}) {
  const mutation = await loadMutation(input.serviceSupabase, input.workspaceId, input.mutationId);

  if (!providerWritesEnabled()) {
    const skipped = {
      ...mutation,
      status: "failed" as const,
      lastError: "Provider writes are disabled by BLOCKWISE_ENABLE_PROVIDER_WRITES.",
      updatedAt: new Date().toISOString(),
    };
    await updateMutation(input.serviceSupabase, skipped);

    return skipped;
  }

  // A plan-backed mutation resolves its token from the plan's provider
  // connection. Inline management of a Meta-created object has no plan, so we
  // resolve the workspace's Meta provider connection directly.
  const providerConnectionId = mutation.planId
    ? (
        await loadMetaPublishPlan(input.serviceSupabase, {
          workspaceId: input.workspaceId,
          planId: mutation.planId,
        })
      ).providerConnectionId
    : await resolveWorkspaceMetaConnectionId(input.serviceSupabase, input.workspaceId);
  const approvalStatus = mutation.approvalRequestId
    ? await loadApprovalStatus(input.serviceSupabase, input.workspaceId, mutation.approvalRequestId)
    : "draft";

  await updateMutation(input.serviceSupabase, {
    ...mutation,
    status: "applying",
    updatedAt: new Date().toISOString(),
  });

  try {
    const tokens = await loadStoredProviderTokens(input.serviceSupabase, providerConnectionId);

    if (!tokens.accessToken) {
      throw new Error("Meta mutation cannot run without a stored Meta access token.");
    }

    const result = await executeMetaPlanMutation({
      mutation,
      approvalStatus,
      accessToken: tokens.accessToken,
    });
    const updated = {
      ...mutation,
      status: result.status,
      requestLog: result.requestLog,
      responseLog: result.responseLog,
      lastError: result.lastError,
      updatedAt: new Date().toISOString(),
    };

    await updateMutation(input.serviceSupabase, updated);
    await input.serviceSupabase.from("audit_logs").insert({
      workspace_id: input.workspaceId,
      actor_profile_id: mutation.requestedBy,
      action: `meta.${mutation.action}`,
      target_type: "meta_publish_plan_mutation",
      target_id: mutation.mutationId,
      metadata: {
        planId: mutation.planId,
        status: result.status,
        lastError: result.lastError,
      },
    });

    return updated;
  } catch (error) {
    const failed = {
      ...mutation,
      status: "failed" as const,
      lastError: error instanceof Error ? error.message : "Meta mutation worker failed.",
      updatedAt: new Date().toISOString(),
    };
    await updateMutation(input.serviceSupabase, failed);
    throw error;
  }
}

/**
 * Resolve the active Meta provider connection for a workspace. Used for inline
 * management mutations that have no owning publish plan (Meta-created objects).
 */
export async function resolveWorkspaceMetaConnectionId(
  serviceSupabase: SupabaseServiceClient,
  workspaceId: string,
): Promise<string> {
  const { data, error } = await serviceSupabase
    .from("provider_connections")
    .select("id,status")
    .eq("workspace_id", workspaceId)
    .eq("provider", "meta")
    .neq("status", "not_connected")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data?.id) {
    throw new Error("No connected Meta provider connection for this workspace.");
  }

  return data.id as string;
}

export async function loadMutation(
  serviceSupabase: SupabaseServiceClient,
  workspaceId: string,
  mutationId: string,
): Promise<MetaPlanMutation> {
  const { data, error } = await serviceSupabase
    .from("meta_publish_plan_mutations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", mutationId)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Meta mutation was not found.");
  }

  return rowToMutation(data as MetaMutationRow);
}

export async function updateMutation(serviceSupabase: SupabaseServiceClient, mutation: MetaPlanMutation) {
  const { error } = await serviceSupabase
    .from("meta_publish_plan_mutations")
    .update({
      status: mutation.status,
      request_log_json: mutation.requestLog,
      response_log_json: mutation.responseLog,
      last_error: mutation.lastError,
      updated_at: mutation.updatedAt,
    })
    .eq("workspace_id", mutation.workspaceId)
    .eq("id", mutation.mutationId);

  if (error) {
    throw new Error(error.message);
  }
}

async function loadApprovalStatus(
  serviceSupabase: SupabaseServiceClient,
  workspaceId: string,
  approvalRequestId: string,
): Promise<ApprovalStatus> {
  const { data } = await serviceSupabase
    .from("approval_requests")
    .select("status")
    .eq("workspace_id", workspaceId)
    .eq("id", approvalRequestId)
    .maybeSingle();

  return data?.status === "approved" ||
    data?.status === "rejected" ||
    data?.status === "cancelled" ||
    data?.status === "requested"
    ? data.status
    : "draft";
}

function rowToMutation(row: MetaMutationRow): MetaPlanMutation {
  return {
    mutationId: row.id,
    workspaceId: row.workspace_id,
    planId: row.meta_publish_plan_id,
    action: row.action,
    status: row.status,
    payload: row.payload_json,
    approvalRequestId: row.approval_request_id,
    requestedBy: row.requested_by,
    requestLog: row.request_log_json ?? [],
    responseLog: row.response_log_json ?? [],
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
