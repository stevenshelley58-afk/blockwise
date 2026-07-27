import {
  applyMetaPublishExecutionResult,
  createMetaExecutionAdapter,
  loadMetaPublishPlan,
  updateMetaPublishPlanExecution,
  type MetaProviderLogEntry,
  type MetaPublishExecutionResult,
  type MetaPublishPlan,
} from "./meta-execution.ts";
import {
  consumeMetaFreeLiveClaim,
  metaFreeLiveReservationKey,
  releaseMetaFreeLiveClaim,
  reserveMetaFreeLiveClaim,
  resolveMetaFreeLiveClaimIdentity,
  type MetaFreeLiveClaimIdentity,
} from "./meta-free-live-claims.ts";
import { loadStoredProviderTokens } from "./provider-connections.ts";
import {
  endTrialAfterFirstLiveCampaign,
  validateFirstLiveCampaignBilling,
  type FirstLiveCampaignBillingEligibility,
  type FirstLiveCampaignStripeGateway,
} from "../billing/first-live-campaign.ts";
import { recordWorkspaceFunnelEventBestEffort } from "../analytics/progressive-funnel.ts";
import { recordAuditLog } from "../supabase/audit.ts";
import type { createSupabaseServiceClient } from "../supabase/service.ts";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

function providerWritesEnabled() {
  return process.env.BLOCKWISE_ENABLE_PROVIDER_WRITES === "true";
}

/**
 * A successful, server-error, or response-less POST may have created an object
 * at Meta. The claim must remain reserved until a retry reconciles that object.
 * A fully observed 4xx-only attempt is the only provider-write path safe to
 * release.
 */
export function metaProviderMutationMayHaveOccurred(input: {
  requestLog: MetaProviderLogEntry[];
  responseLog: MetaProviderLogEntry[];
}) {
  const postRequests = input.requestLog.filter((entry) => entry.method === "POST");
  if (postRequests.length === 0) return false;

  const responseCounts = new Map<string, number>();
  for (const response of input.responseLog.filter((entry) => entry.method === "POST")) {
    const key = `${response.step}:${response.path}`;
    responseCounts.set(key, (responseCounts.get(key) ?? 0) + 1);
    if (typeof response.status !== "number" || response.status < 400 || response.status >= 500) {
      return true;
    }
  }

  const requestCounts = new Map<string, number>();
  for (const request of postRequests) {
    const key = `${request.step}:${request.path}`;
    requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);
  }
  return [...requestCounts].some(([key, count]) => count > (responseCounts.get(key) ?? 0));
}

export async function executeMetaPublishPlanById(input: {
  serviceSupabase: SupabaseServiceClient;
  workspaceId: string;
  planId: string;
  fetchImpl?: typeof fetch;
  billingGateway?: FirstLiveCampaignStripeGateway;
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
    billingGateway: input.billingGateway,
  });
}

