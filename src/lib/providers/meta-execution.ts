import { createHash } from "node:crypto";

import type { AdStudioCampaignPack } from "../adstudio/index.ts";
import { deterministicUuid } from "../adstudio/id.ts";
import { evaluatePublishReadiness, type ApprovalStatus, type ProviderConnectionStatus } from "../publishing/readiness.ts";
import type { ComplianceStatus } from "../compliance/real-estate-policy.ts";
import type { createSupabaseServiceClient } from "../supabase/service.ts";
import { DEFAULT_META_GRAPH_VERSION } from "./meta-graph-version.ts";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

const META_PROVIDER_OBJECT_NAME_MAX_LENGTH = 255;
const META_AD_CREATIVE_NAME_MAX_LENGTH = 100;
const META_HOUSING_MIN_RADIUS_KM = 25;
const META_LOWEST_COST_BID_STRATEGY = "LOWEST_COST_WITHOUT_CAP";

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

export type MetaPublishTarget =
  | { mode: "new_campaign_new_adset" }
  | { mode: "existing_campaign_new_adset"; campaignId: string }
  | { mode: "existing_adset"; campaignId: string; adSetIds: string[] };

export type MetaExistingCampaignState = {
  id: string;
  objective: string;
  specialAdCategories: string[];
  specialAdCategoryCountries: string[];
  budgetMode: "campaign" | "adset";
};
export type MetaExistingAdSetState = {
  id: string;
  campaignId: string;
  targeting: Record<string, unknown>;
  optimizationGoal: string;
  billingEvent: string;
  dailyBudgetMinorUnits: number;
  destination: Record<string, unknown> | null;
  promotedObject: Record<string, unknown> | null;
};
export type MetaParentState = {
  campaign?: MetaExistingCampaignState;
  adSets?: MetaExistingAdSetState[];
};

export type MetaOfferFulfilment = {
  exactOffer: string;
  eligibility: string;
  conditions: string;
  timeframe: string;
  evidence: string;
  approval: string;
  disclaimer: string;
  privacyUrl: string;
  consent: string;
  fulfilmentAsset: string;
  fulfilmentUrl: string;
  owner: string;
  expiry: string;
  tracking: string;
};

export function validateMetaOfferFulfilment(value: MetaOfferFulfilment | null | undefined): string[] {
  if (!value) return ["Offer fulfilment details are required before publication."];
  const required: Array<keyof MetaOfferFulfilment> = [
    "exactOffer", "eligibility", "conditions", "timeframe", "evidence", "approval",
    "disclaimer", "privacyUrl", "consent", "owner", "expiry", "tracking",
  ];
  const issues = required.filter((key) => !value[key]?.trim()).map((key) => "Missing offer fulfilment field: " + key);
  if (!value.fulfilmentAsset.trim() && !value.fulfilmentUrl.trim()) issues.push("Provide a fulfilment asset or HTTPS URL.");
  if (value.fulfilmentUrl.trim()) {
    try { if (new URL(value.fulfilmentUrl).protocol !== "https:") issues.push("Fulfilment URL must use HTTPS."); }
    catch { issues.push("Fulfilment URL must be valid HTTPS."); }
  }
  if (value.privacyUrl.trim()) {
    try { if (new URL(value.privacyUrl).protocol !== "https:") issues.push("Privacy URL must use HTTPS."); }
    catch { issues.push("Privacy URL must be valid HTTPS."); }
  }
  return issues;
}

export type MetaPublishControls = {
  target?: MetaPublishTarget;
  dailyBudgetMinorUnits?: number;
  newCampaign?: { objective: string; specialAdCategories: string[]; specialAdCategoryCountries: string[]; budgetMode: "campaign" | "adset" };
  parentState?: MetaParentState;
  /** Explicit article/website destination for the ad and (when applicable) form thank-you button. */
  destinationUrl?: string;
  destinationMode?: "website" | "instant_form";
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
  fulfilment?: MetaOfferFulfilment;
  placements?: {
    publisherPlatforms?: string[];
    facebookPositions?: string[];
    instagramPositions?: string[];
  };
};

export type MetaPublishCampaignPlan = {
  localId: string;
  name: string;
  objective: string;
  status: "PAUSED";
  specialAdCategories: string[];
  specialAdCategoryCountries: string[];
  budgetMode: "campaign" | "adset";
};

