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
/**
 * A plan is deliberately not "live" when Meta objects merely exist. Creation
 * ends at paused_ready; activation is an explicit, independently-audited
 * mutation. reconciliation_required means a network/provider response was
 * ambiguous, so retrying creates is unsafe until the IDs are reconciled.
 */
export type MetaPublishPlanStatus =
  | "draft"
  | "validating"
  | "queued"
  | "publishing"
  | "paused_ready"
  | "activating"
  | "live"
  | "failed"
  | "reconciliation_required"
  /** Read compatibility only; the database migration rewrites these values. */
  | "approved"
  | "paused_live";

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
  /** @deprecated Read only for persisted plans created before the URL split. */
  destinationUrl?: string;
  /** The URL opened from the ad creative. */
  adDestinationUrl?: string;
  /** The URL opened from the Instant Form thank-you screen. */
  formCompletionUrl?: string;
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
  specialAdCategoryCountries: string[];
  budgetMode: "campaign" | "adset";
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
  /** "storage" = workspace-artifacts path resolved to bytes by the publish worker. */
  source: "inline" | "url" | "meta" | "storage";
  mimeType?: string;
  filename?: string;
  bytesBase64?: string;
  url?: string;
  storagePath?: string;
  /** SHA-256 of the exact finished bytes. Required before compliance/publish. */
  contentSha256?: string;
  /** Meta's uploaded image hash is transport metadata, not compliance proof. */
  imageHash?: string;
  videoId?: string;
};

export type MetaInstantFormContactField = "FIRST_NAME" | "LAST_NAME" | "EMAIL" | "PHONE";
export type MetaInstantFormSpec = {
  headline: string;
  intro: string;
  contactFields: MetaInstantFormContactField[];
  /** Maximum five, enforced before provider writes. */
  customQuestions: string[];
  privacyPolicyUrl: string;
  thankYouTitle: string;
  thankYouBody: string;
  thankYouButtonType: "VIEW_WEBSITE";
  thankYouButtonText: string;
  thankYouWebsiteUrl: string;
};

/** Portable package copy; customer URLs are supplied only at publish time. */
export type MetaLeadFormDefaults = Omit<MetaInstantFormSpec, "privacyPolicyUrl" | "thankYouWebsiteUrl">;

export type MetaLeadFormCustomerSetup = {
  privacyPolicyUrl: string;
  formCompletionUrl: string;
};

export type MetaPublishLeadFormPlan = MetaInstantFormSpec & {
  localId: string;
  name: string;
  /** Back-compat alias only; new package consumers use customQuestions. */
  questions: string[];
};

export type MetaPublishDefaults = {
  cta: "LEARN_MORE" | "SIGN_UP" | "GET_QUOTE" | "APPLY_NOW" | "DOWNLOAD" | "SUBSCRIBE";
  placements: { feed: true; story: true };
  creativeFeatures: Partial<Record<MetaCreativeFeatureKey, "OPT_IN" | "OPT_OUT">>;
};

const META_LEAD_CTA_TYPES = new Set(["LEARN_MORE", "SIGN_UP", "GET_QUOTE", "APPLY_NOW", "DOWNLOAD", "SUBSCRIBE"]);
const SENSITIVE_LEAD_QUESTION_PATTERN = /\b(race|ethnic|religion|disabilit|health|medical|income|credit|debt|bankrupt|citizen|immigration|marital|pregnan|sexual|politic)/i;

export function validateMetaInstantFormSpec(form: MetaInstantFormSpec): string[] {
  const blockers: string[] = [];
  if (!form.headline.trim() || !form.intro.trim()) blockers.push("Meta Instant Form headline and introduction are required.");
  if (!form.contactFields.length) blockers.push("Meta Instant Form needs at least one contact field.");
  if (form.customQuestions.length > 5) blockers.push("Meta Instant Forms allow at most five custom questions.");
  if (form.customQuestions.some((question) => !question.trim())) blockers.push("Meta custom questions must have stable non-empty labels.");
  if (form.customQuestions.some((question) => SENSITIVE_LEAD_QUESTION_PATTERN.test(question))) {
    blockers.push("Meta housing lead forms cannot ask prohibited sensitive questions.");
  }
  if (!isHttpUrl(form.privacyPolicyUrl) || !isHttpUrl(form.thankYouWebsiteUrl)) {
    blockers.push("Meta Instant Form privacy and completion URLs must be valid HTTPS URLs.");
  }
  return blockers;
}

/** The sole package-to-customer boundary for Meta Instant Forms. */
export function buildMetaInstantFormSpec(
  defaults: MetaLeadFormDefaults,
  customer: MetaLeadFormCustomerSetup,
): MetaInstantFormSpec {
  return { ...defaults, privacyPolicyUrl: customer.privacyPolicyUrl, thankYouWebsiteUrl: customer.formCompletionUrl };
}

