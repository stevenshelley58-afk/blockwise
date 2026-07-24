import { createHash } from "node:crypto";

import type { AdStudioCampaignPack } from "../adstudio/index.ts";
import { deterministicUuid } from "../adstudio/id.ts";
import { evaluatePublishReadiness, type ApprovalStatus, type ProviderConnectionStatus } from "../publishing/readiness.ts";
import type { ComplianceStatus } from "../compliance/real-estate-policy.ts";
import type { createSupabaseServiceClient } from "../supabase/service.ts";
import { DEFAULT_META_GRAPH_VERSION } from "./meta-graph-version.ts";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type MetaExecutionAdapter = "marketing_api" | "ads_cli" | "ads_mcp";
export type MetaPublishPlanStatus = "draft" | "approved" | "publishing" | "paused_live" | "failed";

export type MetaLeadDestination = {
  type: "webhook" | "crm" | "manual";
  label: string;
  config?: {
    endpoint?: string;
    [key: string]: unknown;
  };
};

export type MetaConnectionSetup = {
  metaAdAccountId: string;
  pageId: string;
  instagramActorId?: string | null;
  pixelId?: string | null;
  leadDestination: MetaLeadDestination;
  privacyPolicyUrl: string;
  currency: string;
  timezone: string;
};

export type MetaPublishControls = {
  dailyBudgetMinorUnits?: number;
  /** Destination URL for the lead form thank-you button (falls back to privacy policy). */
  destinationUrl?: string;
  geo?:
    | { type: "country"; country: string }
    | { type: "custom_radius"; latitude: number; longitude: number; radiusKm: number }
    | {
        type: "cities";
        locations: Array<{ key: string; name: string; region: string | null }>;
        includeSurroundingSuburbs: boolean;
      };
  schedule?: {
    startTime?: string | null;
    endTime?: string | null;
  };
  placements?: {
    publisherPlatforms?: string[];
    facebookPositions?: string[];
    instagramPositions?: string[];
  };
};

export type MetaPublishCampaignPlan = {
  localId: string;
  name: string;
  objective: "OUTCOME_LEADS";
  status: "PAUSED";
  specialAdCategories: ["HOUSING"];
};

export type MetaPublishAdSetPlan = {
  localId: string;
  name: string;
  campaignLocalId: string;
  billingEvent: "IMPRESSIONS";
  optimizationGoal: "LEAD_GENERATION";
  status: "PAUSED";
  dailyBudgetMinorUnits: number;
  targeting: Record<string, unknown>;
  startTime?: string | null;
  endTime?: string | null;
};

export type MetaCreativeAssetPlan = {
  type: "image" | "video";
  source: "inline" | "url" | "meta";
  mimeType?: string;
  filename?: string;
  bytesBase64?: string;
  url?: string;
  imageHash?: string;
  videoId?: string;
};

export type MetaPublishLeadFormPlan = {
  localId: string;
  name: string;
  headline: string;
  questions: string[];
  privacyPolicyUrl: string;
  thankYouTitle: string;
  thankYouBody: string;
  thankYouWebsiteUrl: string;
};

export type MetaPublishCreativePlan = {
  localId: string;
  name: string;
  pageId: string;
  instagramActorId: string | null;
  headline: string;
  primaryText: string;
  description: string;
  cta: string;
  leadFormLocalId: string;
  adStudioCreativeId: string | null;
  format: string | null;
  asset?: MetaCreativeAssetPlan | null;
};

export type MetaAdVariantTag = {
  variantId: string;
  angle: string;
  template: string | null;
};

export type MetaPublishAdPlan = {
  localId: string;
  name: string;
  adSetLocalId: string;
  creativeLocalId: string;
  status: "PAUSED";
  /** Ad Studio variant mapping; also encoded into the ad name (additive, see buildAdVariantTagSuffix). */
  variantTag?: MetaAdVariantTag | null;
};

export type MetaPublishTrackingPlan = {
  utmSource: "meta";
  utmMedium: "paid_social";
  utmCampaign: string;
  utmContentPrefix: string;
};

export type MetaReconciledObjectStatus = {
  id: string;
  effectiveStatus: string | null;
  configuredStatus: string | null;
};

export type MetaReconciledObjects = {
  campaignId?: string;
  leadFormIds: Record<string, string>;
  adSetIds: Record<string, string>;
  creativeIds: Record<string, string>;
  adIds: Record<string, string>;
  objectStatuses?: {
    campaign?: MetaReconciledObjectStatus;
    adSets?: Record<string, MetaReconciledObjectStatus>;
    ads?: Record<string, MetaReconciledObjectStatus>;
  };
};

export type MetaProviderLogEntry = {
  step: string;
  method: "POST" | "GET";
  path: string;
  body?: Record<string, unknown>;
  response?: Record<string, unknown>;
  status?: number;
  createdAt: string;
};

