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
import { loadMutation, updateMutation } from "./meta-mutation-worker.ts";
import {
  buildMetaPlanMutation,
  executeMetaPlanMutation,
} from "./meta-mutations.ts";
import { DEFAULT_META_GRAPH_VERSION } from "./meta-graph-version.ts";
import { loadStoredProviderTokens } from "./provider-connections.ts";
import { deterministicUuid } from "../adstudio/id.ts";
import {
  endTrialAfterFirstLiveCampaign,
  validateFirstLiveCampaignBilling,
  type FirstLiveCampaignBillingEligibility,
  type FirstLiveCampaignStripeGateway,
} from "../billing/first-live-campaign.ts";
import { BILLING_OFFER_VERSION } from "../billing/offers.ts";
import { recordWorkspaceFunnelEventBestEffort } from "../analytics/progressive-funnel.ts";
import { queueReportingRefresh } from "../meta-monitor/reporting-refresh-queue.ts";
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

  let freeLive: PreparedFreeLiveConversion | null;
  try {
    freeLive = await prepareFreeLiveConversion(input);
  } catch (error) {
    // Pre-flight failures (billing lookup, claim identity, claim reservation)
    // used to escape without touching the plan: it sat in "approved" with no
    // last_error anywhere while the worker crash-looped invisibly. Record the
    // failure on first execution so the UI and operators see the real reason,
    // then rethrow for the queue's retry accounting. Plans that already
    // published (publishing/paused_live) are never rewritten to failed here.
    if (input.plan.status === "approved") {
      const failedPlan: MetaPublishPlan = {
        ...input.plan,
        status: "failed",
        lastError: error instanceof Error ? error.message : "Meta publish pre-flight failed.",
        updatedAt: new Date().toISOString(),
      };
      await updateMetaPublishPlanExecution(input.serviceSupabase, failedPlan);
      await persistPublishAudit(input.serviceSupabase, failedPlan);
    }
    throw error;
  }
  if (input.plan.status === "paused_live") {
    await finalizeFreeLiveConversion(input, input.plan, freeLive);
    await queueReportingRefreshAfterProviderChange(input.plan.workspaceId, "publish");
    return input.plan;
  }

  const scheduledPlan =
    freeLive?.kind === "free_campaign"
      ? applyThreeDayFreeCampaignSchedule(input.plan)
      : input.plan;
  const publishingPlan: MetaPublishPlan = {
    ...scheduledPlan,
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
  await queueReportingRefreshAfterProviderChange(completedPlan.workspaceId, "publish");
  return completedPlan;
}

async function queueReportingRefreshAfterProviderChange(
  workspaceId: string,
  reason: "publish" | "mutation",
): Promise<void> {
  await queueReportingRefresh({
    workspaceId,
    range: "last_30",
    reason,
  }).catch((error) => {
    console.warn("[meta-reporting] background refresh could not be queued", error);
  });
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
  kind: "free_campaign" | "legacy_trial";
  identity: MetaFreeLiveClaimIdentity;
  billing: FirstLiveCampaignBillingEligibility | null;
  reservationKey: string;
  reserveMutationKey: string;
};

async function prepareFreeLiveConversion(input: {
  serviceSupabase: SupabaseServiceClient;
  plan: MetaPublishPlan;
  billingGateway?: FirstLiveCampaignStripeGateway;
}): Promise<PreparedFreeLiveConversion | null> {
  const kind = await freeLiveMode(input.serviceSupabase, input.plan.workspaceId);
  if (!kind) {
    return null;
  }

  const { data: connection, error } = await input.serviceSupabase
    .from("provider_connections")
    .select("metadata_json,external_account_id")
    .eq("workspace_id", input.plan.workspaceId)
    .eq("id", input.plan.providerConnectionId)
    .eq("provider", "meta")
    .single();
  const billing =
    kind === "legacy_trial"
      ? await validateFirstLiveCampaignBilling({
      service: input.serviceSupabase,
      workspaceId: input.plan.workspaceId,
      gateway: input.billingGateway,
      allowActive: input.plan.status === "paused_live",
        })
      : null;
  if (error || !connection) {
    throw new Error(error?.message ?? "The Meta connection for this publish plan was not found.");
  }

  const row = connection as {
    metadata_json: Record<string, unknown> | null;
    external_account_id: string | null;
  };
  let identity: MetaFreeLiveClaimIdentity;
  try {
    identity = resolveMetaFreeLiveClaimIdentity({
      metadata: row.metadata_json,
      fallbackAdAccountId: input.plan.setup.metaAdAccountId || row.external_account_id,
    });
  } catch (identityError) {
    identity = await backfillMetaFreeLiveClaimIdentity(input, row, identityError);
  }
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
        ? "This Meta Business Portfolio and ad account have already used their free three-day campaign."
        : "The free three-day campaign is currently reserved by another publish.",
    );
  }

  return { kind, identity, billing, reservationKey, reserveMutationKey };
}