export function validateMetaLeadFormConfiguration(
  defaults: MetaLeadFormDefaults,
  customer: MetaLeadFormCustomerSetup,
): string[] {
  return validateMetaInstantFormSpec(buildMetaInstantFormSpec(defaults, customer));
}

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
  /** Active immutable finished-clone revision at plan creation. */
  adStudioCreativeRevisionId?: string | null;
  format: string | null;
  asset?: MetaCreativeAssetPlan | null;
  /** Renderer adapter: 4:5 feed plus optional 9:16 story final image. */
  formatAssets?: { feed: MetaCreativeAssetPlan | null; story: MetaCreativeAssetPlan | null } | null;
  /** Exact immutable finished-clone revisions that supplied the Meta bytes. */
  revisionBindings: MetaCreativeRevisionBinding[];
};

export type MetaCreativeRevisionBinding = {
  placement: "feed" | "story";
  creativeId: string;
  revisionId: string;
  format: AdStudioCampaignPack["creatives"][number]["format"];
  asset: MetaCreativeAssetPlan;
};

export const META_CREATIVE_FEATURE_KEYS = [
  "adapt_to_placement",
  "image_touchups",
  "image_templates",
  "inline_comment",
  "enhance_cta",
  "text_optimizations",
  "image_animation",
  "image_background_gen",
  "video_auto_crop",
  "translate_voiceover",
  "text_translation",
  "media_type_automation",
  "product_extensions",
] as const;

export type MetaCreativeFeatureKey = (typeof META_CREATIVE_FEATURE_KEYS)[number];

export function buildDefaultMetaCreativeFeatures(): Record<MetaCreativeFeatureKey, "OPT_OUT"> {
  return Object.fromEntries(
    META_CREATIVE_FEATURE_KEYS.map((key) => [key, "OPT_OUT"]),
  ) as Record<MetaCreativeFeatureKey, "OPT_OUT">;
}

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
  complianceReportId: string | null;
  /** SHA-256 of the immutable selected assets and generic copy/form content. */
  complianceSubjectHash: string;
  complianceCheckedAt: string | null;
  /** Every supported Advantage+ feature is OPT_OUT unless a released template opts in. */
  creativeFeatures: Partial<Record<MetaCreativeFeatureKey, "OPT_IN" | "OPT_OUT">>;
  /** Only true after the provider probe has passed for the package/version. */
  assetFeedEnabled: boolean;
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

/**
 * Compliance binds to exactly what Meta will render: the selected finished
 * asset identifiers/hashes plus ad copy and generic form defaults. Customer
 * privacy and destination URLs are intentionally excluded from package data.
 */
export function buildMetaComplianceSubjectHash(input: Pick<MetaPublishPlan, "campaign" | "leadForms" | "creatives" | "ads" | "tracking">): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalizeMetaExecutionValue({
      campaign: input.campaign,
      creatives: input.creatives.map((creative) => ({
        localId: creative.localId,
        adStudioCreativeId: creative.adStudioCreativeId,
        adStudioCreativeRevisionId: creative.adStudioCreativeRevisionId ?? null,
        format: creative.format,
        asset: immutableCreativeAsset(creative.asset),
        formatAssets: creative.formatAssets ? {
          feed: immutableCreativeAsset(creative.formatAssets.feed),
          story: immutableCreativeAsset(creative.formatAssets.story),
        } : null,
        revisionBindings: creative.revisionBindings.map((binding) => ({
          placement: binding.placement,
          creativeId: binding.creativeId,
          revisionId: binding.revisionId,
          format: binding.format,
          asset: immutableCreativeAsset(binding.asset),
        })),
        headline: creative.headline,
        primaryText: creative.primaryText,
        description: creative.description,
        cta: creative.cta,
      })),
      leadForms: input.leadForms.map(({ privacyPolicyUrl: _privacy, thankYouWebsiteUrl: _completion, name: _name, localId, questions: _questions, ...defaults }) => ({ localId, ...defaults })),
      ads: input.ads,
      tracking: input.tracking,
    })))
    .digest("hex");
}

