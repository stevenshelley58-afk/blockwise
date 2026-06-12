import {
  applyMetaPublishExecutionResult,
  createMetaExecutionAdapter,
  loadMetaPublishPlan,
  updateMetaPublishPlanExecution,
  type MetaPublishPlan,
} from "./meta-execution.ts";
import { loadStoredProviderTokens } from "./provider-connections.ts";
import type { createSupabaseServiceClient } from "../supabase/service.ts";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

function providerWritesEnabled() {
  return process.env.BLOCKWISE_ENABLE_PROVIDER_WRITES === "true";
}

export async function executeMetaPublishPlanById(input: {
  serviceSupabase: SupabaseServiceClient;
  workspaceId: string;
  planId: string;
  fetchImpl?: typeof fetch;
}) {
  const plan = await loadMetaPublishPlan(input.serviceSupabase, {
    workspaceId: input.workspaceId,
    planId: input.planId,
  });

  if (!providerWritesEnabled()) {
    const failedPlan: MetaPublishPlan = {
      ...plan,
      status: "failed",
      lastError: "Provider writes are disabled by BLOCKWISE_ENABLE_PROVIDER_WRITES.",
      updatedAt: new Date().toISOString(),
    };
    await updateMetaPublishPlanExecution(input.serviceSupabase, failedPlan);
    await persistPublishAudit(input.serviceSupabase, failedPlan);

    return failedPlan;
  }

  return executeMetaPublishPlan({
    serviceSupabase: input.serviceSupabase,
    plan,
    fetchImpl: input.fetchImpl,
  });
}

export async function executeMetaPublishPlan(input: {
  serviceSupabase: SupabaseServiceClient;
  plan: MetaPublishPlan;
  fetchImpl?: typeof fetch;
}) {
  if (input.plan.status !== "approved" && input.plan.status !== "publishing") {
    throw new Error("Meta publish plan must be approved before worker execution.");
  }

  const publishingPlan: MetaPublishPlan = {
    ...input.plan,
    status: "publishing",
    updatedAt: new Date().toISOString(),
  };
  await updateMetaPublishPlanExecution(input.serviceSupabase, publishingPlan);

  try {
    const tokens = await loadStoredProviderTokens(input.serviceSupabase, publishingPlan.providerConnectionId);

    if (!tokens.accessToken) {
      throw new Error("Meta access token is missing.");
    }

    const result = await createMetaExecutionAdapter(publishingPlan.adapter).publish(publishingPlan, {
      accessToken: tokens.accessToken,
      fetchImpl: input.fetchImpl,
    });
    const completedPlan = applyMetaPublishExecutionResult(publishingPlan, result);

    await updateMetaPublishPlanExecution(input.serviceSupabase, completedPlan);
    await persistPublishAudit(input.serviceSupabase, completedPlan);

    return completedPlan;
  } catch (error) {
    const failedPlan: MetaPublishPlan = {
      ...publishingPlan,
      status: "failed",
      lastError: error instanceof Error ? error.message : "Meta publish worker failed.",
      updatedAt: new Date().toISOString(),
    };
    await updateMetaPublishPlanExecution(input.serviceSupabase, failedPlan);
    await persistPublishAudit(input.serviceSupabase, failedPlan);
    throw error;
  }
}

async function persistPublishAudit(serviceSupabase: SupabaseServiceClient, plan: MetaPublishPlan) {
  await serviceSupabase.from("audit_logs").insert({
    workspace_id: plan.workspaceId,
    actor_profile_id: null,
    action: `meta_publish_${plan.status}`,
    target_type: "meta_publish_plan",
    target_id: plan.planId,
    metadata: {
      adapter: plan.adapter,
      idempotencyKey: plan.idempotencyKey,
      reconciledObjects: plan.reconciledObjects,
      lastError: plan.lastError,
    },
  });

  if (!plan.legacyCampaignId) {
    return;
  }

  await serviceSupabase.from("publish_statuses").insert({
    workspace_id: plan.workspaceId,
    campaign_id: plan.legacyCampaignId,
    provider: "meta",
    status: plan.status,
    approval_request_id: plan.approvalRequestId,
    provider_response: {
      metaPublishPlanId: plan.planId,
      adapter: plan.adapter,
      reconciledObjects: plan.reconciledObjects,
      lastError: plan.lastError,
    },
    updated_at: new Date().toISOString(),
  });
}