export type MetaPublishPlan = {
  planId: string;
  workspaceId: string;
  adStudioCampaignId: string;
  adStudioExportId: string | null;
  legacyCampaignId: string | null;
  providerConnectionId: string;
  approvalRequestId: string | null;
  adapter: MetaExecutionAdapter;
  status: MetaPublishPlanStatus;
  idempotencyKey: string;
  setup: MetaConnectionSetup;
  controls: MetaPublishControls;
  campaign: MetaPublishCampaignPlan;
  adSets: MetaPublishAdSetPlan[];
  leadForms: MetaPublishLeadFormPlan[];
  creatives: MetaPublishCreativePlan[];
  ads: MetaPublishAdPlan[];
  tracking: MetaPublishTrackingPlan;
  requestLog: MetaProviderLogEntry[];
  responseLog: MetaProviderLogEntry[];
  reconciledObjects: MetaReconciledObjects;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MetaPublishExecutionResult = Pick<
  MetaPublishPlan,
  "status" | "requestLog" | "responseLog" | "reconciledObjects" | "lastError" | "updatedAt"
>;

export type MetaExecutionAdapterImplementation = {
  adapter: MetaExecutionAdapter;
  publish: (
    plan: MetaPublishPlan,
    input: { accessToken: string; graphVersion?: string; fetchImpl?: typeof fetch },
  ) => Promise<MetaPublishExecutionResult>;
  diagnostics: (plan: MetaPublishPlan) => Promise<Record<string, unknown>>;
};

export function buildMetaPlanIdempotencyKey(input: {
  workspaceId: string;
  adStudioCampaignId: string;
  adapter: MetaExecutionAdapter;
  approvalRequestId?: string | null;
  existingMetaCampaignId?: string | null;
}) {
  return [
    "meta_publish",
    input.workspaceId,
    input.adStudioCampaignId,
    input.adapter,
    input.approvalRequestId ?? "draft",
    input.existingMetaCampaignId ? `campaign_${input.existingMetaCampaignId}` : "campaign_new",
  ].join(":");
}

export function buildMetaPublishPlan(input: {
  workspaceId: string;
  campaignPack: AdStudioCampaignPack;
  connectionId: string;
  setup: MetaConnectionSetup;
  controls?: MetaPublishControls;
  adapter?: MetaExecutionAdapter;
  approvalRequestId?: string | null;
  legacyCampaignId?: string | null;
  adStudioExportId?: string | null;
  includeCreativeAssets?: boolean;
  existingMetaCampaignId?: string | null;
  /**
   * A/B publish (A6): when set, only these variants are planned — one campaign,
   * one ad set, one tagged ad per variant. Absent/empty keeps the existing
   * full-pack behaviour unchanged.
   */
  variantIds?: string[];
}): MetaPublishPlan {
  const adapter = input.adapter ?? "marketing_api";
  const now = new Date().toISOString();
  const selectedVariantIds = (input.variantIds ?? []).filter((id) => typeof id === "string" && id.trim().length > 0);
  const abTest = selectedVariantIds.length > 0;
  const campaignPack = abTest ? filterPackToVariants(input.campaignPack, selectedVariantIds) : input.campaignPack;
  const controls = normalizeMetaPublishControls(input.controls, campaignPack);
  const idempotencyKey = buildMetaPlanIdempotencyKey({
    workspaceId: input.workspaceId,
    adStudioCampaignId: campaignPack.campaign.campaignId,
    adapter,
    approvalRequestId: input.approvalRequestId,
    existingMetaCampaignId: input.existingMetaCampaignId,
  });
  const campaign: MetaPublishCampaignPlan = {
    localId: "campaign_main",
    name: campaignPack.campaign.name,
    objective: "OUTCOME_LEADS",
    status: "PAUSED",
    specialAdCategories: ["HOUSING"],
  };

  return {
    planId: deterministicUuid(`meta_publish_plan:${idempotencyKey}`),
    workspaceId: input.workspaceId,
    adStudioCampaignId: campaignPack.campaign.campaignId,
    adStudioExportId: input.adStudioExportId ?? null,
    legacyCampaignId: input.legacyCampaignId ?? null,
    providerConnectionId: input.connectionId,
    approvalRequestId: input.approvalRequestId ?? null,
    adapter,
    status: "draft",
    idempotencyKey,
    setup: normalizeMetaConnectionSetup(input.setup),
    controls,
    campaign,
    adSets: buildAdSetPlans(campaignPack, controls, abTest),
    leadForms: buildLeadFormPlans(campaignPack, input.setup, controls.destinationUrl),
    creatives: buildCreativePlans(campaignPack, input.setup, Boolean(input.includeCreativeAssets)),
    ads: buildAdPlans(campaignPack, abTest),
    tracking: {
      utmSource: "meta",
      utmMedium: "paid_social",
      utmCampaign: slug(campaignPack.campaign.name),
      utmContentPrefix: slug(campaignPack.campaign.market.suburb),
    },
    requestLog: [],
    responseLog: [],
    reconciledObjects: {
      ...emptyReconciledObjects(),
      ...(input.existingMetaCampaignId?.trim() ? { campaignId: input.existingMetaCampaignId.trim() } : {}),
    },
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Narrows a campaign pack to the selected variants (A6 A/B publish). Unknown
 * ids simply produce an empty selection, which readiness validation then
 * blocks (no draft payload) instead of silently publishing everything.
 */
function filterPackToVariants(pack: AdStudioCampaignPack, variantIds: string[]): AdStudioCampaignPack {
  const selected = new Set(variantIds);

  return {
    ...pack,
    variants: pack.variants.filter((variant) => selected.has(variant.variantId)),
    creatives: pack.creatives.filter((creative) => selected.has(creative.variantId)),
    copyPacks: pack.copyPacks.filter((copyPack) => selected.has(copyPack.variantId)),
  };
}

export function validateMetaConnectionSetup(setup: MetaConnectionSetup): string[] {
  const blockers: string[] = [];

  if (!setup.metaAdAccountId.trim()) blockers.push("Meta ad account is not configured.");
  if (!setup.pageId.trim()) blockers.push("Meta Page is not configured.");
  if (!setup.leadDestination.type || !setup.leadDestination.label.trim()) blockers.push("Meta lead destination is not configured.");
  if (setup.leadDestination.type !== "manual" && !setup.leadDestination.config?.endpoint?.trim()) {
    blockers.push("Meta lead destination endpoint is not configured.");
  }
  if (!setup.privacyPolicyUrl.trim()) blockers.push("Meta lead form privacy policy URL is not configured.");
  if (!setup.currency.trim()) blockers.push("Meta account currency is not configured.");
  if (!setup.timezone.trim()) blockers.push("Meta account timezone is not configured.");

  return blockers;
}

export function validateMetaPublishPlanReadiness(
  plan: MetaPublishPlan,
  input: {
    approvalStatus: ApprovalStatus;
    providerConnectionStatus: ProviderConnectionStatus;
    complianceStatus: ComplianceStatus;
  },
) {
  const readiness = evaluatePublishReadiness({
    providerConnectionStatus: input.providerConnectionStatus,
    approvalStatus: input.approvalStatus,
    complianceStatus: input.complianceStatus,
    hasDraftPayload: plan.ads.length > 0 && plan.creatives.length > 0 && plan.leadForms.length > 0,
  });
  const blockers = [...readiness.blockers, ...validateMetaConnectionSetup(plan.setup)];

  if (input.approvalStatus === "approved" && !plan.approvalRequestId) {
    blockers.push("Meta publish plan is not linked to an approval request.");
  }

  return {
    ready: blockers.length === 0,
    blockers,
  };
}

export function createMetaExecutionAdapter(adapter: MetaExecutionAdapter): MetaExecutionAdapterImplementation {
  if (adapter === "marketing_api") {
    return {
      adapter,
      publish: publishWithMarketingApi,
      diagnostics: async (plan) => ({
        adapter,
        status: "ready",
        plannedObjects: {
          adSets: plan.adSets.length,
          leadForms: plan.leadForms.length,
          creatives: plan.creatives.length,
          ads: plan.ads.length,
        },
      }),
    };
  }

  return {
    adapter,
    publish: async () => {
      throw new Error(`${adapter} is available for read-only diagnostics only and cannot publish yet.`);
    },
    diagnostics: async (plan) => ({
      adapter,
      status: "read_only",
      plannedObjects: {
        adSets: plan.adSets.length,
        leadForms: plan.leadForms.length,
        creatives: plan.creatives.length,
        ads: plan.ads.length,
      },
    }),
  };
}

export function applyMetaPublishExecutionResult(
  plan: MetaPublishPlan,
  result: MetaPublishExecutionResult,
): MetaPublishPlan {
  return {
    ...plan,
    ...result,
  };
}

export function buildMetaPublishTaskOptions(input: { workspaceId: string; planId: string; idempotencyKey: string }) {
  return {
    idempotencyKey: input.idempotencyKey,
    concurrencyKey: `meta-publish:${input.workspaceId}:${input.idempotencyKey}`,
    tags: ["meta-publish", input.workspaceId, input.planId],
    maxAttempts: 3,
  };
}

export async function persistMetaPublishPlan(serviceSupabase: SupabaseServiceClient, plan: MetaPublishPlan, userId: string) {
  const { data, error } = await serviceSupabase
    .from("meta_publish_plans")
    .upsert(
      planToRow(plan, userId),
      { onConflict: "workspace_id,idempotency_key" },
    )
    .select("id,status,idempotency_key")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to persist Meta publish plan.");
  }

  return data as { id: string; status: MetaPublishPlanStatus; idempotency_key: string };
}

export async function loadMetaPublishPlan(
  serviceSupabase: SupabaseServiceClient,
  input: { workspaceId: string; planId: string },
): Promise<MetaPublishPlan> {
  const { data, error } = await serviceSupabase
    .from("meta_publish_plans")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.planId)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Meta publish plan was not found.");
  }

  return rowToPlan(data as MetaPublishPlanRow);
}