export type MetaPublishAdSetPlan = {
  localId: string;
  existingId?: string;
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
  /** "storage" = workspace-artifacts path resolved to bytes by the publish worker. */
  source: "inline" | "url" | "meta" | "storage";
  mimeType?: string;
  filename?: string;
  bytesBase64?: string;
  url?: string;
  storagePath?: string;
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
  fulfilment?: MetaOfferFulfilment;
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

export type MetaPublishExecutionInput = {
  accessToken: string;
  /** Resolved transiently from the user token; never persisted in a plan or log. */
  pageAccessToken?: string;
  graphVersion?: string;
  fetchImpl?: typeof fetch;
  /**
   * A previous run may have reached Meta before its response could be stored.
   * In that case, adopt objects bearing this plan's deterministic marker before
   * issuing another create request.
   */
  reconcileMissingObjects?: boolean;
  /** Persist each provider object ID before the adapter moves to its next write. */
  onCheckpoint?: (result: MetaPublishExecutionResult) => Promise<void>;
};

export type MetaExecutionAdapterImplementation = {
  adapter: MetaExecutionAdapter;
  publish: (
    plan: MetaPublishPlan,
    input: MetaPublishExecutionInput,
  ) => Promise<MetaPublishExecutionResult>;
  diagnostics: (plan: MetaPublishPlan) => Promise<Record<string, unknown>>;
};

function buildMetaPlanIdempotencyKey(input: {
  workspaceId: string;
  adStudioCampaignId: string;
  adapter: MetaExecutionAdapter;
  approvalRequestId?: string | null;
  existingMetaCampaignId?: string | null;
  variantIds?: string[];
  executionFingerprint: string;
}) {
  const selectedVariants = [...new Set(input.variantIds ?? [])].sort();
  const selectionKey = selectedVariants.length > 0
    ? `creatives_${createHash("sha256").update(selectedVariants.join(":")).digest("hex").slice(0, 16)}`
    : "creatives_all";
  return [
    "meta_publish",
    input.workspaceId,
    input.adStudioCampaignId,
    input.adapter,
    input.approvalRequestId ?? "draft",
    input.existingMetaCampaignId ? `campaign_${input.existingMetaCampaignId}` : "campaign_new",
    selectionKey,
    `execution_${input.executionFingerprint}`,
  ].join(":");
}

function hashMetaExecutionSpec(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalizeMetaExecutionValue(value)))
    .digest("hex")
    .slice(0, 32);
}

function canonicalizeMetaExecutionValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeMetaExecutionValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalizeMetaExecutionValue(entry)]),
  );
}