/**
 * The Business Portfolio id is captured at OAuth time (fetchMetaAdAccounts
 * requests business{id,name}), but connections created before that capture
 * existed — or whose metadata.meta was rewritten by a Settings save, which
 * used to replace the whole object — are missing it. That dead-ended every
 * free-campaign publish with a "reconnect Meta" error that reconnecting could
 * not actually fix. Resolve the id from the Graph API with the stored token,
 * persist it back onto the connection so every later read has it, and let the
 * publish continue. If Graph reports no Business Portfolio for the ad account,
 * the original error is rethrown — the claim registry requires the real id.
 */
async function backfillMetaFreeLiveClaimIdentity(
  input: {
    serviceSupabase: SupabaseServiceClient;
    plan: MetaPublishPlan;
    fetchImpl?: typeof fetch;
  },
  row: {
    metadata_json: Record<string, unknown> | null;
    external_account_id: string | null;
  },
  originalError: unknown,
): Promise<MetaFreeLiveClaimIdentity> {
  const rawAccountId = (input.plan.setup.metaAdAccountId || row.external_account_id || "").trim();
  const adAccountId = rawAccountId && !rawAccountId.startsWith("act_") ? `act_${rawAccountId}` : rawAccountId;
  if (!adAccountId) {
    throw originalError;
  }

  const tokens = await loadStoredProviderTokens(input.serviceSupabase, input.plan.providerConnectionId);
  if (!tokens.accessToken) {
    throw originalError;
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const url = new URL(`https://graph.facebook.com/${DEFAULT_META_GRAPH_VERSION}/${adAccountId}`);
  url.searchParams.set("fields", "business{id,name}");
  url.searchParams.set("access_token", tokens.accessToken);
  const response = await fetchImpl(url.toString(), { method: "GET" });
  const payload = (await response.json().catch(() => ({}))) as {
    business?: { id?: string; name?: string | null } | null;
  };
  const businessId = response.ok ? payload.business?.id?.trim() ?? "" : "";
  if (!businessId) {
    throw originalError;
  }

  const previousMeta =
    row.metadata_json?.meta && typeof row.metadata_json.meta === "object" && !Array.isArray(row.metadata_json.meta)
      ? (row.metadata_json.meta as Record<string, unknown>)
      : {};
  const patchedMeta = {
    ...previousMeta,
    metaBusinessId: businessId,
    ...(payload.business?.name ? { metaBusinessName: payload.business.name } : {}),
  };
  await input.serviceSupabase
    .from("provider_connections")
    .update({
      metadata_json: { ...(row.metadata_json ?? {}), meta: patchedMeta },
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.plan.providerConnectionId)
    .eq("workspace_id", input.plan.workspaceId)
    .eq("provider", "meta");

  return resolveMetaFreeLiveClaimIdentity({
    metadata: { meta: patchedMeta },
    fallbackAdAccountId: adAccountId,
  });
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
    throw new Error("Meta published successfully, but the free three-day campaign claim could not be consumed.");
  }

  if (freeLive.billing) {
    await endTrialAfterFirstLiveCampaign({
      service: input.serviceSupabase,
      workspaceId: completedPlan.workspaceId,
      subscriptionId: freeLive.billing.subscriptionId,
      idempotencyKey: `${consumption.claimId}:${completedPlan.planId}`,
      gateway: input.billingGateway,
    });
  }
  if (freeLive.kind === "free_campaign") {
    await activateFreeCampaign(input, completedPlan);
  }
  await recordWorkspaceFunnelEventBestEffort(input.serviceSupabase, {
    eventName: "free_campaign_launched",
    workspaceId: completedPlan.workspaceId,
    idempotencyKey: `meta:${completedPlan.workspaceId}:free-campaign:${consumption.claimId}`,
    properties: {
      plan_id: completedPlan.planId,
      claim_id: consumption.claimId,
      free_campaign_days: freeLive.kind === "free_campaign" ? 3 : null,
    },
  });
}

async function activateFreeCampaign(
  input: {
    serviceSupabase: SupabaseServiceClient;
    fetchImpl?: typeof fetch;
  },
  plan: MetaPublishPlan,
) {
  const mutationId = deterministicUuid(`${plan.planId}:free-campaign-activate`);
  const built = buildMetaPlanMutation({
    workspaceId: plan.workspaceId,
    planId: plan.planId,
    action: "activate",
    payload: {
      campaignId: plan.reconciledObjects.campaignId,
      adSetIds: Object.values(plan.reconciledObjects.adSetIds),
      adIds: Object.values(plan.reconciledObjects.adIds),
    },
    mutationId,
  });
  const { error: createError } = await input.serviceSupabase
    .from("meta_publish_plan_mutations")
    .upsert(
      {
        id: mutationId,
        workspace_id: plan.workspaceId,
        meta_publish_plan_id: plan.planId,
        action: "activate",
        status: "approved",
        payload_json: built.payload,
        approval_request_id: plan.approvalRequestId,
        requested_by: null,
        request_log_json: [],
        response_log_json: [],
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (createError) {
    throw new Error(`The free campaign activation could not be prepared: ${createError.message}`);
  }

  const mutation = await loadMutation(
    input.serviceSupabase,
    plan.workspaceId,
    mutationId,
  );
  if (mutation.status === "applied") return;

  const tokens = await loadStoredProviderTokens(
    input.serviceSupabase,
    plan.providerConnectionId,
  );
  if (!tokens.accessToken) {
    throw new Error("Meta access token is missing for the free campaign activation.");
  }
  const result = await executeMetaPlanMutation({
    mutation,
    approvalStatus: "approved",
    accessToken: tokens.accessToken,
    fetchImpl: input.fetchImpl,
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

  if (updated.status !== "applied") {
    throw new Error(updated.lastError ?? "Meta could not activate the free three-day campaign.");
  }
}

async function freeLiveMode(
  serviceSupabase: SupabaseServiceClient,
  workspaceId: string,
): Promise<PreparedFreeLiveConversion["kind"] | null> {
  const { data, error } = await serviceSupabase
    .from("workspaces")
    .select("billing_access_state,billing_offer_key,billing_offer_version,stripe_subscription_status")
    .eq("id", workspaceId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Workspace billing state could not be loaded.");
  const row = data as {
    billing_access_state: string | null;
    billing_offer_key: string | null;
    billing_offer_version: string | null;
    stripe_subscription_status: string | null;
  };

  if (row.billing_access_state === "unbilled") {
    return "free_campaign";
  }
  if (
    row.billing_offer_key?.startsWith("self_serve_") &&
    row.stripe_subscription_status === "trialing" &&
    row.billing_offer_version !== BILLING_OFFER_VERSION
  ) {
    return "legacy_trial";
  }
  return null;
}

const FREE_CAMPAIGN_DURATION_MS = 3 * 24 * 60 * 60 * 1000;

export function applyThreeDayFreeCampaignSchedule(
  plan: MetaPublishPlan,
  now = new Date(),
): MetaPublishPlan {
  const requestedStart = plan.controls.schedule?.startTime ?? plan.adSets[0]?.startTime ?? null;
  const parsedStart = requestedStart ? Date.parse(requestedStart) : Number.NaN;
  const startTime = Number.isFinite(parsedStart) ? requestedStart! : now.toISOString();
  const endTime = new Date(
    (Number.isFinite(parsedStart) ? parsedStart : now.getTime()) + FREE_CAMPAIGN_DURATION_MS,
  ).toISOString();

  return {
    ...plan,
    controls: {
      ...plan.controls,
      schedule: { startTime, endTime },
    },
    adSets: plan.adSets.map((adSet) => ({
      ...adSet,
      startTime,
      endTime,
    })),
  };
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