export async function loadMetaPublishPlanByIdempotencyKey(
  serviceSupabase: SupabaseServiceClient,
  input: { workspaceId: string; idempotencyKey: string },
): Promise<MetaPublishPlan | null> {
  const { data, error } = await serviceSupabase
    .from("meta_publish_plans")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? rowToPlan(data as MetaPublishPlanRow) : null;
}

export async function updateMetaPublishPlanExecution(serviceSupabase: SupabaseServiceClient, plan: MetaPublishPlan) {
  const { error } = await serviceSupabase
    .from("meta_publish_plans")
    .update({
      status: plan.status,
      plan_json: planToJson(plan),
      request_log_json: plan.requestLog,
      response_log_json: plan.responseLog,
      reconciled_objects_json: plan.reconciledObjects,
      last_error: plan.lastError,
      updated_at: plan.updatedAt,
    })
    .eq("workspace_id", plan.workspaceId)
    .eq("id", plan.planId);

  if (error) {
    throw new Error(error.message);
  }
}

export function resolveMetaConnectionSetup(
  metadata: Record<string, unknown>,
  fallbackAccountId: string | null | undefined,
): MetaConnectionSetup {
  const meta = metadata.meta && typeof metadata.meta === "object" ? (metadata.meta as Record<string, unknown>) : metadata;
  const leadDestination =
    meta.leadDestination && typeof meta.leadDestination === "object"
      ? (meta.leadDestination as MetaLeadDestination)
      : ({ type: "manual", label: String(meta.leadDestinationLabel ?? "Manual review"), config: { endpoint: "" } } as MetaLeadDestination);

  return normalizeMetaConnectionSetup({
    metaAdAccountId: String(meta.metaAdAccountId ?? fallbackAccountId ?? ""),
    pageId: String(meta.pageId ?? ""),
    instagramActorId: optionalString(meta.instagramActorId),
    pixelId: optionalString(meta.pixelId),
    leadDestination,
    privacyPolicyUrl: String(meta.privacyPolicyUrl ?? ""),
    currency: String(meta.currency ?? "AUD"),
    timezone: String(meta.timezone ?? "Australia/Perth"),
  });
}