export function hasExplicitMetaPublishAudience(controls: MetaPublishControls | undefined): boolean {
  const geo = controls?.geo;
  if (!geo) return false;
  if (geo.type === "cities") {
    return geo.locations.length > 0 && typeof geo.includeSurroundingSuburbs === "boolean";
  }
  if (geo.type === "custom_radius") {
    return Number.isFinite(geo.latitude) && Number.isFinite(geo.longitude) && Number.isFinite(geo.radiusKm) && geo.radiusKm > 0;
  }
  return false;
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
  existingMetaCampaignId?: string | null;
  existingMetaCampaignBudgetMode?: "campaign" | "adset";
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
  const controls = normalizeMetaPublishControls(input.controls, campaignPack, input);
  const setup = normalizeMetaConnectionSetup(input.setup);
  const existingMetaCampaignId = controls.target?.mode === "new_campaign_new_adset"
    ? null
    : controls.target?.campaignId?.trim() || input.existingMetaCampaignId?.trim() || null;
  const campaign: MetaPublishCampaignPlan = {
    localId: "campaign_main",
    name: campaignPack.campaign.name,
    objective: "OUTCOME_LEADS",
    status: "PAUSED",
    specialAdCategories: ["HOUSING"],
    specialAdCategoryCountries: [campaignPack.campaign.market.country.trim().toUpperCase()],
    budgetMode: existingMetaCampaignId
      ? (input.existingMetaCampaignBudgetMode ?? "campaign")
      : "campaign",
  };
  const adSets = buildAdSetPlans(campaignPack, controls);
  const leadForms = buildLeadFormPlans(campaignPack, setup, controls.destinationUrl);
  const creatives = buildCreativePlans(campaignPack, setup);
  const ads = buildAdPlans(campaignPack, adSets);
  const tracking: MetaPublishTrackingPlan = {
    utmSource: "meta",
    utmMedium: "paid_social",
    utmCampaign: slug(campaignPack.campaign.name),
    utmContentPrefix: slug(campaignPack.campaign.market.suburb),
  };
  const executionFingerprint = hashMetaExecutionSpec({
    providerConnectionId: input.connectionId,
    setup,
    controls,
    campaign,
    adSets,
    leadForms,
    creatives,
    ads,
    tracking,
  });
  const idempotencyKey = buildMetaPlanIdempotencyKey({
    workspaceId: input.workspaceId,
    adStudioCampaignId: campaignPack.campaign.campaignId,
    adapter,
    approvalRequestId: input.approvalRequestId,
    existingMetaCampaignId,
    variantIds: abTest ? selectedVariantIds : undefined,
    executionFingerprint,
  });

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
    setup,
    controls,
    campaign,
    adSets,
    leadForms,
    creatives,
    ads,
    tracking,
    requestLog: [],
    responseLog: [],
    reconciledObjects: {
      ...emptyReconciledObjects(),
      ...(existingMetaCampaignId ? { campaignId: existingMetaCampaignId } : {}),
      adSetIds: Object.fromEntries(adSets.filter((adSet) => adSet.existingId)
        .map((adSet) => [adSet.localId, adSet.existingId as string])),
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

  if (plan.adapter === "marketing_api" && plan.creatives.some((creative) => !hasUsableCreativeImage(creative))) {
    blockers.push("The finished ad image could not be found for one or more creatives.");
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
  input: MetaPublishExecutionInput,
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
      const providerName = buildMetaProviderObjectName(plan, plan.campaign.localId, plan.campaign.name);
      const existingId = input.reconcileMissingObjects
        ? await findMetaObjectByName(
            input,
            requestLog,
            responseLog,
            "campaign.reconcile_missing",
            `/${plan.setup.metaAdAccountId}/campaigns`,
            providerName,
          )
        : null;
      if (existingId) {
        reconciledObjects.campaignId = existingId;
      } else {
        const response = await postMetaObject(input, requestLog, responseLog, "campaign.create", `/${plan.setup.metaAdAccountId}/campaigns`, {
          name: providerName,
          objective: plan.campaign.objective,
          status: "PAUSED",
          special_ad_categories: plan.campaign.specialAdCategories,
          special_ad_category_country: plan.campaign.specialAdCategoryCountries,
          bid_strategy: META_LOWEST_COST_BID_STRATEGY,
          daily_budget: String(plan.controls.dailyBudgetMinorUnits ?? 2000),
        });
        reconciledObjects.campaignId = requireMetaId(response, "campaign");
      }
      await checkpointMetaPublishProgress(input, requestLog, responseLog, reconciledObjects);
    }

    if (reconciledObjects.campaignId) {
      const repairedBidStrategy = await repairOwnedCampaignBidStrategyIfNeeded(
        plan,
        input,
        requestLog,
        responseLog,
        reconciledObjects,
        reconciledObjects.campaignId,
      );
      if (repairedBidStrategy) {
        await checkpointMetaPublishProgress(input, requestLog, responseLog, reconciledObjects);
      }
      await assertSelectedCampaignBidStrategyIsCompatible(
        plan,
        input,
        requestLog,
        responseLog,
        reconciledObjects.campaignId,
      );
    }

    for (const leadForm of plan.leadForms) {
      if (reconciledObjects.leadFormIds[leadForm.localId]) continue;

      const providerName = buildMetaProviderObjectName(plan, leadForm.localId, leadForm.name);
      const existingId = input.reconcileMissingObjects
        ? await findMetaObjectByName(
            input,
            requestLog,
            responseLog,
            `lead_form.${leadForm.localId}.reconcile_missing`,
            `/${plan.setup.pageId}/leadgen_forms`,
            providerName,
            input.pageAccessToken ?? input.accessToken,
          )
        : null;
      if (existingId) {
        reconciledObjects.leadFormIds[leadForm.localId] = existingId;
      } else {
        const response = await postMetaObject(
          input,
          requestLog,
          responseLog,
          `lead_form.${leadForm.localId}`,
          `/${plan.setup.pageId}/leadgen_forms`,
          {
            name: providerName,
            follow_up_action_url: leadForm.thankYouWebsiteUrl,
            privacy_policy: {
              url: leadForm.privacyPolicyUrl,
              link_text: "Privacy Policy",
            },
            is_optimized_for_quality: true,
            questions: [
              { type: "FIRST_NAME", key: "first_name" },
              { type: "LAST_NAME", key: "last_name" },
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
          },
          input.pageAccessToken ?? input.accessToken,
        );
        reconciledObjects.leadFormIds[leadForm.localId] = requireMetaId(response, "lead form");
      }
      await checkpointMetaPublishProgress(input, requestLog, responseLog, reconciledObjects);
    }

    for (const adSet of plan.adSets) {
      if (reconciledObjects.adSetIds[adSet.localId]) continue;

      const providerName = buildMetaProviderObjectName(plan, adSet.localId, adSet.name);
      const existingId = input.reconcileMissingObjects
        ? await findMetaObjectByName(
            input,
            requestLog,
            responseLog,
            `adset.${adSet.localId}.reconcile_missing`,
            `/${plan.setup.metaAdAccountId}/adsets`,
            providerName,
          )
        : null;
      if (existingId) {
        reconciledObjects.adSetIds[adSet.localId] = existingId;
      } else {
        const response = await postMetaObject(input, requestLog, responseLog, `adset.${adSet.localId}`, `/${plan.setup.metaAdAccountId}/adsets`, {
          name: providerName,
          campaign_id: reconciledObjects.campaignId,
          billing_event: adSet.billingEvent,
          optimization_goal: adSet.optimizationGoal,
          destination_type: "ON_AD",
          promoted_object: { page_id: plan.setup.pageId },
          targeting: adSet.targeting,
          status: "PAUSED",
          ...(plan.campaign.budgetMode === "adset"
            ? {
                bid_strategy: META_LOWEST_COST_BID_STRATEGY,
                daily_budget: String(adSet.dailyBudgetMinorUnits),
              }
            : {}),
          ...(adSet.startTime ? { start_time: adSet.startTime } : {}),
          ...(adSet.endTime ? { end_time: adSet.endTime } : {}),
        });
        reconciledObjects.adSetIds[adSet.localId] = requireMetaId(response, "ad set");
      }
      await checkpointMetaPublishProgress(input, requestLog, responseLog, reconciledObjects);
    }

    for (const creative of plan.creatives) {
      if (reconciledObjects.creativeIds[creative.localId]) continue;

      const providerName = buildMetaProviderObjectName(
        plan,
        creative.localId,
        creative.name,
        META_AD_CREATIVE_NAME_MAX_LENGTH,
      );
      const existingId = input.reconcileMissingObjects
        ? await findMetaObjectByName(
            input,
            requestLog,
            responseLog,
            `creative.${creative.localId}.reconcile_missing`,
            `/${plan.setup.metaAdAccountId}/adcreatives`,
            providerName,
          )
        : null;
      if (existingId) {
        reconciledObjects.creativeIds[creative.localId] = existingId;
      } else {
        const imageHash = await resolveCreativeImageHash(plan, creative, input, requestLog, responseLog);
        const leadFormId = reconciledObjects.leadFormIds[creative.leadFormLocalId];
        const linkBase = plan.controls.destinationUrl?.trim();
        if (!linkBase || !isHttpsDestination(linkBase)) {
          throw new Error("Publish plan is missing a valid HTTPS destination URL.");
        }
        const utmLink = buildUtmLink(linkBase, plan.tracking, creative.localId);
        const response = await postMetaObject(input, requestLog, responseLog, `creative.${creative.localId}`, `/${plan.setup.metaAdAccountId}/adcreatives`, {
          name: providerName,
          object_story_spec: {
            page_id: creative.pageId,
            ...(creative.instagramActorId ? { instagram_user_id: creative.instagramActorId } : {}),
            link_data: {
              message: creative.primaryText,
              name: creative.headline,
              description: creative.description,
              link: utmLink,
              ...(imageHash ? { image_hash: imageHash } : {}),
              call_to_action: {
                type: creative.cta,
                value: leadFormId ? { lead_gen_form_id: leadFormId } : { link: utmLink },
              },
            },
          },
        });
        reconciledObjects.creativeIds[creative.localId] = requireMetaId(response, "creative");
      }
      await checkpointMetaPublishProgress(input, requestLog, responseLog, reconciledObjects);
    }

    for (const ad of plan.ads) {
      if (reconciledObjects.adIds[ad.localId]) continue;

      const providerName = buildMetaProviderObjectName(plan, ad.localId, ad.name);
      const existingId = input.reconcileMissingObjects
        ? await findMetaObjectByName(
            input,
            requestLog,
            responseLog,
            `ad.${ad.localId}.reconcile_missing`,
            `/${plan.setup.metaAdAccountId}/ads`,
            providerName,
          )
        : null;
      if (existingId) {
        reconciledObjects.adIds[ad.localId] = existingId;
      } else {
        const response = await postMetaObject(input, requestLog, responseLog, `ad.${ad.localId}`, `/${plan.setup.metaAdAccountId}/ads`, {
          name: providerName,
          adset_id: reconciledObjects.adSetIds[ad.adSetLocalId],
          creative: { creative_id: reconciledObjects.creativeIds[ad.creativeLocalId] },
          status: "PAUSED",
        });
        reconciledObjects.adIds[ad.localId] = requireMetaId(response, "ad");
      }
      await checkpointMetaPublishProgress(input, requestLog, responseLog, reconciledObjects);
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
  input: MetaPublishExecutionInput,
  requestLog: MetaProviderLogEntry[],
  responseLog: MetaProviderLogEntry[],
): Promise<string | null> {
  if (creative.asset?.imageHash) return creative.asset.imageHash;
  if (creative.asset?.type !== "image" || creative.asset.source !== "inline" || !creative.asset.bytesBase64) return null;

  const filename = creative.asset.filename ?? `${creative.localId}.png`;
  const response = await postMetaObject(input, requestLog, responseLog, `asset.${creative.localId}`, `/${plan.setup.metaAdAccountId}/adimages`, {
    bytes: creative.asset.bytesBase64,
  });

  const imageMap = response.images as Record<string, { hash?: string }> | undefined;
  const fromMap = imageMap?.[filename]?.hash ?? Object.values(imageMap ?? {})[0]?.hash;

  return fromMap ?? (typeof response.hash === "string" ? response.hash : null);
}

async function reconcileMetaObjects(
  input: MetaPublishExecutionInput,
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
  input: MetaPublishExecutionInput,
  requestLog: MetaProviderLogEntry[],
  responseLog: MetaProviderLogEntry[],
  step: string,
  path: string,
  body: Record<string, unknown>,
  accessToken = input.accessToken,
) {
  const createdAt = new Date().toISOString();
  requestLog.push({ step, method: "POST", path, body: redactMetaRequestBody(body), createdAt });

  const response = await (input.fetchImpl ?? fetch)(`https://graph.facebook.com/${input.graphVersion ?? DEFAULT_META_GRAPH_VERSION}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  responseLog.push({ step, method: "POST", path, response: payload, status: response.status, createdAt: new Date().toISOString() });

  if (!response.ok) {
    throw new Error(metaProviderErrorMessage(payload, `Meta request ${step} failed with ${response.status}.`));
  }

  return payload;
}

function metaProviderErrorMessage(payload: Record<string, unknown>, fallback: string) {
  const error = payload.error as {
    message?: string;
    error_user_msg?: string;
    error_user_title?: string;
  } | undefined;
  const detail = optionalString(error?.error_user_msg) ?? optionalString(error?.message);
  const title = optionalString(error?.error_user_title);
  return title && detail ? `${title}: ${detail}` : detail ?? fallback;
}

async function checkpointMetaPublishProgress(
  input: MetaPublishExecutionInput,
  requestLog: MetaProviderLogEntry[],
  responseLog: MetaProviderLogEntry[],
  reconciledObjects: MetaReconciledObjects,
) {
  if (!input.onCheckpoint) return;

  await input.onCheckpoint({
    status: "publishing",
    requestLog: [...requestLog],
    responseLog: [...responseLog],
    reconciledObjects: {
      ...reconciledObjects,
      leadFormIds: { ...reconciledObjects.leadFormIds },
      adSetIds: { ...reconciledObjects.adSetIds },
      creativeIds: { ...reconciledObjects.creativeIds },
      adIds: { ...reconciledObjects.adIds },
    },
    lastError: null,
    updatedAt: new Date().toISOString(),
  });
}

function buildMetaProviderObjectName(
  plan: MetaPublishPlan,
  localId: string,
  displayName: string,
  maxLength = META_PROVIDER_OBJECT_NAME_MAX_LENGTH,
) {
  const marker = `[BW:${plan.planId}:${localId}]`;
  const effectiveMaxLength = Math.max(marker.length, Math.floor(maxLength));
  const prefix = displayName.trim().slice(0, Math.max(0, effectiveMaxLength - marker.length - 1));
  return `${prefix} ${marker}`.trim();
}

async function repairOwnedCampaignBidStrategyIfNeeded(
  plan: MetaPublishPlan,
  input: MetaPublishExecutionInput,
  requestLog: MetaProviderLogEntry[],
  responseLog: MetaProviderLogEntry[],
  reconciledObjects: MetaReconciledObjects,
  campaignId: string,
): Promise<boolean> {
  const ownership = getCampaignOwnershipEvidence(plan, requestLog, responseLog, campaignId);
  if (!ownership.ownedByPlan || !ownership.predatesBidStrategyContract) return false;
  if (plan.status !== "publishing") {
    throw new Error("The legacy Blockwise campaign is not in a resumable publish state; refusing to change its bid strategy.");
  }

  const before = await getMetaCampaignBidStrategy(
    input,
    requestLog,
    responseLog,
    "campaign.bid_strategy_repair.preflight",
    campaignId,
  );
  assertCampaignAccountMatches(plan.setup.metaAdAccountId, before);
  assertOwnedCampaignIsPaused(ownership.expectedName, before);
  assertOwnedCampaignBudgetMatches(plan, before);
  await assertOwnedCampaignAdSetsMatch(input, requestLog, responseLog, reconciledObjects, campaignId);
  if (before.bidStrategy === META_LOWEST_COST_BID_STRATEGY) return false;
  if (before.bidStrategy !== "LOWEST_COST_WITH_BID_CAP") {
    throw new Error(
      `The paused Blockwise campaign has unexpected bid strategy ${before.bidStrategy ?? "UNKNOWN"}; refusing to change it.`,
    );
  }
  if (Object.keys(reconciledObjects.adSetIds).length > 0 || Object.keys(reconciledObjects.adIds).length > 0) {
    throw new Error("The legacy Blockwise campaign already has reconciled delivery objects; refusing to change its bid strategy.");
  }

  await postMetaObject(
    input,
    requestLog,
    responseLog,
    "campaign.bid_strategy_repair",
    `/${campaignId}`,
    {
      bid_strategy: META_LOWEST_COST_BID_STRATEGY,
      status: "PAUSED",
    },
  );

  const after = await getMetaCampaignBidStrategy(
    input,
    requestLog,
    responseLog,
    "campaign.bid_strategy_repair.verify",
    campaignId,
  );
  assertCampaignAccountMatches(plan.setup.metaAdAccountId, after);
  assertOwnedCampaignIsPaused(ownership.expectedName, after);
  assertOwnedCampaignBudgetMatches(plan, after);
  if (after.bidStrategy !== META_LOWEST_COST_BID_STRATEGY) {
    throw new Error("Meta did not confirm the safe lowest-cost bid strategy for the paused Blockwise campaign.");
  }
  return true;
}

async function assertSelectedCampaignBidStrategyIsCompatible(
  plan: MetaPublishPlan,
  input: MetaPublishExecutionInput,
  requestLog: MetaProviderLogEntry[],
  responseLog: MetaProviderLogEntry[],
  campaignId: string,
) {
  const ownership = getCampaignOwnershipEvidence(plan, requestLog, responseLog, campaignId);
  if (ownership.ownedByPlan) return;

  const state = await getMetaCampaignBidStrategy(
    input,
    requestLog,
    responseLog,
    "campaign.selected_bid_strategy.preflight",
    campaignId,
  );
  assertCampaignAccountMatches(plan.setup.metaAdAccountId, state);
  const liveBudgetMode = hasMetaCampaignBudget(state) ? "campaign" : "adset";
  if (liveBudgetMode !== plan.campaign.budgetMode) {
    throw new Error(
      `The selected Meta campaign now uses ${liveBudgetMode}-level budgeting, not ${plan.campaign.budgetMode}-level budgeting. ` +
      "Choose it again before publishing; Blockwise did not write any child objects.",
    );
  }
  if (liveBudgetMode === "campaign" && state.bidStrategy !== META_LOWEST_COST_BID_STRATEGY) {
    throw new Error(
      `The selected Meta campaign uses ${state.bidStrategy ?? "an unknown bid strategy"}. ` +
      "Choose a campaign using lowest cost without a cap before publishing; Blockwise did not change it.",
    );
  }
}

function getCampaignOwnershipEvidence(
  plan: MetaPublishPlan,
  requestLog: MetaProviderLogEntry[],
  responseLog: MetaProviderLogEntry[],
  campaignId: string,
) {
  const expectedName = buildMetaProviderObjectName(plan, plan.campaign.localId, plan.campaign.name);
  const creationRequest = requestLog.find(
    (entry) =>
      entry.step === "campaign.create" &&
      entry.method === "POST" &&
      entry.path === `/${plan.setup.metaAdAccountId}/campaigns` &&
      entry.body?.name === expectedName,
  );
  const createdByPlan = Boolean(creationRequest) && responseLog.some(
    (entry) =>
      entry.step === "campaign.create" &&
      entry.method === "POST" &&
      entry.path === `/${plan.setup.metaAdAccountId}/campaigns` &&
      isSuccessfulMetaResponse(entry) &&
      entry.response?.id === campaignId,
  );
  const reconcileRequested = requestLog.some(
    (entry) =>
      entry.step === "campaign.reconcile_missing" &&
      entry.method === "GET" &&
      entry.path.startsWith(`/${plan.setup.metaAdAccountId}/campaigns?`),
  );
  const reconciledByExactMarker = reconcileRequested && responseLog.some(
    (entry) =>
      entry.step === "campaign.reconcile_missing" &&
      entry.method === "GET" &&
      entry.path.startsWith(`/${plan.setup.metaAdAccountId}/campaigns?`) &&
      isSuccessfulMetaResponse(entry) &&
      entry.response?.matchedObjectId === campaignId,
  );
  const ownedByPlan = createdByPlan || reconciledByExactMarker;

  return {
    expectedName,
    ownedByPlan,
    predatesBidStrategyContract: ownedByPlan && (
      !creationRequest || !Object.prototype.hasOwnProperty.call(creationRequest.body ?? {}, "bid_strategy")
    ),
  };
}

type MetaCampaignBidStrategyState = {
  name: string | null;
  accountId: string | null;
  dailyBudgetMinorUnits: number | null;
  lifetimeBudgetMinorUnits: number | null;
  configuredStatus: string | null;
  effectiveStatus: string | null;
  bidStrategy: string | null;
};

async function getMetaCampaignBidStrategy(
  input: MetaPublishExecutionInput,
  requestLog: MetaProviderLogEntry[],
  responseLog: MetaProviderLogEntry[],
  step: string,
  campaignId: string,
): Promise<MetaCampaignBidStrategyState> {
  const path = `/${campaignId}?fields=id,name,account_id,daily_budget,lifetime_budget,status,effective_status,configured_status,bid_strategy`;
  const createdAt = new Date().toISOString();
  requestLog.push({ step, method: "GET", path, createdAt });
  const response = await (input.fetchImpl ?? fetch)(
    `https://graph.facebook.com/${input.graphVersion ?? DEFAULT_META_GRAPH_VERSION}${path}`,
    {
      method: "GET",
      headers: { authorization: `Bearer ${input.accessToken}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  responseLog.push({
    step,
    method: "GET",
    path,
    response: payload,
    status: response.status,
    createdAt: new Date().toISOString(),
  });
  if (!response.ok) {
    throw new Error(metaProviderErrorMessage(payload, `Meta campaign verification failed with ${response.status}.`));
  }
  return {
    name: optionalString(payload.name),
    accountId: optionalString(payload.account_id),
    dailyBudgetMinorUnits: optionalMetaBudget(payload.daily_budget),
    lifetimeBudgetMinorUnits: optionalMetaBudget(payload.lifetime_budget),
    configuredStatus: optionalString(payload.configured_status ?? payload.status),
    effectiveStatus: optionalString(payload.effective_status ?? payload.status),
    bidStrategy: optionalString(payload.bid_strategy),
  };
}

async function assertOwnedCampaignAdSetsMatch(
  input: MetaPublishExecutionInput,
  requestLog: MetaProviderLogEntry[],
  responseLog: MetaProviderLogEntry[],
  reconciledObjects: MetaReconciledObjects,
  campaignId: string,
) {
  const step = "campaign.bid_strategy_repair.adsets_preflight";
  const path = `/${campaignId}/adsets?fields=id,configured_status,status&limit=100`;
  const createdAt = new Date().toISOString();
  requestLog.push({ step, method: "GET", path, createdAt });
  const response = await (input.fetchImpl ?? fetch)(
    `https://graph.facebook.com/${input.graphVersion ?? DEFAULT_META_GRAPH_VERSION}${path}`,
    {
      method: "GET",
      headers: { authorization: `Bearer ${input.accessToken}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const rawRows = Array.isArray(payload.data) ? payload.data : null;
  const rows = rawRows
    ? rawRows.flatMap((row): Array<{ id: string; configuredStatus: string | null }> => {
        if (!row || typeof row !== "object") return [];
        const record = row as Record<string, unknown>;
        const id = optionalString(record.id);
        return id ? [{ id, configuredStatus: optionalString(record.configured_status ?? record.status) }] : [];
      })
    : [];
  responseLog.push({
    step,
    method: "GET",
    path,
    response: response.ok ? { returnedObjectCount: rawRows?.length ?? null } : payload,
    status: response.status,
    createdAt: new Date().toISOString(),
  });
  if (!response.ok) {
    throw new Error(metaProviderErrorMessage(payload, `Meta campaign ad-set verification failed with ${response.status}.`));
  }
  if (!rawRows || rows.length !== rawRows.length) {
    throw new Error("Meta returned an invalid live ad-set inventory; refusing to continue.");
  }
  const paging = payload.paging && typeof payload.paging === "object"
    ? payload.paging as { next?: unknown }
    : null;
  if (typeof paging?.next === "string" && paging.next) {
    throw new Error("The legacy Blockwise campaign has more live ad sets than can be safely verified; refusing to continue.");
  }
  const expectedIds = new Set(Object.values(reconciledObjects.adSetIds));
  if (
    rows.length !== expectedIds.size ||
    rows.some((row) => !expectedIds.has(row.id) || row.configuredStatus !== "PAUSED")
  ) {
    throw new Error("The legacy Blockwise campaign's live ad sets do not match its paused reconciled objects; refusing to continue.");
  }
}

function isSuccessfulMetaResponse(entry: MetaProviderLogEntry) {
  return typeof entry.status === "number" && entry.status >= 200 && entry.status < 300;
}

function hasMetaCampaignBudget(state: MetaCampaignBidStrategyState) {
  return (state.dailyBudgetMinorUnits ?? 0) > 0 || (state.lifetimeBudgetMinorUnits ?? 0) > 0;
}

function assertOwnedCampaignBudgetMatches(plan: MetaPublishPlan, state: MetaCampaignBidStrategyState) {
  const expectedDailyBudget = Math.round(plan.controls.dailyBudgetMinorUnits ?? 2000);
  if (
    state.dailyBudgetMinorUnits !== expectedDailyBudget ||
    (state.lifetimeBudgetMinorUnits ?? 0) !== 0
  ) {
    throw new Error("The paused Blockwise campaign budget no longer matches its approved plan; refusing to continue.");
  }
}

function assertCampaignAccountMatches(expectedAccountId: string, state: MetaCampaignBidStrategyState) {
  if (!state.accountId || normalizeMetaAccountId(state.accountId) !== normalizeMetaAccountId(expectedAccountId)) {
    throw new Error("The Meta campaign does not belong to the configured ad account; refusing to publish into it.");
  }
}

function assertOwnedCampaignIsPaused(expectedName: string, state: MetaCampaignBidStrategyState) {
  if (state.name !== expectedName) {
    throw new Error("Meta campaign ownership could not be verified; refusing to change its bid strategy.");
  }
  if (state.configuredStatus !== "PAUSED" || state.effectiveStatus !== "PAUSED") {
    throw new Error("The Blockwise campaign is not paused; refusing to change its bid strategy.");
  }
}

async function findMetaObjectByName(
  input: MetaPublishExecutionInput,
  requestLog: MetaProviderLogEntry[],
  responseLog: MetaProviderLogEntry[],
  step: string,
  edgePath: string,
  providerName: string,
  accessToken = input.accessToken,
): Promise<string | null> {
  let after: string | null = null;

  for (let pageNumber = 1; pageNumber <= 100; pageNumber += 1) {
    const params = new URLSearchParams({ fields: "id,name", limit: "100" });
    if (after) params.set("after", after);
    const path = `${edgePath}?${params.toString()}`;
    const createdAt = new Date().toISOString();
    requestLog.push({ step, method: "GET", path, createdAt });

    const response = await (input.fetchImpl ?? fetch)(`https://graph.facebook.com/${input.graphVersion ?? DEFAULT_META_GRAPH_VERSION}${path}`, {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const rows = Array.isArray(payload.data) ? payload.data : [];
    const match = rows.find((item): item is { id: string; name: string } => {
      if (!item || typeof item !== "object") return false;
      const row = item as Record<string, unknown>;
      return typeof row.id === "string" && row.name === providerName;
    });
    responseLog.push({
      step,
      method: "GET",
      path,
      response: response.ok
        ? { pageNumber, returnedObjectCount: rows.length, matchedObjectId: match?.id ?? null }
        : payload,
      status: response.status,
      createdAt: new Date().toISOString(),
    });

    if (!response.ok) {
      const error = payload.error as { message?: string } | undefined;
      throw new Error(error?.message ?? `Meta reconciliation ${step} failed with ${response.status}.`);
    }
    if (match) return match.id;

    const paging = payload.paging && typeof payload.paging === "object"
      ? payload.paging as { cursors?: { after?: unknown } }
      : null;
    const nextAfter = paging?.cursors?.after;
    if (typeof nextAfter !== "string" || !nextAfter || nextAfter === after) return null;
    after = nextAfter;
  }

  throw new Error(`Meta reconciliation ${step} exceeded 10,000 objects; refusing to create a possible duplicate.`);
}

/** Keep persisted request logs small and free of image payloads. */
function redactMetaRequestBody(body: Record<string, unknown>): Record<string, unknown> {
  if (typeof body.bytes !== "string") return body;

  return { ...body, bytes: `<redacted ${body.bytes.length} base64 chars>` };
}

async function getMetaObjectStatus(
  input: MetaPublishExecutionInput,
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
    signal: AbortSignal.timeout(30_000),
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

function buildAdSetPlans(pack: AdStudioCampaignPack, controls: MetaPublishControls): MetaPublishAdSetPlan[] {
  const suburb = pack.campaign.market.suburb;
  const targeting = buildTargeting(controls);
  const target = controls.target;
  if (target?.mode === "existing_adset") {
    return target.adSetIds.map((existingId, index) => ({
      localId: "adset_existing_" + (index + 1),
      existingId,
      name: suburb + " existing ad set " + (index + 1),
      campaignLocalId: "campaign_main",
      billingEvent: "IMPRESSIONS",
      optimizationGoal: "LEAD_GENERATION",
      status: "PAUSED",
      dailyBudgetMinorUnits: controls.dailyBudgetMinorUnits ?? 2000,
      targeting,
      startTime: controls.schedule?.startTime ?? null,
      endTime: controls.schedule?.endTime ?? null,
    }));
  }
  return [{
    localId: "adset_primary",
    name: suburb + " homeowners",
    campaignLocalId: "campaign_main",
    billingEvent: "IMPRESSIONS",
    optimizationGoal: "LEAD_GENERATION",
    status: "PAUSED",
    dailyBudgetMinorUnits: controls.dailyBudgetMinorUnits ?? 2000,
    targeting,
    startTime: controls.schedule?.startTime ?? null,
    endTime: controls.schedule?.endTime ?? null,
  }];
}

/**
 * Append UTM parameters to the ad link so traffic is attributable in Google Analytics.
 * The tracking plan already holds utmSource/utmMedium/utmCampaign/utmContentPrefix —
 * this just formats them into a query string on the destination URL.
 */
function buildUtmLink(baseUrl: string, tracking: MetaPublishTrackingPlan, creativeLocalId: string): string {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("utm_source", tracking.utmSource);
    url.searchParams.set("utm_medium", tracking.utmMedium);
    url.searchParams.set("utm_campaign", tracking.utmCampaign);
    url.searchParams.set("utm_content", `${tracking.utmContentPrefix}_${creativeLocalId}`);
    return url.toString();
  } catch {
    return baseUrl;
  }
}

function buildTargeting(controls: MetaPublishControls): Record<string, unknown> {
  const geoLocations = controls.geo?.type === "cities" && controls.geo.locations.length > 0
    ? {
        cities: controls.geo.locations.map((location) => ({
          key: location.key,
          ...(controls.geo?.type === "cities" && controls.geo.includeSurroundingSuburbs
            ? { radius: META_HOUSING_MIN_RADIUS_KM, distance_unit: "kilometer" }
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
              radius: Math.max(META_HOUSING_MIN_RADIUS_KM, controls.geo.radiusKm),
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

function buildCreativePlans(pack: AdStudioCampaignPack, setup: MetaConnectionSetup): MetaPublishCreativePlan[] {
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
      asset: creative ? buildCreativeImageAsset(creative) : null,
    };
  });
}

/**
 * The finished ad image is the full-canvas clone. After autosave its storage
 * reference lives on the clone object as either a raw workspace-artifacts
 * path or an `/api/adstudio/media?path=…` URL; freshly generated packs may
 * still hold a data URL. Storage references are resolved to bytes by the
 * publish worker just before upload, so plans stay small in the database.
 */
function buildCreativeImageAsset(creative: AdStudioCampaignPack["creatives"][number]): MetaCreativeAssetPlan | null {
  const imageObject = creative.canvas.objects.find((object) => object.role === "primary_image");
  const reference = imageObject?.content?.trim() || imageObject?.assetId?.trim() || "";

  if (!reference) return null;

  const dataUrlMatch = reference.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    return {
      type: "image",
      source: "inline",
      mimeType: dataUrlMatch[1],
      filename: `${creative.creativeId}.${dataUrlMatch[1] === "image/jpeg" ? "jpg" : "png"}`,
      bytesBase64: dataUrlMatch[2],
    };
  }

  const storagePath = reference.startsWith("/api/adstudio/media?")
    ? new URL(reference, "https://blockwise.invalid").searchParams.get("path")
    : reference.startsWith("data:") || isHttpUrl(reference)
      ? null
      : reference;

  if (!storagePath) return null;

  return {
    type: "image",
    source: "storage",
    mimeType: "image/png",
    filename: `${creative.creativeId}.png`,
    storagePath,
  };
}

function hasUsableCreativeImage(creative: MetaPublishCreativePlan): boolean {
  const asset = creative.asset;
  if (!asset) return false;

  return Boolean(asset.imageHash || asset.bytesBase64 || (asset.source === "storage" && asset.storagePath));
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isHttpsDestination(value: string): boolean {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function buildAdPlans(pack: AdStudioCampaignPack, adSets: MetaPublishAdSetPlan[]): MetaPublishAdPlan[] {
  const copies = pack.copyPacks.slice(0, 6);
  return adSets.flatMap((adSet, adSetIndex) => copies.map((copy, index) => {
    const variant = pack.variants.find((item) => item.variantId === copy.variantId) ?? null;
    const variantTag: MetaAdVariantTag | null = variant
      ? { variantId: variant.variantId, angle: variant.angle, template: pack.campaign.templateKey ?? pack.campaign.offerId ?? null }
      : null;
    const ordinal = adSetIndex * copies.length + index + 1;
    return {
      localId: "ad_" + ordinal,
      name: pack.campaign.name + " ad " + ordinal + (variantTag ? buildAdVariantTagSuffix(variantTag) : ""),
      adSetLocalId: adSet.localId,
      creativeLocalId: "creative_" + (index + 1),
      status: "PAUSED" as const,
      variantTag,
    };
  }));
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

function normalizeMetaPublishControls(
  controls: MetaPublishControls | undefined,
  pack: AdStudioCampaignPack,
  input: { existingMetaCampaignId?: string | null; existingMetaCampaignBudgetMode?: "campaign" | "adset" },
): MetaPublishControls {
  const destinationUrl = controls?.destinationUrl?.trim();
  const suppliedTarget = controls?.target;
  const target: MetaPublishTarget = suppliedTarget
    ?? (input.existingMetaCampaignId?.trim()
      ? { mode: "existing_campaign_new_adset", campaignId: input.existingMetaCampaignId.trim() }
      : { mode: "new_campaign_new_adset" });

  return {
    target,
    dailyBudgetMinorUnits: controls?.dailyBudgetMinorUnits && controls.dailyBudgetMinorUnits > 0
      ? Math.round(controls.dailyBudgetMinorUnits)
      : 2000,
    ...(destinationUrl && isHttpUrl(destinationUrl) ? { destinationUrl } : {}),
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
  const campaignDefaults: MetaPublishCampaignPlan = {
    localId: "campaign_main",
    name: "Meta campaign",
    objective: "OUTCOME_LEADS",
    status: "PAUSED",
    specialAdCategories: ["HOUSING"],
    specialAdCategoryCountries: ["AU"],
    budgetMode: "campaign",
  };

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
    // Plans persisted before these fields were added remain executable with
    // explicit safe defaults rather than emitting undefined Meta parameters.
    campaign: { ...campaignDefaults, ...(planJson.campaign ?? {}) },
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

function optionalMetaBudget(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const budget = Number(value);
  return Number.isFinite(budget) && budget >= 0 ? budget : null;
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