export async function executeMetaPublishPlan(input: {
  serviceSupabase: SupabaseServiceClient;
  plan: MetaPublishPlan;
  fetchImpl?: typeof fetch;
  billingGateway?: FirstLiveCampaignStripeGateway;
}) {
  if (
    input.plan.status !== "approved" &&
    input.plan.status !== "publishing" &&
    input.plan.status !== "paused_live"
  ) {
    throw new Error("Meta publish plan must be approved before worker execution.");
  }

  const freeLive = await prepareFreeLiveConversion(input);
  if (input.plan.status === "paused_live") {
    await finalizeFreeLiveConversion(input, input.plan, freeLive);
    return input.plan;
  }

  const publishingPlan: MetaPublishPlan = {
    ...input.plan,
    status: "publishing",
    updatedAt: new Date().toISOString(),
  };

  let completedPlan: MetaPublishPlan | null = null;
  let providerResult: MetaPublishExecutionResult | null = null;
  try {
    await updateMetaPublishPlanExecution(input.serviceSupabase, publishingPlan);
    const tokens = await loadStoredProviderTokens(input.serviceSupabase, publishingPlan.providerConnectionId);

    if (!tokens.accessToken) {
      throw new Error("Meta access token is missing.");
    }

    // Resolve storage-sourced creative images to inline bytes in memory only —
    // executionPlan is never persisted, so image payloads stay out of the DB.
    const executionPlan = await resolveStorageCreativeAssets(input.serviceSupabase, publishingPlan);
    const result = await createMetaExecutionAdapter(publishingPlan.adapter).publish(executionPlan, {
      accessToken: tokens.accessToken,
      fetchImpl: input.fetchImpl,
      reconcileMissingObjects: input.plan.status === "publishing",
      onCheckpoint: async (checkpoint) => {
        await updateMetaPublishPlanExecution(
          input.serviceSupabase,
          applyMetaPublishExecutionResult(publishingPlan, checkpoint),
        );
      },
    });
    providerResult = result;
    completedPlan = applyMetaPublishExecutionResult(publishingPlan, result);

    await updateMetaPublishPlanExecution(input.serviceSupabase, completedPlan);
    await persistPublishAudit(input.serviceSupabase, completedPlan);
    if (completedPlan.status !== "paused_live") {
      if (metaProviderMutationMayHaveOccurred(completedPlan)) {
        throw new Error(completedPlan.lastError ?? "Meta publish requires provider reconciliation.");
      }
      if (freeLive) {
        await releasePreparedFreeLiveClaim(input.serviceSupabase, completedPlan, freeLive).catch((releaseError) => {
          console.error("[meta-publish] free-live reservation release failed:", releaseError);
        });
      }
      return completedPlan;
    }
  } catch (error) {
    const providerState = completedPlan ?? providerResult;
    if (providerState && metaProviderMutationMayHaveOccurred(providerState)) {
      const reconciliationPlan: MetaPublishPlan = {
        ...(completedPlan ?? publishingPlan),
        status: "publishing",
        lastError: `Provider reconciliation required: ${
          error instanceof Error ? error.message : "Meta publish outcome is uncertain."
        }`,
        updatedAt: new Date().toISOString(),
      };
      try {
        await updateMetaPublishPlanExecution(input.serviceSupabase, reconciliationPlan);
        await persistPublishAudit(input.serviceSupabase, reconciliationPlan);
      } catch (persistenceError) {
        console.error("[meta-publish] reconciliation state persistence failed:", persistenceError);
      }
      throw error;
    }

    if (freeLive) {
      await releasePreparedFreeLiveClaim(input.serviceSupabase, publishingPlan, freeLive).catch((releaseError) => {
        console.error("[meta-publish] free-live reservation release failed:", releaseError);
      });
    }
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

  // Provider reconciliation is durable before the global claim is consumed.
  // Billing finalization intentionally lives outside the provider failure
  // catch: a Stripe retry must never rewrite a successful Meta plan to failed
  // or release a claim for objects that now exist.
  if (!completedPlan) {
    throw new Error("Meta publish completed without a reconciled plan.");
  }
  await finalizeFreeLiveConversion(input, completedPlan, freeLive);
  return completedPlan;
}

async function releasePreparedFreeLiveClaim(
  service: SupabaseServiceClient,
  plan: MetaPublishPlan,
  freeLive: PreparedFreeLiveConversion,
) {
  return releaseMetaFreeLiveClaim({
    service,
    workspaceId: plan.workspaceId,
    planId: plan.planId,
    identity: freeLive.identity,
    reservationKey: freeLive.reservationKey,
    mutationKey: `${freeLive.reserveMutationKey}:release`,
  });
}

type PreparedFreeLiveConversion = {
  identity: MetaFreeLiveClaimIdentity;
  billing: FirstLiveCampaignBillingEligibility;
  reservationKey: string;
  reserveMutationKey: string;
};

async function prepareFreeLiveConversion(input: {
  serviceSupabase: SupabaseServiceClient;
  plan: MetaPublishPlan;
  billingGateway?: FirstLiveCampaignStripeGateway;
}): Promise<PreparedFreeLiveConversion | null> {
  if (!(await workspaceNeedsFreeLiveConversion(input.serviceSupabase, input.plan.workspaceId))) {
    return null;
  }

  const [{ data: connection, error }, billing] = await Promise.all([
    input.serviceSupabase
      .from("provider_connections")
      .select("metadata_json,external_account_id")
      .eq("workspace_id", input.plan.workspaceId)
      .eq("id", input.plan.providerConnectionId)
      .eq("provider", "meta")
      .single(),
    validateFirstLiveCampaignBilling({
      service: input.serviceSupabase,
      workspaceId: input.plan.workspaceId,
      gateway: input.billingGateway,
      allowActive: input.plan.status === "paused_live",
    }),
  ]);
  if (error || !connection) {
    throw new Error(error?.message ?? "The Meta connection for this publish plan was not found.");
  }

  const row = connection as {
    metadata_json: Record<string, unknown> | null;
    external_account_id: string | null;
  };
  const identity = resolveMetaFreeLiveClaimIdentity({
    metadata: row.metadata_json,
    fallbackAdAccountId: input.plan.setup.metaAdAccountId || row.external_account_id,
  });
  const reservationKey = metaFreeLiveReservationKey(input.plan.planId);
  const reserveMutationKey = `${reservationKey}:reserve:${input.plan.updatedAt}`;
  const reservation = await reserveMetaFreeLiveClaim({
    service: input.serviceSupabase,
    workspaceId: input.plan.workspaceId,
    planId: input.plan.planId,
    identity,
    reservationKey,
    mutationKey: reserveMutationKey,
  });
  if (!reservation.allowed) {
    throw new Error(
      reservation.reason === "already_claimed"
        ? "This Meta Business Portfolio and ad account have already used their free live-campaign setup."
        : "The free live-campaign setup is currently reserved by another publish.",
    );
  }

  return { identity, billing, reservationKey, reserveMutationKey };
}

async function finalizeFreeLiveConversion(
  input: {
    serviceSupabase: SupabaseServiceClient;
    plan: MetaPublishPlan;
    billingGateway?: FirstLiveCampaignStripeGateway;
  },
  completedPlan: MetaPublishPlan,
  freeLive: PreparedFreeLiveConversion | null,
) {
  if (!freeLive) return;
  if (completedPlan.status !== "paused_live" || !completedPlan.reconciledObjects.campaignId) {
    throw new Error("Meta publish did not reconcile a campaign, so the free live claim was not consumed.");
  }

  const consumption = await consumeMetaFreeLiveClaim({
    service: input.serviceSupabase,
    workspaceId: completedPlan.workspaceId,
    planId: completedPlan.planId,
    identity: freeLive.identity,
    reservationKey: freeLive.reservationKey,
    mutationKey: `${freeLive.reservationKey}:consume`,
  });
  if (!consumption.allowed) {
    throw new Error("Meta published successfully, but the free live-campaign claim could not be consumed.");
  }

  await endTrialAfterFirstLiveCampaign({
    service: input.serviceSupabase,
    workspaceId: completedPlan.workspaceId,
    subscriptionId: freeLive.billing.subscriptionId,
    idempotencyKey: `${consumption.claimId}:${completedPlan.planId}`,
    gateway: input.billingGateway,
  });
  await recordWorkspaceFunnelEventBestEffort(input.serviceSupabase, {
    eventName: "free_campaign_launched",
    workspaceId: completedPlan.workspaceId,
    idempotencyKey: `meta:${completedPlan.workspaceId}:free-campaign:${consumption.claimId}`,
    properties: {
      plan_id: completedPlan.planId,
      claim_id: consumption.claimId,
    },
  });
}

async function workspaceNeedsFreeLiveConversion(
  serviceSupabase: SupabaseServiceClient,
  workspaceId: string,
): Promise<boolean> {
  const { data, error } = await serviceSupabase
    .from("workspaces")
    .select("billing_offer_key,stripe_subscription_status")
    .eq("id", workspaceId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Workspace billing state could not be loaded.");
  const row = data as { billing_offer_key: string | null; stripe_subscription_status: string | null };
  return Boolean(row.billing_offer_key?.startsWith("self_serve_") && row.stripe_subscription_status === "trialing");
}

/**
 * Downloads each storage-sourced creative image from workspace-artifacts and
 * attaches it as inline bytes so the Marketing API adapter can upload it to
 * `/adimages`. Missing images fail the publish with an honest error instead of
 * letting Meta reject an imageless lead-ad creative later.
 */
async function resolveStorageCreativeAssets(
  serviceSupabase: SupabaseServiceClient,
  plan: MetaPublishPlan,
): Promise<MetaPublishPlan> {
  const creatives = await Promise.all(plan.creatives.map(async (creative) => {
    const asset = creative.asset;
    if (!asset || asset.source !== "storage" || !asset.storagePath || asset.bytesBase64 || asset.imageHash) {
      return creative;
    }

    const storagePath = asset.storagePath;
    if (!storagePath.startsWith(`${plan.workspaceId}/`) || storagePath.includes("..")) {
      throw new Error(`The finished ad image for ${creative.name} is outside this workspace.`);
    }

    const { data, error } = await serviceSupabase.storage.from("workspace-artifacts").download(storagePath);
    if (error || !data) {
      throw new Error(`The finished ad image for ${creative.name} could not be loaded. Regenerate the ad and try again.`);
    }

    const bytes = Buffer.from(await data.arrayBuffer());

    return {
      ...creative,
      asset: {
        ...asset,
        source: "inline" as const,
        bytesBase64: bytes.toString("base64"),
      },
    };
  }));

  return { ...plan, creatives };
}

async function persistPublishAudit(serviceSupabase: SupabaseServiceClient, plan: MetaPublishPlan) {
  await recordAuditLog(serviceSupabase, {
    workspaceId: plan.workspaceId,
    actorProfileId: null,
    action: `meta_publish_${plan.status}`,
    targetType: "meta_publish_plan",
    targetId: plan.planId,
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