async function publishWithMarketingApi(
  plan: MetaPublishPlan,
  input: { accessToken: string; graphVersion?: string; fetchImpl?: typeof fetch },
): Promise<MetaPublishExecutionResult> {
  if (plan.status !== "approved" && plan.status !== "publishing") {
    throw new Error("Meta publish plan must be approved before execution.");
  }

  const requestLog = [...plan.requestLog];
  const responseLog = [...plan.responseLog];
  const reconciledObjects: MetaReconciledObjects = {
    ...emptyReconciledObjects(),
    ...plan.reconciledObjects,
    leadFormIds: { ...plan.reconciledObjects.leadFormIds },
    adSetIds: { ...plan.reconciledObjects.adSetIds },
    creativeIds: { ...plan.reconciledObjects.creativeIds },
    adIds: { ...plan.reconciledObjects.adIds },
  };

  try {
    if (!reconciledObjects.campaignId) {
      const response = await postMetaObject(input, requestLog, responseLog, "campaign.create", `/${plan.setup.metaAdAccountId}/campaigns`, {
        name: plan.campaign.name,
        objective: plan.campaign.objective,
        status: "PAUSED",
        special_ad_categories: plan.campaign.specialAdCategories,
      });
      reconciledObjects.campaignId = requireMetaId(response, "campaign");
    }

    for (const leadForm of plan.leadForms) {
      if (reconciledObjects.leadFormIds[leadForm.localId]) continue;

      const response = await postMetaObject(input, requestLog, responseLog, `lead_form.${leadForm.localId}`, `/${plan.setup.pageId}/leadgen_forms`, {
        name: leadForm.name,
        follow_up_action_url: leadForm.thankYouWebsiteUrl,
        privacy_policy: {
          url: leadForm.privacyPolicyUrl,
          link_text: "Privacy Policy",
        },
        questions: [
          { type: "FULL_NAME", key: "full_name" },
          { type: "EMAIL", key: "email" },
          { type: "PHONE", key: "phone" },
          ...leadForm.questions.map((question, qi) => ({ type: "CUSTOM", key: `custom_${qi + 1}`, label: question })),
        ],
        thank_you_page: {
          title: leadForm.thankYouTitle,
          body: leadForm.thankYouBody,
          button_text: "Visit website",
          button_type: "VIEW_WEBSITE",
          website_url: leadForm.thankYouWebsiteUrl,
        },
      });
      reconciledObjects.leadFormIds[leadForm.localId] = requireMetaId(response, "lead form");
    }

    for (const adSet of plan.adSets) {
      if (reconciledObjects.adSetIds[adSet.localId]) continue;

      const response = await postMetaObject(input, requestLog, responseLog, `adset.${adSet.localId}`, `/${plan.setup.metaAdAccountId}/adsets`, {
        name: adSet.name,
        campaign_id: reconciledObjects.campaignId,
        billing_event: adSet.billingEvent,
        optimization_goal: adSet.optimizationGoal,
        daily_budget: String(adSet.dailyBudgetMinorUnits),
        targeting: adSet.targeting,
        status: "PAUSED",
        ...(adSet.startTime ? { start_time: adSet.startTime } : {}),
        ...(adSet.endTime ? { end_time: adSet.endTime } : {}),
      });
      reconciledObjects.adSetIds[adSet.localId] = requireMetaId(response, "ad set");
    }

    for (const creative of plan.creatives) {
      if (reconciledObjects.creativeIds[creative.localId]) continue;

      const imageHash = await resolveCreativeImageHash(plan, creative, input, requestLog, responseLog);
      const leadFormId = reconciledObjects.leadFormIds[creative.leadFormLocalId];
      const response = await postMetaObject(input, requestLog, responseLog, `creative.${creative.localId}`, `/${plan.setup.metaAdAccountId}/adcreatives`, {
        name: creative.name,
        object_story_spec: {
          page_id: creative.pageId,
          ...(creative.instagramActorId ? { instagram_actor_id: creative.instagramActorId } : {}),
          link_data: {
            message: creative.primaryText,
            name: creative.headline,
            description: creative.description,
            link: plan.setup.privacyPolicyUrl,
            ...(imageHash ? { image_hash: imageHash } : {}),
            call_to_action: {
              type: creative.cta,
              value: {
                lead_gen_form_id: leadFormId,
              },
            },
          },
        },
      });
      reconciledObjects.creativeIds[creative.localId] = requireMetaId(response, "creative");
    }

    for (const ad of plan.ads) {
      if (reconciledObjects.adIds[ad.localId]) continue;

      const response = await postMetaObject(input, requestLog, responseLog, `ad.${ad.localId}`, `/${plan.setup.metaAdAccountId}/ads`, {
        name: ad.name,
        adset_id: reconciledObjects.adSetIds[ad.adSetLocalId],
        creative: { creative_id: reconciledObjects.creativeIds[ad.creativeLocalId] },
        status: "PAUSED",
      });
      reconciledObjects.adIds[ad.localId] = requireMetaId(response, "ad");
    }

    reconciledObjects.objectStatuses = await reconcileMetaObjects(input, requestLog, responseLog, reconciledObjects);

    return {
      status: "paused_live",
      requestLog,
      responseLog,
      reconciledObjects,
      lastError: null,
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: "failed",
      requestLog,
      responseLog,
      reconciledObjects,
      lastError: error instanceof Error ? error.message : "Meta Marketing API publish failed.",
      updatedAt: new Date().toISOString(),
    };
  }
}

