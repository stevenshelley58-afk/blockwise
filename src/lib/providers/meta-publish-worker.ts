import {
  applyMetaPublishExecutionResult,
  createMetaExecutionAdapter,
  loadMetaPublishPlan,
  updateMetaPublishPlanExecution,
  type MetaPublishPlan,
} from "./meta-execution.ts";
import { loadStoredProviderTokens } from "../api-control/provider-connections.ts";
import { recordAudit } from "../audit/record-audit.ts";
import { assertJobCapability } from "../auth/job-capability.ts";
import type { createSupabaseServiceClient } from "../supabase/service.ts";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export async function executeMetaPublishPlanById(input: {
  serviceSupabase: SupabaseServiceClient;
  workspaceId: string;
  planId: string;
  actorProfileId?: string | null;
  fetchImpl?: typeof fetch;
}) {
  // Jobs bypass RLS - enforce the capability in code (defence in depth; the
  // HTTP publish route already requires publish_ads before enqueuing).
  await assertJobCapability(
    input.serviceSupabase,
    input.actorProfileId ?? null,
    input.workspaceId,
    "publish_ads",
  );

  const plan = await loadMetaPublishPlan(input.serviceSupabase, {
    workspaceId: input.workspaceId,
    planId: input.planId,
  });

  return executeMetaPublishPlan({
    serviceSupabase: input.serviceSupabase,
    plan,
    actorProfileId: input.actorProfileId,
    fetchImpl: input.fetchImpl,
  });
}

export async function executeMetaPublishPlan(input: {
  serviceSupabase: SupabaseServiceClient;
  plan: MetaPublishPlan;
  actorProfileId?: string | null;
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
  await persistPublishAudit(input.serviceSupabase, completedPlan, input.actorProfileId ?? null);

  return completedPlan;
}

async function persistPublishAudit(
  serviceSupabase: SupabaseServiceClient,
  plan: MetaPublishPlan,
  actorProfileId: string | null,
) {
  await recordAudit(serviceSupabase, {
    workspaceId: plan.workspaceId,
    actorProfileId,
    action: "publish_ads",
    targetType: "meta_publish_plan",
    targetId: plan.planId,
    metadata: {
      status: plan.status,
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