function immutableCreativeAsset(asset: MetaCreativeAssetPlan | null | undefined) {
  if (!asset) return null;
  return { contentSha256: asset.contentSha256 };
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
  const controls = normalizeMetaPublishControls(input.controls, campaignPack);
  const setup = normalizeMetaConnectionSetup(input.setup);
  const existingMetaCampaignId = input.existingMetaCampaignId?.trim() || null;
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
  const leadForms = buildLeadFormPlans(campaignPack, setup, controls.formCompletionUrl);
  const creatives = buildCreativePlans(campaignPack, setup);
  const ads = buildAdPlans(campaignPack);
  const creativeFeatures = buildDefaultMetaCreativeFeatures();
  // A placement package must be complete for every creative; otherwise Meta
  // would silently fall back to a feed asset in story placement.
  const assetFeedEnabled = creatives.length > 0 && creatives.every(
    (creative) => Boolean(creative.formatAssets?.feed && creative.formatAssets?.story),
  );
  const tracking: MetaPublishTrackingPlan = {
    utmSource: "meta",
    utmMedium: "paid_social",
    utmCampaign: slug(campaignPack.campaign.name),
    utmContentPrefix: slug(campaignPack.campaign.market.suburb),
  };
  const complianceSubjectHash = buildMetaComplianceSubjectHash({ campaign, leadForms, creatives, ads, tracking });
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
    complianceReportId: campaignPack.compliance.reportId ?? null,
    complianceSubjectHash,
    creativeFeatures,
    assetFeedEnabled,
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
    complianceReportId: campaignPack.compliance.reportId ?? null,
    complianceSubjectHash,
    complianceCheckedAt: campaignPack.compliance.checkedAt ?? null,
    creativeFeatures,
    assetFeedEnabled,
    requestLog: [],
    responseLog: [],
    reconciledObjects: {
      ...emptyReconciledObjects(),
      ...(existingMetaCampaignId ? { campaignId: existingMetaCampaignId } : {}),
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
  if (plan.creatives.some((creative) => !hasImmutableCreativeContent(creative))) {
    blockers.push("Each selected finished ad asset must have a SHA-256 content hash before compliance and Meta publish.");
  }
  for (const creative of plan.creatives) {
    const hasFeed = creative.revisionBindings.some((binding) => binding.placement === "feed");
    const requiresStory = plan.adSets.some((adSet) => {
      const platforms = Array.isArray(adSet.targeting.publisher_platforms) ? adSet.targeting.publisher_platforms : [];
      const positions = Array.isArray(adSet.targeting.instagram_positions) ? adSet.targeting.instagram_positions : [];
      return platforms.includes("instagram") && (positions.length === 0 || positions.includes("story"));
    });
    if (!hasFeed) blockers.push("Each selected variant needs a finished 4:5 feed clone before publishing.");
    if (requiresStory && !creative.revisionBindings.some((binding) => binding.placement === "story")) {
      blockers.push("Instagram Story placement requires a finished 9:16 story clone for every selected variant.");
    }
  }

  for (const form of plan.leadForms) blockers.push(...validateMetaInstantFormSpec(form));
  if (plan.creatives.some((creative) => !META_LEAD_CTA_TYPES.has(creative.cta))) {
    blockers.push("Meta lead ads require a supported call to action.");
  }

  for (const adSet of plan.adSets) {
    const unsupported = unsupportedMetaPlacementPositions(adSet.targeting);
    if (unsupported.length) {
      blockers.push(`Meta Graph v26 no longer supports placement(s): ${unsupported.join(", ")}.`);
    }
  }

  return {
    ready: blockers.length === 0,
    blockers,
  };
}

/**
 * Fail closed unless the report explicitly binds the immutable subject hash
 * calculated for this exact selected publish plan. Timestamps are not proof.
 */
export async function loadMetaPublishPlanComplianceStatus(
  service: SupabaseServiceClient,
  plan: Pick<MetaPublishPlan, "workspaceId" | "adStudioCampaignId" | "complianceReportId" | "complianceSubjectHash">,
): Promise<ComplianceStatus> {
  if (!plan.complianceReportId) return "blocked";
  // Generated database types lag this forward-only migration until it is
  // applied, while the service query remains scoped and fail-closed.
  const reports = service.from("adstudio_compliance_reports") as any;
  const { data, error } = await reports
    .select("id,campaign_id,status,subject_hash")
    .eq("workspace_id", plan.workspaceId)
    .eq("id", plan.complianceReportId)
    .eq("campaign_id", plan.adStudioCampaignId)
    .maybeSingle();
  if (error || !data || data.id !== plan.complianceReportId || data.campaign_id !== plan.adStudioCampaignId) return "blocked";
  if (data.subject_hash !== plan.complianceSubjectHash) return "blocked";
  return data.status === "approved" || data.status === "needs_review" || data.status === "blocked" ? data.status : "blocked";
}

/** Current campaign + active clone revision gate shared by UI and activation. */
export async function evaluateCurrentMetaPublishPlanReadiness(service: SupabaseServiceClient, plan: MetaPublishPlan) {
  const bindings = plan.creatives.flatMap((creative) => creative.revisionBindings ?? []);
  const creativeIds = [...new Set(bindings.map((binding) => binding.creativeId))];
  const [{ data: connection }, { data: approval }, complianceStatus, creatives, revisions] = await Promise.all([
    service.from("provider_connections").select("status").eq("workspace_id", plan.workspaceId).eq("id", plan.providerConnectionId).maybeSingle(),
    plan.approvalRequestId ? service.from("approval_requests").select("status").eq("workspace_id", plan.workspaceId).eq("id", plan.approvalRequestId).maybeSingle() : Promise.resolve({ data: null }),
    loadMetaPublishPlanComplianceStatus(service, plan),
    creativeIds.length ? service.from("adstudio_creatives").select("id,active_revision_id").eq("workspace_id", plan.workspaceId).in("id", creativeIds) : Promise.resolve({ data: [] }),
    creativeIds.length ? service.from("adstudio_creative_revisions").select("id,creative_id,canvas_json").eq("workspace_id", plan.workspaceId).in("creative_id", creativeIds) : Promise.resolve({ data: [] }),
  ]);
  const readiness = validateMetaPublishPlanReadiness(plan, {
    providerConnectionStatus: connection?.status === "connected" || connection?.status === "needs_attention" ? connection.status : "not_connected",
    approvalStatus: approval?.status === "approved" || approval?.status === "requested" || approval?.status === "rejected" || approval?.status === "cancelled" ? approval.status : "draft",
    complianceStatus,
  });
  const activeByCreative = new Map((creatives.data ?? []).map((creative) => [String(creative.id), creative.active_revision_id ? String(creative.active_revision_id) : null]));
  const revisionById = new Map((revisions.data ?? []).map((revision) => [String(revision.id), revision]));
  const bindingChecks = await Promise.all(bindings.map(async (binding) => {
    if (activeByCreative.get(binding.creativeId) !== binding.revisionId) return true;
    const revision = revisionById.get(binding.revisionId);
    if (!revision || String(revision.creative_id) !== binding.creativeId) return true;
    const asset = await resolveImmutableRevisionAsset(service, plan.workspaceId, binding.creativeId, revision.canvas_json);
    return !sameImmutableCreativeAsset(asset, binding.asset);
  }));
  if (bindings.length === 0 || bindingChecks.some(Boolean)) {
    readiness.blockers.push("A finished clone changed after compliance. Re-run compliance before publishing.");
  }
  return readiness;
}

/**
 * Server-only plan input preparation. It replaces mutable pack canvases with
 * their currently active immutable revisions, rejects foreign/URL assets, and
 * attaches the SHA-256 of the actual stored bytes before compliance is hashed.
 */
export async function prepareImmutableMetaPublishCampaignPack(
  service: SupabaseServiceClient,
  workspaceId: string,
  campaignPack: AdStudioCampaignPack,
  variantIds?: string[],
): Promise<AdStudioCampaignPack> {
  const selectedVariantIds = variantIds?.length ? new Set(variantIds) : null;
  const selectedCreatives = selectedVariantIds
    ? campaignPack.creatives.filter((creative) => selectedVariantIds.has(creative.variantId))
    : campaignPack.creatives;
  const creativeIds = [...new Set(selectedCreatives.map((creative) => creative.creativeId))];
  if (!creativeIds.length) throw new Error("A Meta publish needs at least one finished clone creative.");
  const [{ data: creatives, error: creativesError }, { data: revisions, error: revisionsError }] = await Promise.all([
    service.from("adstudio_creatives").select("id,active_revision_id").eq("workspace_id", workspaceId).in("id", creativeIds),
    service.from("adstudio_creative_revisions").select("id,creative_id,canvas_json").eq("workspace_id", workspaceId).in("creative_id", creativeIds),
  ]);
  if (creativesError || revisionsError) throw new Error(creativesError?.message ?? revisionsError?.message ?? "Unable to load finished clone revisions.");
  const activeByCreative = new Map((creatives ?? []).map((creative) => [String(creative.id), String(creative.active_revision_id ?? "")]));
  const revisionsByKey = new Map((revisions ?? []).map((revision) => [`${revision.creative_id}:${revision.id}`, revision]));

  const preparedById = new Map(await Promise.all(selectedCreatives.map(async (creative) => {
    const revisionId = activeByCreative.get(creative.creativeId);
    const revision = revisionId ? revisionsByKey.get(`${creative.creativeId}:${revisionId}`) : null;
    if (!revision || !revisionId) throw new Error(`Finished clone ${creative.creativeId} has no active immutable revision.`);
    const canvas = structuredClone(revision.canvas_json) as AdStudioCampaignPack["creatives"][number]["canvas"];
    const asset = await resolveImmutableRevisionAsset(service, workspaceId, creative.creativeId, canvas);
    if (!asset?.contentSha256) throw new Error(`Finished clone ${creative.creativeId} has no verifiable image bytes.`);
    const objects = canvas.objects as Array<Record<string, unknown>>;
    const imageObject = objects.find((object) => object.objectId === "template_clone_image")
      ?? objects.find((object) => object.role === "primary_image");
    if (!imageObject) throw new Error(`Finished clone ${creative.creativeId} has no clone image region.`);
    imageObject.contentSha256 = asset.contentSha256;
    return [creative.creativeId, { ...creative, activeRevisionId: revisionId, canvas }] as const;
  })));
  return { ...campaignPack, creatives: campaignPack.creatives.map((creative) => preparedById.get(creative.creativeId) ?? creative) };
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
  if (plan.status !== "queued" && plan.status !== "approved" && plan.status !== "publishing") {
    throw new Error("Meta publish plan must be queued before execution.");
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
          buildMetaInstantFormPayload(providerName, leadForm),
          input.pageAccessToken ?? input.accessToken,
        );
        const formId = requireMetaId(response, "lead form");
        await verifyMetaLeadForm(input, requestLog, responseLog, formId, leadForm, input.pageAccessToken ?? input.accessToken);
        reconciledObjects.leadFormIds[leadForm.localId] = formId;
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
        const response = await postMetaObject(
          input,
          requestLog,
          responseLog,
          `adset.${adSet.localId}`,
          `/${plan.setup.metaAdAccountId}/adsets`,
          buildMetaAdSetPayload(plan, adSet, providerName, reconciledObjects.campaignId),
        );
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
        const storyImageHash = plan.assetFeedEnabled
          ? await resolveStoryCreativeImageHash(plan, creative, input, requestLog, responseLog)
          : null;
        const leadFormId = reconciledObjects.leadFormIds[creative.leadFormLocalId];
        const linkBase = plan.controls.adDestinationUrl?.trim() || plan.setup.privacyPolicyUrl;
        const utmLink = buildUtmLink(linkBase, plan.tracking, creative.localId);
        const response = await postMetaObject(
          input,
          requestLog,
          responseLog,
          `creative.${creative.localId}`,
          `/${plan.setup.metaAdAccountId}/adcreatives`,
          buildMetaCreativePayload({
            name: providerName,
            creative,
            link: utmLink,
            leadFormId,
            imageHash,
            storyImageHash,
            useAssetFeed: plan.assetFeedEnabled,
            creativeFeatures: plan.creativeFeatures,
          }),
        );
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
      status: "paused_ready",
      requestLog,
      responseLog,
      reconciledObjects,
      lastError: null,
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: error instanceof MetaReconciliationRequiredError ? "reconciliation_required" : "failed",
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

async function resolveStoryCreativeImageHash(
  plan: MetaPublishPlan,
  creative: MetaPublishCreativePlan,
  input: MetaPublishExecutionInput,
  requestLog: MetaProviderLogEntry[],
  responseLog: MetaProviderLogEntry[],
): Promise<string | null> {
  const story = creative.formatAssets?.story;
  if (!story) return null;
  if (story.imageHash) return story.imageHash;
  if (story.type !== "image" || story.source !== "inline" || !story.bytesBase64) return null;

  const response = await postMetaObject(
    input,
    requestLog,
    responseLog,
    `asset.${creative.localId}.story`,
    `/${plan.setup.metaAdAccountId}/adimages`,
    { bytes: story.bytesBase64 },
  );
  const imageMap = response.images as Record<string, { hash?: string }> | undefined;
  return imageMap?.[story.filename ?? ""]?.hash
    ?? Object.values(imageMap ?? {})[0]?.hash
    ?? (typeof response.hash === "string" ? response.hash : null);
}

export function buildMetaAssetFeedSpec(feedHash: string, storyHash: string): Record<string, unknown> {
  return {
    images: [
      { hash: feedHash, adlabels: [{ name: "feed_image" }] },
      { hash: storyHash, adlabels: [{ name: "story_image" }] },
    ],
    ad_formats: ["SINGLE_IMAGE"],
    optimization_type: "PLACEMENT",
    asset_customization_rules: [
      {
        customization_spec: {
          publisher_platforms: ["facebook", "instagram"],
          facebook_positions: ["feed", "marketplace", "video_feeds", "search"],
          instagram_positions: ["stream", "profile_feed", "ig_search"],
        },
        image_label: { name: "feed_image" },
        priority: 1,
      },
      {
        customization_spec: {
          publisher_platforms: ["facebook", "instagram"],
          facebook_positions: ["story"],
          instagram_positions: ["story"],
        },
        image_label: { name: "story_image" },
        priority: 2,
      },
    ],
  };
}

export function buildMetaCreativePayload(input: {
  name: string;
  creative: Pick<MetaPublishCreativePlan, "pageId" | "instagramActorId" | "primaryText" | "headline" | "description" | "cta">;
  link: string;
  leadFormId: string | undefined;
  imageHash: string | null;
  storyImageHash: string | null;
  useAssetFeed: boolean;
  creativeFeatures: Partial<Record<MetaCreativeFeatureKey, "OPT_IN" | "OPT_OUT">>;
}): Record<string, unknown> {
  const useAssetFeed = input.useAssetFeed && Boolean(input.imageHash && input.storyImageHash);
  return {
    name: input.name,
    object_story_spec: {
      page_id: input.creative.pageId,
      ...(input.creative.instagramActorId ? { instagram_user_id: input.creative.instagramActorId } : {}),
      link_data: {
        message: input.creative.primaryText,
        name: input.creative.headline,
        description: input.creative.description,
        link: input.link,
        ...(input.imageHash ? { image_hash: input.imageHash } : {}),
        call_to_action: {
          type: input.creative.cta,
          value: { lead_gen_form_id: input.leadFormId },
        },
      },
    },
    ...(useAssetFeed ? { asset_feed_spec: buildMetaAssetFeedSpec(input.imageHash!, input.storyImageHash!) } : {}),
    ...buildDegreesOfFreedomSpec(input.creativeFeatures),
  };
}

export function buildMetaInstantFormPayload(name: string, form: MetaPublishLeadFormPlan): Record<string, unknown> {
  return {
    name,
    locale: "en_AU",
    context_card: { title: form.headline, content: [form.intro], style: "PARAGRAPH_STYLE" },
    question_page_custom_headline: form.headline,
    follow_up_action_url: form.thankYouWebsiteUrl,
    privacy_policy: { url: form.privacyPolicyUrl, link_text: "Privacy Policy" },
    is_optimized_for_quality: true,
    questions: [
      ...form.contactFields.map((type) => ({ type, key: type.toLowerCase() })),
      ...form.customQuestions.map((question, index) => ({ type: "CUSTOM", key: `custom_${index + 1}`, label: question })),
    ],
    thank_you_page: {
      title: form.thankYouTitle,
      body: form.thankYouBody,
      button_text: form.thankYouButtonText,
      button_type: form.thankYouButtonType,
      website_url: form.thankYouWebsiteUrl,
    },
  };
}

export function buildMetaAdSetPayload(
  plan: MetaPublishPlan,
  adSet: MetaPublishAdSetPlan,
  name: string,
  campaignId: string | undefined,
): Record<string, unknown> {
  return {
    name,
    campaign_id: campaignId,
    billing_event: adSet.billingEvent,
    optimization_goal: adSet.optimizationGoal,
    destination_type: "ON_AD",
    promoted_object: { page_id: plan.setup.pageId },
    targeting: adSet.targeting,
    targeting_automation: { advantage_audience: 1 },
    status: "PAUSED",
    ...(plan.campaign.budgetMode === "adset"
      ? { bid_strategy: META_LOWEST_COST_BID_STRATEGY, daily_budget: String(adSet.dailyBudgetMinorUnits) }
      : {}),
    ...(adSet.startTime ? { start_time: adSet.startTime } : {}),
    ...(adSet.endTime ? { end_time: adSet.endTime } : {}),
  };
}

function buildDegreesOfFreedomSpec(
  configured: Partial<Record<MetaCreativeFeatureKey, "OPT_IN" | "OPT_OUT">>,
): Record<string, unknown> {
  return {
    degrees_of_freedom_spec: {
      creative_features_spec: Object.fromEntries(
        META_CREATIVE_FEATURE_KEYS.map((key) => [key, { enroll_status: configured[key] ?? "OPT_OUT" }]),
      ),
    },
  };
}

async function verifyMetaLeadForm(
  input: MetaPublishExecutionInput,
  requestLog: MetaProviderLogEntry[],
  responseLog: MetaProviderLogEntry[],
  formId: string,
  expected: MetaPublishLeadFormPlan,
  accessToken: string,
) {
  const step = `lead_form.${expected.localId}.verify`;
  const path = `/${formId}?fields=id,name,questions,privacy_policy,thank_you_page,context_card,question_page_custom_headline,follow_up_action_url`;
  const createdAt = new Date().toISOString();
  requestLog.push({ step, method: "GET", path, createdAt });
  const response = await (input.fetchImpl ?? fetch)(
    `https://graph.facebook.com/${input.graphVersion ?? DEFAULT_META_GRAPH_VERSION}${path}`,
    { method: "GET", headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000) },
  );
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  responseLog.push({ step, method: "GET", path, response: payload, status: response.status, createdAt: new Date().toISOString() });
  if (!response.ok) throw new Error(metaProviderErrorMessage(payload, `Meta lead form read-back failed with ${response.status}.`));

  const serialized = JSON.stringify(payload);
  const expectedValues = [expected.headline, expected.intro, expected.privacyPolicyUrl, expected.thankYouTitle, expected.thankYouBody, expected.thankYouWebsiteUrl, ...expected.customQuestions]
    .filter(Boolean);
  if (expectedValues.some((value) => !serialized.includes(value))) {
    throw new MetaReconciliationRequiredError("Meta did not read back the requested Instant Form fields exactly; the paused campaign was not created.");
  }
}

class MetaReconciliationRequiredError extends Error {}

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
  return [{
    localId: "adset_primary",
    name: `${suburb} homeowners`,
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

function unsupportedMetaPlacementPositions(targeting: Record<string, unknown>): string[] {
  const instagramPositions = Array.isArray(targeting.instagram_positions)
    ? targeting.instagram_positions.filter((value): value is string => typeof value === "string")
    : [];
  return instagramPositions.filter((position) => position === "explore" || position === "explore_home");
}

function buildLeadFormPlans(pack: AdStudioCampaignPack, setup: MetaConnectionSetup, completionUrl?: string): MetaPublishLeadFormPlan[] {
  return pack.copyPacks.slice(0, 6).map((copy, index) => {
    const defaults: MetaLeadFormDefaults = {
    headline: copy.meta.leadForm.headline,
    intro: copy.meta.primaryText[0] ?? copy.meta.leadForm.headline,
    contactFields: ["FIRST_NAME", "LAST_NAME", "EMAIL", "PHONE"],
    customQuestions: copy.meta.leadForm.questions.slice(0, 5),
    thankYouTitle: copy.meta.leadForm.thankYouScreen.title,
    thankYouBody: copy.meta.leadForm.thankYouScreen.body,
    thankYouButtonType: "VIEW_WEBSITE",
    thankYouButtonText: "Visit website",
    };
    return {
      localId: `form_${index + 1}`,
      name: `${pack.campaign.market.suburb} ${copy.meta.leadForm.headline}`,
      ...buildMetaInstantFormSpec(defaults, {
        privacyPolicyUrl: setup.privacyPolicyUrl,
        formCompletionUrl: completionUrl ?? setup.privacyPolicyUrl,
      }),
      questions: copy.meta.leadForm.questions.slice(0, 5),
    };
  });
}

function buildCreativePlans(pack: AdStudioCampaignPack, setup: MetaConnectionSetup): MetaPublishCreativePlan[] {
  return pack.copyPacks.slice(0, 6).map((copy, index) => {
    const variantCreatives = pack.creatives.filter((item) => item.variantId === copy.variantId);
    const feedCreative = variantCreatives.find((item) => item.format === "4:5")
      ?? variantCreatives.find((item) => item.format !== "9:16")
      ?? null;
    const storyCreative = variantCreatives.find((item) => item.format === "9:16") ?? null;
    const creative = feedCreative ?? storyCreative ?? pack.creatives[index] ?? null;
    const feedAsset = feedCreative ? buildCreativeImageAsset(feedCreative) : null;
    const storyAsset = storyCreative ? buildCreativeImageAsset(storyCreative) : null;
    const revisionBindings = [
      feedCreative && feedAsset && feedCreative.activeRevisionId ? {
        placement: "feed" as const, creativeId: feedCreative.creativeId, revisionId: feedCreative.activeRevisionId,
        format: feedCreative.format, asset: feedAsset,
      } : null,
      storyCreative && storyAsset && storyCreative.activeRevisionId ? {
        placement: "story" as const, creativeId: storyCreative.creativeId, revisionId: storyCreative.activeRevisionId,
        format: storyCreative.format, asset: storyAsset,
      } : null,
    ].filter((binding): binding is NonNullable<typeof binding> => Boolean(binding));

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
      adStudioCreativeId: feedCreative?.creativeId ?? creative?.creativeId ?? null,
      adStudioCreativeRevisionId: feedCreative?.activeRevisionId ?? creative?.activeRevisionId ?? null,
      format: creative?.format ?? null,
      asset: feedAsset,
      formatAssets: { feed: feedAsset, story: storyAsset },
      revisionBindings,
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
  return buildCreativeImageAssetFromCanvas(creative.creativeId, creative.canvas);
}

function buildCreativeImageAssetFromCanvas(creativeId: string, canvas: unknown): MetaCreativeAssetPlan | null {
  const objects = canvas && typeof canvas === "object" && Array.isArray((canvas as { objects?: unknown }).objects)
    ? (canvas as { objects: Array<{ objectId?: unknown; role?: unknown; content?: unknown; assetId?: unknown; contentSha256?: unknown }> }).objects
    : [];
  const imageObject = objects.find((object) => object.objectId === "template_clone_image")
    ?? objects.find((object) => object.role === "primary_image");
  const reference = typeof imageObject?.content === "string" && imageObject.content.trim()
    ? imageObject.content.trim()
    : typeof imageObject?.assetId === "string" ? imageObject.assetId.trim() : "";

  if (!reference) return null;

  const dataUrlMatch = reference.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    return {
      type: "image",
      source: "inline",
      mimeType: dataUrlMatch[1],
      filename: `${creativeId}.${dataUrlMatch[1] === "image/jpeg" ? "jpg" : "png"}`,
      bytesBase64: dataUrlMatch[2],
      contentSha256: createHash("sha256").update(Buffer.from(dataUrlMatch[2], "base64")).digest("hex"),
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
    filename: `${creativeId}.png`,
    storagePath,
    ...(typeof imageObject?.contentSha256 === "string" && /^[a-f0-9]{64}$/i.test(imageObject.contentSha256)
      ? { contentSha256: imageObject.contentSha256.toLowerCase() }
      : {}),
  };
}

async function resolveImmutableRevisionAsset(
  service: SupabaseServiceClient,
  workspaceId: string,
  creativeId: string,
  canvas: unknown,
): Promise<MetaCreativeAssetPlan | null> {
  const asset = buildCreativeImageAssetFromCanvas(creativeId, canvas);
  if (!asset) return null;
  if (asset.source === "inline") return asset.contentSha256 ? asset : null;
  if (asset.source !== "storage" || !asset.storagePath || !isWorkspaceArtifactPath(workspaceId, asset.storagePath)) return null;
  const { data, error } = await service.storage.from("workspace-artifacts").download(asset.storagePath);
  if (error || !data) return null;
  const bytes = Buffer.from(await data.arrayBuffer());
  if (!bytes.length) return null;
  const mimeType = data.type && data.type.startsWith("image/") ? data.type : asset.mimeType;
  if (!mimeType?.startsWith("image/")) return null;
  return {
    ...asset,
    mimeType,
    contentSha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function isWorkspaceArtifactPath(workspaceId: string, storagePath: string): boolean {
  return storagePath.startsWith(`${workspaceId}/`) && !storagePath.includes("..") && !storagePath.startsWith("/");
}

function sameImmutableCreativeAsset(current: MetaCreativeAssetPlan | null, expected: MetaCreativeAssetPlan): boolean {
  if (!current) return false;
  return current.source === expected.source
    && current.storagePath === expected.storagePath
    && current.url === expected.url
    && current.contentSha256 === expected.contentSha256
    && current.mimeType === expected.mimeType;
}

function hasUsableCreativeImage(creative: MetaPublishCreativePlan): boolean {
  const asset = creative.asset;
  if (!asset) return false;

  return Boolean(asset.imageHash || asset.bytesBase64 || (asset.source === "storage" && asset.storagePath));
}

function hasImmutableCreativeContent(creative: MetaPublishCreativePlan): boolean {
  const hasHash = (asset: MetaCreativeAssetPlan | null | undefined) =>
    Boolean(asset?.contentSha256 && /^[a-f0-9]{64}$/i.test(asset.contentSha256));
  if (!hasHash(creative.asset)) return false;
  if (!creative.formatAssets) return true;
  return hasHash(creative.formatAssets.feed) && (!creative.formatAssets.story || hasHash(creative.formatAssets.story));
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function buildAdPlans(pack: AdStudioCampaignPack): MetaPublishAdPlan[] {
  return pack.copyPacks.slice(0, 6).map((copy, index) => {
    const variant = pack.variants.find((item) => item.variantId === copy.variantId) ?? null;
    const variantTag: MetaAdVariantTag | null = variant
      ? { variantId: variant.variantId, angle: variant.angle, template: pack.campaign.templateKey ?? pack.campaign.offerId ?? null }
      : null;

    return {
      localId: `ad_${index + 1}`,
      name: `${pack.campaign.name} ad ${index + 1}${variantTag ? buildAdVariantTagSuffix(variantTag) : ""}`,
      adSetLocalId: "adset_primary",
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
  const legacyDestinationUrl = controls?.destinationUrl?.trim();
  const adDestinationUrl = controls?.adDestinationUrl?.trim() ?? legacyDestinationUrl;
  const formCompletionUrl = controls?.formCompletionUrl?.trim() ?? legacyDestinationUrl;

  return {
    dailyBudgetMinorUnits: controls?.dailyBudgetMinorUnits && controls.dailyBudgetMinorUnits > 0
      ? Math.round(controls.dailyBudgetMinorUnits)
      : 2000,
    ...(adDestinationUrl && isHttpUrl(adDestinationUrl) ? { adDestinationUrl, destinationUrl: adDestinationUrl } : {}),
    ...(formCompletionUrl && isHttpUrl(formCompletionUrl) ? { formCompletionUrl } : {}),
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

function normalizePersistedMetaPublishStatus(status: string): MetaPublishPlanStatus {
  // The migration rewrites these values, but mapping here keeps a deployment
  // safe when application code reaches a replica before the migration.
  if (status === "approved") return "queued";
  if (status === "paused_live") return "paused_ready";
  return ["draft", "validating", "queued", "publishing", "paused_ready", "activating", "live", "failed", "reconciliation_required"].includes(status)
    ? status as MetaPublishPlanStatus
    : "reconciliation_required";
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
    complianceReportId: plan.complianceReportId,
    complianceSubjectHash: plan.complianceSubjectHash,
    complianceCheckedAt: plan.complianceCheckedAt,
    controls: plan.controls,
    creativeFeatures: plan.creativeFeatures,
    assetFeedEnabled: plan.assetFeedEnabled,
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
    complianceReportId?: string | null;
    complianceSubjectHash?: string;
    complianceCheckedAt?: string | null;
    controls?: MetaPublishControls;
    creativeFeatures?: Partial<Record<MetaCreativeFeatureKey, "OPT_IN" | "OPT_OUT">>;
    assetFeedEnabled?: boolean;
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
    status: normalizePersistedMetaPublishStatus(row.status),
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
    leadForms: (planJson.leadForms ?? []).map(normalizeMetaLeadFormPlan),
    creatives: planJson.creatives ?? [],
    ads: planJson.ads ?? [],
    tracking: planJson.tracking ?? {
      utmSource: "meta",
      utmMedium: "paid_social",
      utmCampaign: "meta-campaign",
      utmContentPrefix: "meta",
    },
    complianceReportId: planJson.complianceReportId ?? null,
    // Old plans do not have a compliant immutable binding and must fail closed.
    complianceSubjectHash: planJson.complianceSubjectHash ?? "",
    complianceCheckedAt: planJson.complianceCheckedAt ?? null,
    creativeFeatures: planJson.creativeFeatures ?? buildDefaultMetaCreativeFeatures(),
    assetFeedEnabled: planJson.assetFeedEnabled === true,
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

function normalizeMetaLeadFormPlan(form: MetaPublishLeadFormPlan): MetaPublishLeadFormPlan {
  return {
    ...form,
    intro: form.intro ?? form.headline,
    contactFields: form.contactFields?.length ? form.contactFields : ["FIRST_NAME", "LAST_NAME", "EMAIL", "PHONE"],
    customQuestions: form.customQuestions ?? form.questions ?? [],
    questions: form.questions ?? form.customQuestions ?? [],
    thankYouButtonType: form.thankYouButtonType ?? "VIEW_WEBSITE",
    thankYouButtonText: form.thankYouButtonText ?? "Visit website",
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