async function resolveCreativeImageHash(
  plan: MetaPublishPlan,
  creative: MetaPublishCreativePlan,
  input: { accessToken: string; graphVersion?: string; fetchImpl?: typeof fetch },
  requestLog: MetaProviderLogEntry[],
  responseLog: MetaProviderLogEntry[],
): Promise<string | null> {
  if (creative.asset?.imageHash) return creative.asset.imageHash;
  if (creative.asset?.type !== "image" || creative.asset.source !== "inline" || !creative.asset.bytesBase64) return null;

  const filename = creative.asset.filename ?? `${creative.localId}.png`;
  const response = await postMetaObject(input, requestLog, responseLog, `asset.${creative.localId}`, `/${plan.setup.metaAdAccountId}/adimages`, {
    filename,
    bytes: creative.asset.bytesBase64,
  });

  const imageMap = response.images as Record<string, { hash?: string }> | undefined;
  const fromMap = imageMap?.[filename]?.hash ?? Object.values(imageMap ?? {})[0]?.hash;

  return fromMap ?? (typeof response.hash === "string" ? response.hash : null);
}

async function reconcileMetaObjects(
  input: { accessToken: string; graphVersion?: string; fetchImpl?: typeof fetch },
  requestLog: MetaProviderLogEntry[],
  responseLog: MetaProviderLogEntry[],
  reconciledObjects: MetaReconciledObjects,
): Promise<NonNullable<MetaReconciledObjects["objectStatuses"]>> {
  const campaign = reconciledObjects.campaignId
    ? await getMetaObjectStatus(input, requestLog, responseLog, "reconcile.campaign", reconciledObjects.campaignId)
    : undefined;
  const adSets: Record<string, MetaReconciledObjectStatus> = {};
  const ads: Record<string, MetaReconciledObjectStatus> = {};

  for (const [localId, id] of Object.entries(reconciledObjects.adSetIds)) {
    adSets[localId] = await getMetaObjectStatus(input, requestLog, responseLog, `reconcile.adset.${localId}`, id);
  }

  for (const [localId, id] of Object.entries(reconciledObjects.adIds)) {
    ads[localId] = await getMetaObjectStatus(input, requestLog, responseLog, `reconcile.ad.${localId}`, id);
  }

  return { campaign, adSets, ads };
}

