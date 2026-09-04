import { executeMetaPlanMutation, type MetaPlanMutation, type MetaPlanMutationAction } from "./meta-mutations.ts";
import { loadStoredProviderTokens } from "./provider-connections.ts";
import { metaPublishProviderWritesEnabled } from "./meta-provider-write-gate.ts";
import { loadMetaPublishPlan } from "./meta-execution.ts";
import { queueReportingRefresh } from "../meta-monitor/reporting-refresh-queue.ts";
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
  fetchImpl?: typeof fetch;
  compensationFetchImpl?: typeof fetch;
  onCheckpoint?: () => Promise<void>;
}) {
  const mutation = await loadMutation(input.serviceSupabase, input.workspaceId, input.mutationId);

  const planBackedActivationAllowed = mutation.action !== "activate" || !mutation.planId ||
    metaPublishProviderWritesEnabled(mutation.workspaceId);
  if (!providerWritesEnabled() || !planBackedActivationAllowed) {
    const skipped = {
      ...mutation,
      status: "failed" as const,
      lastError: "Provider writes are disabled for this workspace by the Meta publish safety gate.",
      unconfirmedPauseIds: undefined as string[] | undefined,
      updatedAt: new Date().toISOString(),
    };
    await updateMutation(input.serviceSupabase, skipped);

    return skipped;
  }

  // A plan-backed mutation resolves its token from the plan's provider
  // connection. Inline management of a Meta-created object has no plan, so we
  // resolve the workspace's Meta provider connection directly.
  const publishPlan = mutation.planId
    ? await loadMetaPublishPlan(input.serviceSupabase, {
        workspaceId: input.workspaceId,
        planId: mutation.planId,
      })
    : null;
  const providerConnectionId = publishPlan?.providerConnectionId ??
    await resolveWorkspaceMetaConnectionId(input.serviceSupabase, input.workspaceId);
  const approvalStatus = mutation.approvalRequestId
    ? await loadApprovalStatus(input.serviceSupabase, input.workspaceId, mutation.approvalRequestId)
    : "draft";

  await updateMutation(input.serviceSupabase, {
    ...mutation,
    status: "applying",
    updatedAt: new Date().toISOString(),
  });

  let providerExecutionOutcome: MetaPlanMutation | null = null;
  try {
    const tokens = await loadStoredProviderTokens(input.serviceSupabase, providerConnectionId);

    if (!tokens.accessToken) {
      throw new Error("Meta mutation cannot run without a stored Meta access token.");
    }

    const result = await executeMetaPlanMutation({
      mutation,
      publishPlan,
      approvalStatus,
      accessToken: tokens.accessToken,
      fetchImpl: input.fetchImpl,
      compensationFetchImpl: input.compensationFetchImpl,
      onCheckpoint: input.onCheckpoint ? async () => input.onCheckpoint?.() : undefined,
    });
    const updated = {
      ...mutation,
      status: result.status,
      requestLog: result.requestLog,
      responseLog: result.responseLog,
      lastError: result.lastError,
      updatedAt: new Date().toISOString(),
    };
    // Carried for callers (activation receipts) so an indeterminate pause
    // state after a failed activate can be reported honestly — it is not
    // persisted on the mutation row.
    const unconfirmedPauseIds = "unconfirmedPauseIds" in result
      ? (result as { unconfirmedPauseIds?: string[] }).unconfirmedPauseIds
      : undefined;
    const executionOutcome = { ...updated, unconfirmedPauseIds };
    providerExecutionOutcome = updated;

    const outcomeStatus = mutation.action === "activate" && result.status === "failed"
      ? unconfirmedPauseIds?.length ? "unconfirmed" : "confirmed_paused"
      : null;
    await finalizeMutationWithAudit(input.serviceSupabase, updated, {
      outcomeStatus,
      unconfirmedPauseIds: unconfirmedPauseIds ?? [],
    });

    if (result.status === "applied") {
      await queueReportingRefresh({
        workspaceId: input.workspaceId,
        range: "last_30",
        reason: "mutation",
      }).catch((queueError) => {
        console.warn("[meta-reporting] mutation refresh could not be queued", queueError);
      });
    }

    return executionOutcome;
  } catch (error) {
    const failed = {
      ...mutation,
      status: "failed" as const,
      lastError: error instanceof Error ? error.message : "Meta mutation worker failed.",
      updatedAt: new Date().toISOString(),
    };
    if (providerExecutionOutcome && mutation.action === "activate") {
      await markActivationFinalizationUnconfirmed(input.serviceSupabase, providerExecutionOutcome).catch(() => undefined);
    } else if (!providerExecutionOutcome) {
      await finalizeMutationWithAudit(input.serviceSupabase, failed, {
        outcomeStatus: mutation.action === "activate" ? "confirmed_paused" : null,
        unconfirmedPauseIds: [],
      }).catch(async () => updateMutation(input.serviceSupabase, failed));
    }
    throw error;
  }
}

async function finalizeMutationWithAudit(
  serviceSupabase: SupabaseServiceClient,
  mutation: MetaPlanMutation,
  outcome: { outcomeStatus: "confirmed_paused" | "unconfirmed" | null; unconfirmedPauseIds: string[] },
) {
  const { data, error } = await serviceSupabase.rpc("finalize_meta_publish_plan_mutation", {
    p_workspace_id: mutation.workspaceId,
    p_mutation_id: mutation.mutationId,
    p_status: mutation.status,
    p_request_log: mutation.requestLog,
    p_response_log: mutation.responseLog,
    p_last_error: mutation.lastError,
    p_outcome_status: outcome.outcomeStatus,
    p_unconfirmed_pause_ids: outcome.unconfirmedPauseIds,
  });
  if (error || data !== true) throw new Error(error?.message ?? "Meta mutation outcome and audit could not be finalized atomically.");
}

async function markActivationFinalizationUnconfirmed(
  serviceSupabase: SupabaseServiceClient,
  mutation: MetaPlanMutation,
) {
  const ids = [
    typeof mutation.payload.campaignId === "string" ? mutation.payload.campaignId : null,
    ...(mutation.payload.adSetIds ?? []),
    ...(mutation.payload.adIds ?? []),
  ].filter((value): value is string => Boolean(value));
  const { error } = await serviceSupabase
    .from("meta_publish_plan_mutations")
    .update({
      status: "failed",
      request_log_json: mutation.requestLog,
      response_log_json: mutation.responseLog,
      outcome_status: "unconfirmed",
      unconfirmed_pause_ids_json: ids,
      last_error: "Meta returned a provider outcome, but its durable audit finalization failed. Verify these objects in Meta Ads Manager.",
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", mutation.workspaceId)
    .eq("id", mutation.mutationId);
  if (error) throw new Error(error.message);
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