async function postMetaObject(
  input: { accessToken: string; graphVersion?: string; fetchImpl?: typeof fetch },
  requestLog: MetaProviderLogEntry[],
  responseLog: MetaProviderLogEntry[],
  step: string,
  path: string,
  body: Record<string, unknown>,
) {
  const createdAt = new Date().toISOString();
  requestLog.push({ step, method: "POST", path, body, createdAt });

  const response = await (input.fetchImpl ?? fetch)(`https://graph.facebook.com/${input.graphVersion ?? DEFAULT_META_GRAPH_VERSION}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  responseLog.push({ step, method: "POST", path, response: payload, status: response.status, createdAt: new Date().toISOString() });

  if (!response.ok) {
    const error = payload.error as { message?: string } | undefined;
    throw new Error(error?.message ?? `Meta request ${step} failed with ${response.status}.`);
  }

  return payload;
}

async function getMetaObjectStatus(
  input: { accessToken: string; graphVersion?: string; fetchImpl?: typeof fetch },
  requestLog: MetaProviderLogEntry[],
  responseLog: MetaProviderLogEntry[],
  step: string,
  objectId: string,
): Promise<MetaReconciledObjectStatus> {
  const path = `/${objectId}?fields=effective_status,configured_status,status`;
  const createdAt = new Date().toISOString();
  requestLog.push({ step, method: "GET", path, createdAt });

  const response = await (input.fetchImpl ?? fetch)(`https://graph.facebook.com/${input.graphVersion ?? DEFAULT_META_GRAPH_VERSION}${path}`, {
    method: "GET",
    headers: { authorization: `Bearer ${input.accessToken}` },
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  responseLog.push({ step, method: "GET", path, response: payload, status: response.status, createdAt: new Date().toISOString() });

  if (!response.ok) {
    const error = payload.error as { message?: string } | undefined;
    throw new Error(error?.message ?? `Meta reconciliation ${step} failed with ${response.status}.`);
  }

  return {
    id: typeof payload.id === "string" ? payload.id : objectId,
    effectiveStatus: optionalString(payload.effective_status ?? payload.status),
    configuredStatus: optionalString(payload.configured_status),
  };
}

function buildAdSetPlans(pack: AdStudioCampaignPack, controls: MetaPublishControls, singleAdSet = false): MetaPublishAdSetPlan[] {
  const suburb = pack.campaign.market.suburb;
  const dailyBudgetMinorUnits = controls.dailyBudgetMinorUnits ?? 5000;
  const targeting = buildTargeting(controls);
  const primary: MetaPublishAdSetPlan = {
    localId: "adset_primary",
    name: `${suburb} homeowners broad`,
    campaignLocalId: "campaign_main",
    billingEvent: "IMPRESSIONS",
    optimizationGoal: "LEAD_GENERATION",
    status: "PAUSED",
    dailyBudgetMinorUnits,
    targeting,
    startTime: controls.schedule?.startTime ?? null,
    endTime: controls.schedule?.endTime ?? null,
  };

  // A/B publish (A6): all variant ads compete inside one ad set.
  if (singleAdSet) {
    return [primary];
  }

  return [
    primary,
    {
      localId: "adset_learning",
      name: `${suburb} seller intent test`,
      campaignLocalId: "campaign_main",
      billingEvent: "IMPRESSIONS",
      optimizationGoal: "LEAD_GENERATION",
      status: "PAUSED",
      dailyBudgetMinorUnits,
      targeting,
      startTime: controls.schedule?.startTime ?? null,
      endTime: controls.schedule?.endTime ?? null,
    },
  ];
}

function buildTargeting(controls: MetaPublishControls): Record<string, unknown> {
  const geoLocations = controls.geo?.type === "cities" && controls.geo.locations.length > 0
    ? {
        cities: controls.geo.locations.map((location) => ({
          key: location.key,
          ...(controls.geo?.type === "cities" && controls.geo.includeSurroundingSuburbs
            ? { radius: 10, distance_unit: "kilometer" }
            : {}),
        })),
        location_types: ["home", "recent"],
      }
    : controls.geo?.type === "custom_radius"
      ? {
          custom_locations: [
            {
              latitude: controls.geo.latitude,
              longitude: controls.geo.longitude,
              radius: controls.geo.radiusKm,
              distance_unit: "kilometer",
            },
          ],
          location_types: ["home", "recent"],
        }
      : {
          countries: [controls.geo?.type === "country" ? controls.geo.country : "AU"],
          location_types: ["home", "recent"],
        };

  return {
    geo_locations: geoLocations,
    publisher_platforms: controls.placements?.publisherPlatforms ?? ["facebook", "instagram"],
    ...(controls.placements?.facebookPositions?.length ? { facebook_positions: controls.placements.facebookPositions } : {}),
    ...(controls.placements?.instagramPositions?.length ? { instagram_positions: controls.placements.instagramPositions } : {}),
  };
}

function buildLeadFormPlans(pack: AdStudioCampaignPack, setup: MetaConnectionSetup, destinationUrl?: string): MetaPublishLeadFormPlan[] {
  return pack.copyPacks.slice(0, 6).map((copy, index) => ({
    localId: `form_${index + 1}`,
    name: `${pack.campaign.market.suburb} ${copy.meta.leadForm.headline}`,
    headline: copy.meta.leadForm.headline,
    questions: copy.meta.leadForm.questions,
    privacyPolicyUrl: setup.privacyPolicyUrl,
    thankYouTitle: copy.meta.leadForm.thankYouScreen.title,
    thankYouBody: copy.meta.leadForm.thankYouScreen.body,
    thankYouWebsiteUrl: destinationUrl ?? setup.privacyPolicyUrl,
  }));
}

function buildCreativePlans(pack: AdStudioCampaignPack, setup: MetaConnectionSetup, includeAssets: boolean): MetaPublishCreativePlan[] {
  return pack.copyPacks.slice(0, 6).map((copy, index) => {
    const creative = pack.creatives.find((item) => item.variantId === copy.variantId) ?? pack.creatives[index] ?? null;

    return {
      localId: `creative_${index + 1}`,
      name: `${pack.campaign.name} ${index + 1}`,
      pageId: setup.pageId,
      instagramActorId: setup.instagramActorId ?? null,
      headline: copy.meta.headlines[0] ?? pack.campaign.name,
      primaryText: copy.meta.primaryText[0] ?? pack.campaign.name,
      description: copy.meta.descriptions[0] ?? pack.campaign.audienceIntent,
      cta: copy.meta.cta,
      leadFormLocalId: `form_${index + 1}`,
      adStudioCreativeId: creative?.creativeId ?? null,
      format: creative?.format ?? null,
      asset: includeAssets && creative?.previewSvg
        ? {
            type: "image",
            source: "inline",
            mimeType: "image/svg+xml",
            filename: `${creative.creativeId}.svg`,
            bytesBase64: Buffer.from(creative.previewSvg, "utf8").toString("base64"),
          }
        : null,
    };
  });
}

function buildAdPlans(pack: AdStudioCampaignPack, singleAdSet = false): MetaPublishAdPlan[] {
  return pack.copyPacks.slice(0, 6).map((copy, index) => {
    const variant = pack.variants.find((item) => item.variantId === copy.variantId) ?? null;
    const variantTag: MetaAdVariantTag | null = variant
      ? { variantId: variant.variantId, angle: variant.angle, template: pack.campaign.templateKey ?? pack.campaign.offerId ?? null }
      : null;

    return {
      localId: `ad_${index + 1}`,
      name: `${pack.campaign.name} ad ${index + 1}${variantTag ? buildAdVariantTagSuffix(variantTag) : ""}`,
      adSetLocalId: singleAdSet ? "adset_primary" : index % 2 === 0 ? "adset_primary" : "adset_learning",
      creativeLocalId: `creative_${index + 1}`,
      status: "PAUSED",
      variantTag,
    };
  });
}

/**
 * Structured ad-name suffix the Meta monitor parses back into
 * `{variantId, angle, template}` (see meta-monitor/calculations.ts
 * parseAdVariantTags). Name-only metadata: campaign/ad-set creation
 * semantics are unchanged.
 */
export function buildAdVariantTagSuffix(tag: MetaAdVariantTag): string {
  const parts = [`v=${tag.variantId.replace(/-/g, "").slice(0, 8)}`, `a=${slug(tag.angle)}`];

  if (tag.template) {
    parts.push(`t=${tagValue(tag.template)}`);
  }

  return ` | bw:${parts.join(";")}`;
}

function normalizeMetaPublishControls(controls: MetaPublishControls | undefined, pack: AdStudioCampaignPack): MetaPublishControls {
  return {
    dailyBudgetMinorUnits: controls?.dailyBudgetMinorUnits && controls.dailyBudgetMinorUnits > 0
      ? Math.round(controls.dailyBudgetMinorUnits)
      : 5000,
    geo: controls?.geo ?? { type: "country", country: pack.campaign.market.country },
    schedule: {
      startTime: controls?.schedule?.startTime ?? null,
      endTime: controls?.schedule?.endTime ?? null,
    },
    placements: {
      publisherPlatforms: controls?.placements?.publisherPlatforms?.length ? controls.placements.publisherPlatforms : ["facebook", "instagram"],
      facebookPositions: controls?.placements?.facebookPositions ?? [],
      instagramPositions: controls?.placements?.instagramPositions ?? [],
    },
  };
}

function normalizeMetaConnectionSetup(setup: MetaConnectionSetup): MetaConnectionSetup {
  return {
    ...setup,
    metaAdAccountId: normalizeMetaAccountId(setup.metaAdAccountId),
    pageId: setup.pageId.trim(),
    instagramActorId: optionalString(setup.instagramActorId),
    pixelId: optionalString(setup.pixelId),
    leadDestination: {
      ...setup.leadDestination,
      type: normalizeMetaLeadDestinationType(setup.leadDestination.type),
      label: setup.leadDestination.label.trim(),
      config: {
        ...(setup.leadDestination.config ?? {}),
        endpoint: setup.leadDestination.config?.endpoint?.trim() ?? "",
      },
    },
    privacyPolicyUrl: setup.privacyPolicyUrl.trim(),
    currency: setup.currency.trim().toUpperCase(),
    timezone: setup.timezone.trim(),
  };
}

function planToJson(plan: MetaPublishPlan) {
  return {
    campaign: plan.campaign,
    adSets: plan.adSets,
    leadForms: plan.leadForms,
    creatives: plan.creatives,
    ads: plan.ads,
    tracking: plan.tracking,
    controls: plan.controls,
  };
}

function planToRow(plan: MetaPublishPlan, userId: string) {
  return {
    id: plan.planId,
    workspace_id: plan.workspaceId,
    adstudio_campaign_id: plan.adStudioCampaignId,
    adstudio_export_id: plan.adStudioExportId,
    campaign_id: plan.legacyCampaignId,
    provider_connection_id: plan.providerConnectionId,
    approval_request_id: plan.approvalRequestId,
    adapter: plan.adapter,
    status: plan.status,
    idempotency_key: plan.idempotencyKey,
    meta_ad_account_id: plan.setup.metaAdAccountId,
    page_id: plan.setup.pageId,
    instagram_actor_id: plan.setup.instagramActorId,
    pixel_id: plan.setup.pixelId,
    lead_destination_json: plan.setup.leadDestination,
    privacy_policy_url: plan.setup.privacyPolicyUrl,
    currency: plan.setup.currency,
    timezone: plan.setup.timezone,
    plan_json: planToJson(plan),
    request_log_json: plan.requestLog,
    response_log_json: plan.responseLog,
    reconciled_objects_json: plan.reconciledObjects,
    last_error: plan.lastError,
    created_by: userId,
    updated_at: plan.updatedAt,
  };
}

type MetaPublishPlanRow = {
  id: string;
  workspace_id: string;
  adstudio_campaign_id: string;
  adstudio_export_id: string | null;
  campaign_id: string | null;
  provider_connection_id: string;
  approval_request_id: string | null;
  adapter: MetaExecutionAdapter;
  status: MetaPublishPlanStatus;
  idempotency_key: string;
  meta_ad_account_id: string;
  page_id: string;
  instagram_actor_id: string | null;
  pixel_id: string | null;
  lead_destination_json: MetaLeadDestination;
  privacy_policy_url: string;
  currency: string;
  timezone: string;
  plan_json: {
    campaign?: MetaPublishCampaignPlan;
    adSets?: MetaPublishAdSetPlan[];
    leadForms?: MetaPublishLeadFormPlan[];
    creatives?: MetaPublishCreativePlan[];
    ads?: MetaPublishAdPlan[];
    tracking?: MetaPublishTrackingPlan;
    controls?: MetaPublishControls;
  };
  request_log_json: MetaProviderLogEntry[] | null;
  response_log_json: MetaProviderLogEntry[] | null;
  reconciled_objects_json: MetaReconciledObjects | null;
  last_error: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function rowToPlan(row: MetaPublishPlanRow): MetaPublishPlan {
  const planJson = row.plan_json ?? {};

  return {
    planId: row.id,
    workspaceId: row.workspace_id,
    adStudioCampaignId: row.adstudio_campaign_id,
    adStudioExportId: row.adstudio_export_id,
    legacyCampaignId: row.campaign_id,
    providerConnectionId: row.provider_connection_id,
    approvalRequestId: row.approval_request_id,
    adapter: row.adapter,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    setup: normalizeMetaConnectionSetup({
      metaAdAccountId: row.meta_ad_account_id,
      pageId: row.page_id,
      instagramActorId: row.instagram_actor_id,
      pixelId: row.pixel_id,
      leadDestination: row.lead_destination_json,
      privacyPolicyUrl: row.privacy_policy_url,
      currency: row.currency,
      timezone: row.timezone,
    }),
    controls: planJson.controls ?? {},
    campaign: planJson.campaign ?? {
      localId: "campaign_main",
      name: "Meta campaign",
      objective: "OUTCOME_LEADS",
      status: "PAUSED",
      specialAdCategories: ["HOUSING"],
    },
    adSets: planJson.adSets ?? [],
    leadForms: planJson.leadForms ?? [],
    creatives: planJson.creatives ?? [],
    ads: planJson.ads ?? [],
    tracking: planJson.tracking ?? {
      utmSource: "meta",
      utmMedium: "paid_social",
      utmCampaign: "meta-campaign",
      utmContentPrefix: "meta",
    },
    requestLog: row.request_log_json ?? [],
    responseLog: row.response_log_json ?? [],
    reconciledObjects: row.reconciled_objects_json ?? emptyReconciledObjects(),
    lastError: row.last_error,
    createdAt: row.created_at ?? new Date(0).toISOString(),
    updatedAt: row.updated_at ?? row.created_at ?? new Date(0).toISOString(),
  };
}

function emptyReconciledObjects(): MetaReconciledObjects {
  return {
    leadFormIds: {},
    adSetIds: {},
    creativeIds: {},
    adIds: {},
  };
}

function requireMetaId(response: Record<string, unknown>, objectName: string): string {
  if (typeof response.id === "string" && response.id.trim()) {
    return response.id;
  }

  throw new Error(`Meta did not return an id for ${objectName}.`);
}

function normalizeMetaAccountId(value: string): string {
  const trimmed = value.trim();

  return trimmed && !trimmed.startsWith("act_") ? `act_${trimmed}` : trimmed;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeMetaLeadDestinationType(value: unknown): MetaLeadDestination["type"] {
  return value === "crm" || value === "manual" ? value : "webhook";
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || createHash("sha1").update(value).digest("hex").slice(0, 8);
}

function tagValue(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || createHash("sha1").update(value).digest("hex").slice(0, 8);
}
