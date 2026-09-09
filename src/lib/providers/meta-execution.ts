import { createHash } from "node:crypto";

import type { AdStudioCampaignPack } from "../adstudio/index.ts";
import { normalizeLeadFormQuestions } from "../adstudio/default-lead-forms.ts";
import { deterministicUuid } from "../adstudio/id.ts";
import type { AdStudioComplianceReport } from "../adstudio/types.ts";
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
  variantIds?: Array<"feed" | "story">;
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
  /** SHA-256 of the exact finished bytes. Required before compliance/publish. */
  contentSha256?: string;
  /** Meta's uploaded image hash is transport metadata, not compliance proof. */
  imageHash?: string;
  videoId?: string;
  /** Optional poster supplied for a video_data creative. */
  posterUrl?: string;
  posterPath?: string;
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
  fulfilment?: MetaOfferFulfilment;
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
  if (!isHttpsUrl(form.privacyPolicyUrl) || !isHttpsUrl(form.thankYouWebsiteUrl)) {
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

export type MetaReconciledObjectProvenance = "created" | "adopted";

export type MetaReconciledObjects = {
  campaignId?: string;
  /** Provider objects with a durable successful create response recorded by this plan. */
  ownedCampaignId?: string;
  leadFormIds: Record<string, string>;
  adSetIds: Record<string, string>;
  ownedAdSetIds?: Record<string, string>;
  creativeIds: Record<string, string>;
  adIds: Record<string, string>;
  ownedAdIds?: Record<string, string>;
  /** Exact-name recovery is adoption, not proof that Blockwise created the object. */
  provenance?: {
    campaign?: MetaReconciledObjectProvenance;
    adSets?: Record<string, MetaReconciledObjectProvenance>;
    ads?: Record<string, MetaReconciledObjectProvenance>;
  };
  objectStatuses?: {
    campaign?: MetaReconciledObjectStatus;
    adSets?: Record<string, MetaReconciledObjectStatus>;
    ads?: Record<string, MetaReconciledObjectStatus>;
  };
  /**
   * A source-free Graph read-back captured immediately before paused_ready.
   * It binds the Meta image hashes and Instant Form ids to the immutable
   * revision hashes in this plan; it deliberately contains no bytes, storage
   * paths, URLs, or provider tokens.
   */
  pausedReadbackEvidence?: MetaPausedReadbackEvidence;
};

export type MetaPausedCreativeAssetEvidence = {
  placement: "feed" | "story";
  creativeId: string;
  revisionId: string;
  contentSha256: string;
  providerImageHash: string;
};

export type MetaPausedCreativeEvidence = {
  providerCreativeId: string;
  leadFormProviderId: string;
  feed: MetaPausedCreativeAssetEvidence;
  story: MetaPausedCreativeAssetEvidence;
};

export type MetaPausedReadbackEvidence = {
  verifiedAt: string;
  complianceSubjectHash: string;
  campaign: MetaReconciledObjectStatus;
  adSets: Record<string, MetaReconciledObjectStatus>;
  ads: Record<string, MetaReconciledObjectStatus>;
  creatives: Record<string, MetaPausedCreativeEvidence>;
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
  adStudioCampaignId: string | null;
  customerAdId: string | null;
  adStudioExportId: string | null;
  legacyCampaignId: string | null;
  providerConnectionId: string;
  approvalRequestId: string | null;
  publicationSnapshotId?: string | null;
  source?: {
    snapshotId: string;
    creativeRevision: number | null;
    documentHash: string | null;
    feedPngHash: string | null;
    storyPngHash: string | null;
    formDraftId: string | null;
    formRevision: number | null;
  } | null;
  adapter: MetaExecutionAdapter;
  status: MetaPublishPlanStatus;
  idempotencyKey: string;
  /** Immutable cutover identity. Unmarked plans are legacy and cannot activate. */
  publishContractVersion: "finished_clone_v1" | null;
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
      leadForms: input.leadForms.map(({ privacyPolicyUrl: _privacy, thankYouWebsiteUrl: _completion, name: _name, ...authoredContent }) => authoredContent),
      ads: input.ads,
      tracking: input.tracking,
    })))
    .digest("hex");
}

export async function bindMetaPublishPlanComplianceReport(
  service: SupabaseServiceClient,
  plan: Pick<MetaPublishPlan, "workspaceId" | "adStudioCampaignId" | "complianceReportId" | "complianceSubjectHash">,
  review: Pick<AdStudioComplianceReport, "status" | "issues" | "checkedAt">,
): Promise<void> {
  if (!plan.complianceReportId || !/^[a-f0-9]{64}$/i.test(plan.complianceSubjectHash)) {
    throw new Error("Exact Meta publish compliance could not be bound to this plan.");
  }

  const { data, error } = await (service as any).rpc("adstudio_bind_publish_compliance", {
    p_workspace_id: plan.workspaceId,
    p_campaign_id: plan.adStudioCampaignId,
    p_report_id: plan.complianceReportId,
    p_subject_hash: plan.complianceSubjectHash,
    p_status: review.status,
    p_issues_json: review.issues,
    p_checked_at: review.checkedAt,
  });
  const bound = Array.isArray(data) ? data[0] : data;
  if (
    error || !bound || bound.report_id !== plan.complianceReportId ||
    bound.campaign_id !== plan.adStudioCampaignId || bound.workspace_id !== plan.workspaceId ||
    bound.subject_hash !== plan.complianceSubjectHash || bound.status !== review.status ||
    JSON.stringify(bound.issues_json) !== JSON.stringify(review.issues) ||
    new Date(bound.checked_at).getTime() !== new Date(review.checkedAt).getTime()
  ) {
    throw new Error(error?.message ?? "Exact Meta publish compliance could not be bound to this plan.");
  }
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
  const leadForms = buildLeadFormPlans(campaignPack, setup, controls.formCompletionUrl);
  const creatives = buildCreativePlans(campaignPack, setup);
  const ads = buildAdPlans(campaignPack, adSets);
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
    customerAdId: null,
    adStudioExportId: input.adStudioExportId ?? null,
    legacyCampaignId: input.legacyCampaignId ?? null,
    providerConnectionId: input.connectionId,
    approvalRequestId: input.approvalRequestId ?? null,
    publicationSnapshotId: null,
    adapter,
    status: "draft",
    idempotencyKey,
    publishContractVersion: "finished_clone_v1",
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

  const adAccountId = setup.metaAdAccountId.trim();
  if (!adAccountId) {
    blockers.push("Meta ad account is not configured.");
  } else if (!/^(act_)?\d+$/i.test(adAccountId)) {
    // Legacy connections can carry the "meta_account_pending" sentinel as the
    // external account id; publishing against it would hit the Graph API with
    // /act_meta_account_pending/... and fail with a raw provider error.
    blockers.push("Meta ad account is not configured.");
  }
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
  if (plan.publishContractVersion !== "finished_clone_v1") {
    blockers.push("This Meta publish plan predates the finished clone contract and cannot be activated.");
  }
  if (!plan.assetFeedEnabled) {
    blockers.push("Each selected creative needs an exact 4:5 Feed and 9:16 Story asset feed before Meta publish.");
  }

  if (plan.adapter === "marketing_api" && plan.creatives.some((creative) => !hasUsableCreativeMedia(creative))) {
    blockers.push(plan.creatives.some((creative) => creative.asset?.type === "video")
      ? "The finished ad media could not be found or has not been validated for one or more creatives."
      : "The finished ad image could not be found for one or more creatives.");
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
 * Activation is deliberately targetless at the API boundary. These IDs are
 * derived from the authenticated plan after its workspace-scoped DB read; a
 * browser must never nominate a Meta object, even one it already knows.
 */
export function deriveExactMetaActivationPayload(plan: MetaPublishPlan): {
  campaignId: string;
  adSetIds: string[];
  adIds: string[];
  adSetBudgets?: Array<{ adSetId: string; dailyBudgetMinorUnits: number }>;
} {
  const campaignId = requiredReconciledId(plan.reconciledObjects.campaignId, "campaign");
  const adSetIds = exactReconciledIds(plan.adSets.map((adSet) => adSet.localId), plan.reconciledObjects.adSetIds, "ad set");
  const adIds = exactReconciledIds(plan.ads.map((ad) => ad.localId), plan.reconciledObjects.adIds, "ad");
  const allIds = [campaignId, ...adSetIds, ...adIds];
  if (new Set(allIds).size !== allIds.length) {
    throw new Error("Meta publish plan has duplicate reconciled object IDs; activation is blocked.");
  }

  return {
    campaignId,
    adSetIds,
    adIds,
    ...(plan.campaign.budgetMode === "adset" ? {
      adSetBudgets: plan.adSets.map((adSet, index) => ({
        adSetId: adSetIds[index]!,
        dailyBudgetMinorUnits: adSet.dailyBudgetMinorUnits,
      })),
    } : {}),
  };
}

/** Reject all caller-supplied provider targets, including matching IDs. */
export function activationPayloadSuppliesProviderTargets(payload: Record<string, unknown> | null | undefined): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  return ["campaignId", "adSetIds", "adIds", "adSetBudgets"].some((key) => Object.prototype.hasOwnProperty.call(payload, key));
}

function requiredReconciledId(value: string | undefined, label: string): string {
  const id = value?.trim();
  if (!id) throw new Error(`Meta publish plan has no reconciled ${label} ID; activation is blocked.`);
  return id;
}

function exactReconciledIds(expectedLocalIds: string[], actual: Record<string, string>, label: string): string[] {
  const expected = new Set(expectedLocalIds);
  const actualKeys = Object.keys(actual);
  if (actualKeys.length !== expected.size || actualKeys.some((localId) => !expected.has(localId))) {
    throw new Error(`Meta publish plan has an incomplete or extra reconciled ${label}; activation is blocked.`);
  }
  return expectedLocalIds.map((localId) => requiredReconciledId(actual[localId], label));
}

/**
 * Evidence is current only when it proves this exact immutable plan and the
 * complete current reconciliation set. A stale, partial, or source-bearing
 * record cannot authorize spend.
 */
export function pausedReadbackEvidenceBlocker(plan: MetaPublishPlan): string | null {
  const evidence = plan.reconciledObjects.pausedReadbackEvidence;
  if (!evidence) return "Meta PAUSED provider read-back evidence is missing.";
  if (evidence.complianceSubjectHash !== plan.complianceSubjectHash) {
    return "Meta PAUSED provider read-back evidence is stale for this immutable plan.";
  }
  try {
    const targets = deriveExactMetaActivationPayload(plan);
    if (!samePausedStatus(evidence.campaign, "campaign") || evidence.campaign.id !== targets.campaignId) {
      return "Meta PAUSED campaign evidence is incomplete or no longer exact.";
    }
    if (!sameExactStatusEvidence(plan.adSets.map((item) => item.localId), plan.reconciledObjects.adSetIds, evidence.adSets, "adset")) {
      return "Meta PAUSED ad set evidence is incomplete or no longer exact.";
    }
    if (!sameExactStatusEvidence(plan.ads.map((item) => item.localId), plan.reconciledObjects.adIds, evidence.ads, "ad")) {
      return "Meta PAUSED ad evidence is incomplete or no longer exact.";
    }
    for (const creative of plan.creatives) {
      const observed = evidence.creatives[creative.localId];
      const providerCreativeId = plan.reconciledObjects.creativeIds[creative.localId];
      const leadFormProviderId = plan.reconciledObjects.leadFormIds[creative.leadFormLocalId];
      if (!observed || observed.providerCreativeId !== providerCreativeId || observed.leadFormProviderId !== leadFormProviderId) {
        return "Meta creative provider read-back evidence is incomplete or no longer exact.";
      }
      if (!sameCreativeBindingEvidence(creative, observed.feed, "feed") || !sameCreativeBindingEvidence(creative, observed.story, "story")) {
        return "Meta creative asset-feed evidence no longer matches the immutable finished clones.";
      }
    }
  } catch (error) {
    return error instanceof Error ? error.message : "Meta PAUSED provider read-back evidence is invalid.";
  }
  return null;
}

function sameExactStatusEvidence(
  localIds: string[],
  reconciled: Record<string, string>,
  evidence: Record<string, MetaReconciledObjectStatus>,
  kind: "adset" | "ad",
): boolean {
  const keys = Object.keys(evidence);
  return keys.length === localIds.length && localIds.every((localId) =>
    evidence[localId]?.id === reconciled[localId] && samePausedStatus(evidence[localId]!, kind));
}

function samePausedStatus(status: MetaReconciledObjectStatus, kind: "campaign" | "adset" | "ad"): boolean {
  const effective = normalizedProviderStatus(status.effectiveStatus);
  const allowedEffective = kind === "campaign"
    ? ["PAUSED"]
    : kind === "adset"
      ? ["PAUSED", "CAMPAIGN_PAUSED"]
      : ["PAUSED", "ADSET_PAUSED", "CAMPAIGN_PAUSED"];
  return normalizedProviderStatus(status.configuredStatus) === "PAUSED" && Boolean(effective && allowedEffective.includes(effective));
}

function normalizedProviderStatus(value: unknown): string | null {
  const status = optionalString(value);
  return status ? status.toUpperCase() : null;
}

function sameCreativeBindingEvidence(
  creative: MetaPublishCreativePlan,
  evidence: MetaPausedCreativeAssetEvidence,
  placement: "feed" | "story",
): boolean {
  const binding = creative.revisionBindings.find((item) => item.placement === placement);
  return Boolean(
    binding && binding.format === (placement === "feed" ? "4:5" : "9:16") &&
    evidence.placement === placement && evidence.creativeId === binding.creativeId &&
    evidence.revisionId === binding.revisionId && evidence.contentSha256 === binding.asset.contentSha256 &&
    /^[a-zA-Z0-9_-]+$/.test(evidence.providerImageHash),
  );
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

/**
 * Last server-owned gate before a queued plan may touch Meta. It verifies the
 * exact report binding, approval, connection, and current immutable revisions,
 * but intentionally does not require PAUSED provider evidence that can only
 * exist after creation.
 */
export async function evaluateMetaPublishPlanPreProviderReadiness(service: SupabaseServiceClient, plan: MetaPublishPlan) {
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
  const pausedEvidenceBlocker = pausedReadbackEvidenceBlocker(plan);
  if (pausedEvidenceBlocker) readiness.blockers.push(pausedEvidenceBlocker);
  return readiness;
}

/** Current campaign + active clone revision gate shared by UI and activation. */
export async function evaluateCurrentMetaPublishPlanReadiness(service: SupabaseServiceClient, plan: MetaPublishPlan) {
  const readiness = await evaluateMetaPublishPlanPreProviderReadiness(service, plan);
  const pausedEvidenceBlocker = pausedReadbackEvidenceBlocker(plan);
  if (pausedEvidenceBlocker) readiness.blockers.push(pausedEvidenceBlocker);
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

export async function persistMetaPublishPlan(
  serviceSupabase: SupabaseServiceClient,
  plan: MetaPublishPlan,
  userId: string,
): Promise<{ id: string; status: MetaPublishPlanStatus; idempotency_key: string }> {
  const { data, error } = await serviceSupabase
    .from("meta_publish_plans")
    .insert(planToRow(plan, userId))
    .select("id,status,idempotency_key")
    .single();

  if (!error && data) return data as { id: string; status: MetaPublishPlanStatus; idempotency_key: string };

  // A retry must adopt the canonical row. Never replace its logs, progress, or
  // reconciliation state with the newly-built draft.
  if (error?.code === "23505") {
    const canonical = await loadMetaPublishPlanByIdempotencyKey(serviceSupabase, {
      workspaceId: plan.workspaceId,
      idempotencyKey: plan.idempotencyKey,
    });
    if (canonical) {
      return { id: canonical.planId, status: canonical.status, idempotency_key: canonical.idempotencyKey };
    }
  }

  throw new Error(error?.message ?? "Unable to persist Meta publish plan.");
}

export type MetaActivationMutationIds = { mutationId: string; approvalRequestId: string };

/** Service-role-only atomic activation mutation/approval creation and recovery. */
export async function ensureMetaActivationMutation(
  serviceSupabase: SupabaseServiceClient,
  input: { workspaceId: string; planId: string; clientMutationKey: string; planFingerprint: string; requestedBy: string },
): Promise<MetaActivationMutationIds> {
  const { data, error } = await serviceSupabase.rpc("ensure_meta_activation_mutation", {
    p_workspace_id: input.workspaceId,
    p_plan_id: input.planId,
    p_client_mutation_key: input.clientMutationKey,
    p_plan_fingerprint: input.planFingerprint,
    p_requested_by: input.requestedBy,
  });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (typeof row?.mutation_id !== "string" || typeof row.approval_request_id !== "string") throw new Error("Activation mutation RPC returned an invalid result.");
  return { mutationId: row.mutation_id, approvalRequestId: row.approval_request_id };
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
  const { data, error } = await serviceSupabase
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
    .eq("id", plan.planId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) throw new Error("Meta publish plan was not found for this workspace.");
}

export type MetaPublishExecutionLease = {
  claimed: boolean;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
};

/** Service-role-only claim. A false result means another unexpired executor owns it. */
export async function claimMetaPublishExecution(
  serviceSupabase: SupabaseServiceClient,
  input: { workspaceId: string; planId: string; leaseSeconds?: number },
): Promise<MetaPublishExecutionLease> {
  const { data, error } = await serviceSupabase.rpc("claim_meta_publish_execution", {
    p_workspace_id: input.workspaceId,
    p_plan_id: input.planId,
    p_lease_seconds: input.leaseSeconds ?? 600,
  });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  return { claimed: row?.claimed === true, leaseToken: typeof row?.lease_token === "string" ? row.lease_token : null, leaseExpiresAt: typeof row?.lease_expires_at === "string" ? row.lease_expires_at : null };
}

export async function renewMetaPublishExecutionLease(
  serviceSupabase: SupabaseServiceClient,
  input: { workspaceId: string; planId: string; leaseToken: string; leaseSeconds?: number },
): Promise<boolean> {
  const { data, error } = await serviceSupabase.rpc("renew_meta_publish_execution", { p_workspace_id: input.workspaceId, p_plan_id: input.planId, p_lease_token: input.leaseToken, p_lease_seconds: input.leaseSeconds ?? 600 });
  if (error) throw new Error(error.message);
  return data === true || (Array.isArray(data) && data[0]?.renewed === true);
}

export async function releaseMetaPublishExecutionLease(serviceSupabase: SupabaseServiceClient, input: { workspaceId: string; planId: string; leaseToken: string }): Promise<boolean> {
  const { data, error } = await serviceSupabase.rpc("release_meta_publish_execution", { p_workspace_id: input.workspaceId, p_plan_id: input.planId, p_lease_token: input.leaseToken });
  if (error) throw new Error(error.message);
  return data === true || (Array.isArray(data) && data[0]?.released === true);
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
    ownedAdSetIds: { ...(plan.reconciledObjects.ownedAdSetIds ?? {}) },
    creativeIds: { ...plan.reconciledObjects.creativeIds },
    adIds: { ...plan.reconciledObjects.adIds },
    ownedAdIds: { ...(plan.reconciledObjects.ownedAdIds ?? {}) },
    provenance: {
      ...(plan.reconciledObjects.provenance ?? {}),
      adSets: { ...(plan.reconciledObjects.provenance?.adSets ?? {}) },
      ads: { ...(plan.reconciledObjects.provenance?.ads ?? {}) },
    },
  };
  const expectedCreativeAssets: Record<string, { feedImageHash: string; storyImageHash: string }> = {};

  synchronizeMetaCreationEvidence(plan, requestLog, responseLog, reconciledObjects);

  synchronizeMetaCreationEvidence(plan, requestLog, responseLog, reconciledObjects);

  try {
    const destinationUrl = plan.controls.destinationUrl?.trim();
    if (!destinationUrl || !isHttpsDestination(destinationUrl)) {
      throw new Error("Publish plan is missing a valid HTTPS destination URL.");
    }
    // The live account, Page and every reused parent are authoritative. This
    // entire preflight is GET-only and completes before the first Meta POST.
    const parentPreflight = await preflightMetaPublishParents(
      plan,
      input,
      requestLog,
      responseLog,
      reconciledObjects,
    );
    await preflightAdoptedMetaDeliveryObjects(
      plan,
      input,
      requestLog,
      responseLog,
      reconciledObjects,
      parentPreflight.campaignBudgetMode,
    );

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
        await assertAdoptedMetaCampaignMatchesPlan(
          plan,
          input,
          requestLog,
          responseLog,
          existingId,
          parentPreflight.campaignBudgetMode,
          "campaign.reconcile_missing.validate",
        );
        reconciledObjects.campaignId = existingId;
        reconciledObjects.provenance!.campaign = "adopted";
        delete reconciledObjects.ownedCampaignId;
      } else {
        const response = await postMetaObject(input, requestLog, responseLog, "campaign.create", `/${plan.setup.metaAdAccountId}/campaigns`, {
          name: providerName,
          objective: plan.campaign.objective,
          status: "PAUSED",
          special_ad_categories: plan.campaign.specialAdCategories,
          special_ad_category_country: plan.campaign.specialAdCategoryCountries,
          ...(parentPreflight.campaignBudgetMode === "campaign"
            ? {
                bid_strategy: META_LOWEST_COST_BID_STRATEGY,
                daily_budget: String(requireExplicitDailyBudget(plan)),
              }
            : {}),
        });
        reconciledObjects.campaignId = requireMetaId(response, "campaign");
        reconciledObjects.ownedCampaignId = reconciledObjects.campaignId;
        reconciledObjects.provenance!.campaign = "created";
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
      const providerName = buildMetaProviderObjectName(plan, leadForm.localId, leadForm.name);
      let formId: string | undefined = reconciledObjects.leadFormIds[leadForm.localId];
      if (!formId) {
        formId = input.reconcileMissingObjects
          ? await findMetaObjectByName(
              input,
              requestLog,
              responseLog,
              `lead_form.${leadForm.localId}.reconcile_missing`,
              `/${plan.setup.pageId}/leadgen_forms`,
              providerName,
              input.pageAccessToken ?? input.accessToken,
            ) ?? undefined
          : undefined;
        if (!formId) {
          const response = await postMetaObject(
            input,
            requestLog,
            responseLog,
            `lead_form.${leadForm.localId}`,
            `/${plan.setup.pageId}/leadgen_forms`,
            buildMetaInstantFormPayload(providerName, leadForm),
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
            follow_up_action_url: leadFormDeliveryUrl(plan, leadForm),
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
              website_url: leadFormDeliveryUrl(plan, leadForm),
            },
          },
          input.pageAccessToken ?? input.accessToken,
        );
        const formId = requireMetaId(response, "lead form");
        await verifyMetaLeadForm(input, requestLog, responseLog, formId, leadForm, input.pageAccessToken ?? input.accessToken);
        reconciledObjects.leadFormIds[leadForm.localId] = formId;
      }
      // A deterministic name proves identity, not content. Always verify the
      // exact Instant Form fields before recording either a recovered, newly
      // created, or previously checkpointed provider ID as publish-ready.
      await verifyMetaLeadForm(input, requestLog, responseLog, formId, providerName, leadForm, input.pageAccessToken ?? input.accessToken);
      reconciledObjects.leadFormIds[leadForm.localId] = formId;
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
        await assertAdoptedMetaAdSetMatchesPlan(
          plan,
          input,
          requestLog,
          responseLog,
          reconciledObjects,
          adSet,
          existingId,
          parentPreflight.campaignBudgetMode,
          `adset.${adSet.localId}.reconcile_missing.validate`,
        );
        reconciledObjects.adSetIds[adSet.localId] = existingId;
        (reconciledObjects.provenance!.adSets ??= {})[adSet.localId] = "adopted";
        delete reconciledObjects.ownedAdSetIds?.[adSet.localId];
      } else {
        const response = await postMetaObject(input, requestLog, responseLog, `adset.${adSet.localId}`, `/${plan.setup.metaAdAccountId}/adsets`, {
          name: providerName,
          campaign_id: reconciledObjects.campaignId,
          billing_event: adSet.billingEvent,
          optimization_goal: adSet.optimizationGoal,
          destination_type: expectedMetaDestinationType(plan),
          promoted_object: { page_id: plan.setup.pageId },
          targeting: adSet.targeting,
          status: "PAUSED",
          ...(parentPreflight.campaignBudgetMode === "adset"
            ? {
                bid_strategy: META_LOWEST_COST_BID_STRATEGY,
                daily_budget: String(requireExplicitDailyBudget(plan)),
              }
            : {}),
          ...(adSet.startTime ? { start_time: adSet.startTime } : {}),
          ...(adSet.endTime ? { end_time: adSet.endTime } : {}),
        });
        reconciledObjects.adSetIds[adSet.localId] = requireMetaId(response, "ad set");
        (reconciledObjects.ownedAdSetIds ??= {})[adSet.localId] = reconciledObjects.adSetIds[adSet.localId]!;
        (reconciledObjects.provenance!.adSets ??= {})[adSet.localId] = "created";
      }
      await checkpointMetaPublishProgress(input, requestLog, responseLog, reconciledObjects);
    }

    for (const creative of plan.creatives) {
      if (reconciledObjects.creativeIds[creative.localId]) {
        const prior = plan.reconciledObjects.pausedReadbackEvidence?.creatives[creative.localId];
        if (prior?.providerCreativeId === reconciledObjects.creativeIds[creative.localId]) {
          expectedCreativeAssets[creative.localId] = {
            feedImageHash: prior.feed.providerImageHash,
            storyImageHash: prior.story.providerImageHash,
          };
        } else if (reconciledObjects.creativeAssetHashes?.[creative.localId]) {
          expectedCreativeAssets[creative.localId] = reconciledObjects.creativeAssetHashes[creative.localId]!;
        }
        continue;
      }

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
        const utmLink = buildUtmLink(destinationUrl, plan.tracking, creative.localId);
        const callToAction = {
          type: creative.cta,
          value: leadFormId ? { lead_gen_form_id: leadFormId } : { link: utmLink },
        };
        const response = await postMetaObject(input, requestLog, responseLog, `creative.${creative.localId}`, `/${plan.setup.metaAdAccountId}/adcreatives`, {
          name: providerName,
          object_story_spec: {
            page_id: creative.pageId,
            ...(creative.instagramActorId ? { instagram_user_id: creative.instagramActorId } : {}),
            ...(creative.asset?.type === "video"
              ? {
                  video_data: {
                    video_id: media.videoId,
                    message: creative.primaryText,
                    title: creative.headline,
                    link_description: creative.description,
                    call_to_action: callToAction,
                    ...(creative.asset.posterUrl ? { image_url: creative.asset.posterUrl } : {}),
                  },
                }
              : {
                  link_data: {
                    message: creative.primaryText,
                    name: creative.headline,
                    description: creative.description,
                    link: utmLink,
                    ...(media.imageHash ? { image_hash: media.imageHash } : {}),
                    call_to_action: callToAction,
                  },
                }),
          },
        });
        reconciledObjects.creativeIds[creative.localId] = requireMetaId(response, "creative");
        if (!imageHash || !storyImageHash) {
          throw new MetaReconciliationRequiredError("Meta creative upload did not return both immutable Feed and Story image hashes.");
        }
        expectedCreativeAssets[creative.localId] = { feedImageHash: imageHash, storyImageHash };
        reconciledObjects.creativeAssetHashes![creative.localId] = expectedCreativeAssets[creative.localId]!;
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
        await assertAdoptedMetaAdMatchesPlan(
          plan,
          input,
          requestLog,
          responseLog,
          reconciledObjects,
          ad,
          existingId,
          `ad.${ad.localId}.reconcile_missing.validate`,
        );
        reconciledObjects.adIds[ad.localId] = existingId;
        (reconciledObjects.provenance!.ads ??= {})[ad.localId] = "adopted";
        delete reconciledObjects.ownedAdIds?.[ad.localId];
      } else {
        const response = await postMetaObject(input, requestLog, responseLog, `ad.${ad.localId}`, `/${plan.setup.metaAdAccountId}/ads`, {
          name: providerName,
          adset_id: reconciledObjects.adSetIds[ad.adSetLocalId],
          creative: { creative_id: reconciledObjects.creativeIds[ad.creativeLocalId] },
          status: "PAUSED",
        });
        reconciledObjects.adIds[ad.localId] = requireMetaId(response, "ad");
        (reconciledObjects.ownedAdIds ??= {})[ad.localId] = reconciledObjects.adIds[ad.localId]!;
        (reconciledObjects.provenance!.ads ??= {})[ad.localId] = "created";
      }
      await checkpointMetaPublishProgress(input, requestLog, responseLog, reconciledObjects);
    }

    const objectStatuses = await reconcileMetaObjects(input, requestLog, responseLog, reconciledObjects);
    assertAllProviderObjectsPaused(objectStatuses, plan, reconciledObjects);
    reconciledObjects.objectStatuses = objectStatuses;
    reconciledObjects.pausedReadbackEvidence = await verifyPausedMetaReadbackEvidence(
      plan,
      input,
      requestLog,
      responseLog,
      reconciledObjects,
      objectStatuses,
      expectedCreativeAssets,
    );

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

type MetaPublishParentPreflight = {
  campaignBudgetMode: "campaign" | "adset";
};

/**
 * Fail closed before any provider write. The browser's parentState is display
 * data only: account membership, Page ownership and parent compatibility are
 * read from Meta again immediately before publication.
 */
async function preflightMetaPublishParents(
  plan: MetaPublishPlan,
  input: MetaPublishExecutionInput,
  requestLog: MetaProviderLogEntry[],
  responseLog: MetaProviderLogEntry[],
  reconciledObjects: MetaReconciledObjects,
): Promise<MetaPublishParentPreflight> {
  const target = plan.controls.target ?? { mode: "new_campaign_new_adset" as const };
  if (target.mode !== "existing_adset") requireExplicitDailyBudget(plan);
  // Resolve every fulfilment binding before network I/O so a guide/promise can
  // never create a parent and fail only when the Instant Form is posted.
  for (const leadForm of plan.leadForms) leadFormDeliveryUrl(plan, leadForm);
  if (plan.controls.fulfilment && plan.leadForms.length === 0) requireExplicitFulfilmentUrl(plan.controls.fulfilment);
  if (target.mode === "new_campaign_new_adset") {
    const requested = plan.controls.newCampaign;
    if (!requested) {
      throw new Error("Choose campaign budget ownership, objective and special-ad category before any Meta objects are written.");
    }
    if (
      requested.objective !== plan.campaign.objective ||
      requested.budgetMode !== plan.campaign.budgetMode ||
      !sameStrings(
        uniqueStrings(requested.specialAdCategories.map((value) => value.toUpperCase())),
        uniqueStrings(plan.campaign.specialAdCategories.map((value) => value.toUpperCase())),
      ) ||
      !sameStrings(
        uniqueStrings(requested.specialAdCategoryCountries.map((value) => value.toUpperCase())),
        uniqueStrings(plan.campaign.specialAdCategoryCountries.map((value) => value.toUpperCase())),
      )
    ) {
      throw new Error("The new-campaign settings do not match the approved publish plan; no provider objects were written.");
    }
  }

  const account = await getMetaPreflightObject(
    input,
    requestLog,
    responseLog,
    "preflight.account",
    `/${plan.setup.metaAdAccountId}?fields=id,account_id,account_status,disable_reason,currency,timezone_name`,
  );
  const returnedAccountId = optionalString(account.id ?? account.account_id);
  if (!returnedAccountId || normalizeMetaAccountId(returnedAccountId) !== normalizeMetaAccountId(plan.setup.metaAdAccountId)) {
    throw new Error("Meta returned a different ad account; no provider objects were written.");
  }
  if (Number(account.account_status) !== 1 || Number(account.disable_reason ?? 0) !== 0) {
    throw new Error("The selected Meta ad account is not active; no provider objects were written.");
  }
  const liveCurrency = optionalString(account.currency);
  const liveTimezone = optionalString(account.timezone_name);
  if (liveCurrency && liveCurrency.toUpperCase() !== plan.setup.currency.toUpperCase()) {
    throw new Error("The Meta ad-account currency changed; reconnect it before publishing.");
  }
  if (liveTimezone && liveTimezone !== plan.setup.timezone) {
    throw new Error("The Meta ad-account timezone changed; reconnect it before publishing.");
  }

  const page = await getMetaPreflightObject(
    input,
    requestLog,
    responseLog,
    "preflight.page",
    `/${plan.setup.pageId}?fields=id,name,tasks,instagram_business_account{id}`,
    input.pageAccessToken ?? input.accessToken,
  );
  if (optionalString(page.id) !== plan.setup.pageId) {
    throw new Error("The selected Meta Page is no longer accessible; no provider objects were written.");
  }
  if (plan.setup.instagramActorId) {
    const instagram = recordValue(page.instagram_business_account);
    if (optionalString(instagram?.id) !== plan.setup.instagramActorId) {
      throw new Error("The selected Instagram identity is not attached to the selected Page; no provider objects were written.");
    }
  }
  for (const creative of plan.creatives) {
    if (creative.pageId !== plan.setup.pageId || (creative.instagramActorId ?? null) !== (plan.setup.instagramActorId ?? null)) {
      throw new Error("Creative identity no longer matches the verified Meta Page; no provider objects were written.");
    }
  }

  const selectedCampaignId = target.mode === "new_campaign_new_adset" ? null : target.campaignId.trim();
  if (selectedCampaignId && reconciledObjects.campaignId !== selectedCampaignId) {
    throw new Error("The persisted campaign does not match the selected Meta campaign; no provider objects were written.");
  }

  let campaignBudgetMode: "campaign" | "adset" = plan.controls.newCampaign?.budgetMode ?? plan.campaign.budgetMode;
  const campaignId = selectedCampaignId ?? reconciledObjects.campaignId ?? null;
  if (campaignId) {
    const campaign = await getMetaCampaignBidStrategy(
      input,
      requestLog,
      responseLog,
      "preflight.campaign",
      campaignId,
    );
    assertCampaignAccountMatches(plan.setup.metaAdAccountId, campaign);
    if (campaign.id !== campaignId) {
      throw new Error("Meta returned a different campaign; no provider objects were written.");
    }
    if (campaign.objective !== plan.campaign.objective) {
      throw new Error("The selected Meta campaign objective changed; choose it again before publishing.");
    }
    assertSameMetaStringSet("special-ad category", campaign.specialAdCategories, plan.campaign.specialAdCategories);
    assertSameMetaStringSet(
      "special-ad category country",
      campaign.specialAdCategoryCountries,
      plan.campaign.specialAdCategoryCountries,
    );
    campaignBudgetMode = hasMetaCampaignBudget(campaign) ? "campaign" : "adset";
    if (selectedCampaignId && campaignBudgetMode !== plan.campaign.budgetMode) {
      throw new Error(
        `The selected Meta campaign now uses ${campaignBudgetMode}-level budgeting, not ${plan.campaign.budgetMode}-level budgeting. ` +
        "Choose it again before publishing; no provider objects were written.",
      );
    }

    if (selectedCampaignId) {
      assertReusedParentActive("campaign", campaignId, campaign.configuredStatus, campaign.effectiveStatus);
    } else {
      const ownership = getCampaignOwnershipEvidence(plan, requestLog, responseLog, campaignId);
      const provenance = reconciledObjects.provenance?.campaign;
      if (!ownership.ownedByPlan && provenance !== "adopted") {
        throw new Error("The resumed campaign is not owned by this publish plan; no provider objects were written.");
      }
      assertAdoptedOrCreatedCampaignMatchesPlan(
        plan,
        campaign,
        campaignId,
        campaignBudgetMode,
        ownership.expectedName,
        provenance === "adopted" ? "adopted" : "created",
      );
      if (ownership.ownedByPlan) {
        reconciledObjects.ownedCampaignId = campaignId;
        reconciledObjects.provenance!.campaign = "created";
      } else {
        delete reconciledObjects.ownedCampaignId;
      }
    }
  }

  if (target.mode === "existing_adset") {
    const requestedIds = uniqueStrings(target.adSetIds);
    const persistedIds = uniqueStrings(Object.values(reconciledObjects.adSetIds));
    if (!sameStrings(requestedIds, persistedIds)) {
      throw new Error("The persisted ad sets do not match the selected Meta ad sets; no provider objects were written.");
    }

    for (const adSetId of requestedIds) {
      const adSet = await getMetaPreflightObject(
        input,
        requestLog,
        responseLog,
        `preflight.adset.${adSetId}`,
        `/${adSetId}?fields=id,account_id,campaign_id,status,effective_status,configured_status,optimization_goal,billing_event,targeting,destination_type,promoted_object,daily_budget,lifetime_budget`,
      );
      if (optionalString(adSet.id) !== adSetId || optionalString(adSet.campaign_id) !== target.campaignId) {
        throw new Error(`Meta ad set ${adSetId} does not belong to the selected campaign; no provider objects were written.`);
      }
      const adSetAccount = optionalString(adSet.account_id);
      if (adSetAccount && normalizeMetaAccountId(adSetAccount) !== normalizeMetaAccountId(plan.setup.metaAdAccountId)) {
        throw new Error(`Meta ad set ${adSetId} belongs to a different ad account; no provider objects were written.`);
      }
      assertReusedParentActive(
        "ad set",
        adSetId,
        optionalString(adSet.configured_status),
        optionalString(adSet.effective_status),
      );
      if (optionalString(adSet.optimization_goal) !== "LEAD_GENERATION" || optionalString(adSet.billing_event) !== "IMPRESSIONS") {
        throw new Error(`Meta ad set ${adSetId} is not a compatible lead-generation ad set; no provider objects were written.`);
      }
      if (optionalString(adSet.destination_type) !== expectedMetaDestinationType(plan)) {
        throw new Error(`Meta ad set ${adSetId} has a different destination type; no provider objects were written.`);
      }
      const promotedObject = recordValue(adSet.promoted_object);
      if (optionalString(promotedObject?.page_id) !== plan.setup.pageId) {
        throw new Error(`Meta ad set ${adSetId} is promoted by a different Page; no provider objects were written.`);
      }
      const targeting = recordValue(adSet.targeting);
      if (!targeting || Object.keys(targeting).length === 0) {
        throw new Error(`Meta ad set ${adSetId} has no verifiable targeting; no provider objects were written.`);
      }
      if (
        campaignBudgetMode === "adset" &&
        (optionalMetaBudget(adSet.daily_budget) ?? 0) <= 0 &&
        (optionalMetaBudget(adSet.lifetime_budget) ?? 0) <= 0
      ) {
        throw new Error(`Meta ad set ${adSetId} has no ad-set budget; no provider objects were written.`);
      }
    }
  }

  return { campaignBudgetMode };
}

async function preflightAdoptedMetaDeliveryObjects(
  plan: MetaPublishPlan,
  input: MetaPublishExecutionInput,
  requestLog: MetaProviderLogEntry[],
  responseLog: MetaProviderLogEntry[],
  reconciledObjects: MetaReconciledObjects,
  campaignBudgetMode: "campaign" | "adset",
) {
  for (const adSet of plan.adSets) {
    if (reconciledObjects.provenance?.adSets?.[adSet.localId] !== "adopted") continue;
    const objectId = optionalString(reconciledObjects.adSetIds[adSet.localId]);
    if (!objectId) throw new Error(`Adopted Meta ad set ${adSet.localId} is missing its persisted ID.`);
    await assertAdoptedMetaAdSetMatchesPlan(
      plan,
      input,
      requestLog,
      responseLog,
      reconciledObjects,
      adSet,
      objectId,
      campaignBudgetMode,
      `preflight.adopted_adset.${adSet.localId}`,
    );
  }

  for (const ad of plan.ads) {
    if (reconciledObjects.provenance?.ads?.[ad.localId] !== "adopted") continue;
    const objectId = optionalString(reconciledObjects.adIds[ad.localId]);
    if (!objectId) throw new Error(`Adopted Meta ad ${ad.localId} is missing its persisted ID.`);
    await assertAdoptedMetaAdMatchesPlan(
      plan,
      input,
      requestLog,
      responseLog,
      reconciledObjects,
      ad,
      objectId,
      `preflight.adopted_ad.${ad.localId}`,
    );
  }
}

async function assertAdoptedMetaCampaignMatchesPlan(
  plan: MetaPublishPlan,
  input: MetaPublishExecutionInput,
  requestLog: MetaProviderLogEntry[],
  responseLog: MetaProviderLogEntry[],
  campaignId: string,
  campaignBudgetMode: "campaign" | "adset",
  step: string,
) {
  const campaign = await getMetaCampaignBidStrategy(input, requestLog, responseLog, step, campaignId);
  assertAdoptedOrCreatedCampaignMatchesPlan(
    plan,
    campaign,
    campaignId,
    campaignBudgetMode,
    buildMetaProviderObjectName(plan, plan.campaign.localId, plan.campaign.name),
    "adopted",
  );
}

function assertAdoptedOrCreatedCampaignMatchesPlan(
  plan: MetaPublishPlan,
  campaign: MetaCampaignBidStrategyState,
  campaignId: string,
  campaignBudgetMode: "campaign" | "adset",
  expectedName: string,
  provenance: MetaReconciledObjectProvenance,
) {
  if (campaign.id !== campaignId) {
    throw new Error(`Meta returned a different ${provenance} campaign; refusing to continue.`);
  }
  assertCampaignAccountMatches(plan.setup.metaAdAccountId, campaign);
  if (campaign.name !== expectedName || campaign.objective !== plan.campaign.objective) {
    throw new Error(`The ${provenance} Meta campaign no longer matches this publish plan.`);
  }
  assertSameMetaStringSet("special-ad category", campaign.specialAdCategories, plan.campaign.specialAdCategories);
  assertSameMetaStringSet(
    "special-ad category country",
    campaign.specialAdCategoryCountries,
    plan.campaign.specialAdCategoryCountries,
  );
  if (campaign.configuredStatus !== "PAUSED" || campaign.effectiveStatus !== "PAUSED") {
    throw new Error(`The ${provenance} Meta campaign is not exactly PAUSED; refusing to continue.`);
  }
  const liveBudgetMode = hasMetaCampaignBudget(campaign) ? "campaign" : "adset";
  if (liveBudgetMode !== campaignBudgetMode) {
    throw new Error(`The ${provenance} Meta campaign budget owner no longer matches this publish plan.`);
  }
  if (campaignBudgetMode === "campaign") {
    if (
      campaign.dailyBudgetMinorUnits !== requireExplicitDailyBudget(plan) ||
      (campaign.lifetimeBudgetMinorUnits ?? 0) !== 0
    ) {
      throw new Error(`The ${provenance} Meta campaign budget no longer matches this publish plan.`);
    }
    if (provenance === "adopted" && campaign.bidStrategy !== META_LOWEST_COST_BID_STRATEGY) {
      throw new Error("The adopted Meta campaign does not have the approved lowest-cost bid strategy.");
    }
  }
}

async function assertAdoptedMetaAdSetMatchesPlan(
  plan: MetaPublishPlan,
  input: MetaPublishExecutionInput,
  requestLog: MetaProviderLogEntry[],
  responseLog: MetaProviderLogEntry[],
  reconciledObjects: MetaReconciledObjects,
  adSet: MetaPublishAdSetPlan,
  objectId: string,
  campaignBudgetMode: "campaign" | "adset",
  step: string,
) {
  const payload = await getMetaPreflightObject(
    input,
    requestLog,
    responseLog,
    step,
    `/${objectId}?fields=id,name,account_id,campaign_id,configured_status,effective_status,status,optimization_goal,billing_event,targeting,destination_type,promoted_object,daily_budget,lifetime_budget,bid_strategy`,
  );
  const promotedObject = recordValue(payload.promoted_object);
  const targeting = recordValue(payload.targeting);
  const expectedCampaignId = optionalString(reconciledObjects.campaignId);
  if (
    optionalString(payload.id) !== objectId ||
    optionalString(payload.name) !== buildMetaProviderObjectName(plan, adSet.localId, adSet.name) ||
    !sameMetaAccount(plan.setup.metaAdAccountId, optionalString(payload.account_id)) ||
    !expectedCampaignId ||
    optionalString(payload.campaign_id) !== expectedCampaignId ||
    !metaObjectConfirmsPaused(payload) ||
    optionalString(payload.optimization_goal) !== adSet.optimizationGoal ||
    optionalString(payload.billing_event) !== adSet.billingEvent ||
    optionalString(payload.destination_type) !== expectedMetaDestinationType(plan) ||
    optionalString(promotedObject?.page_id) !== plan.setup.pageId ||
    !targeting ||
    JSON.stringify(canonicalizeMetaExecutionValue(targeting)) !== JSON.stringify(canonicalizeMetaExecutionValue(adSet.targeting))
  ) {
    throw new Error(`Adopted Meta ad set ${objectId} does not authoritatively match this publish plan.`);
  }
  const dailyBudget = optionalMetaBudget(payload.daily_budget) ?? 0;
  const lifetimeBudget = optionalMetaBudget(payload.lifetime_budget) ?? 0;
  if (campaignBudgetMode === "adset") {
    if (
      dailyBudget !== requireExplicitDailyBudget(plan) ||
      lifetimeBudget !== 0 ||
      optionalString(payload.bid_strategy) !== META_LOWEST_COST_BID_STRATEGY
    ) {
      throw new Error(`Adopted Meta ad set ${objectId} has different budget settings.`);
    }
  } else if (dailyBudget !== 0 || lifetimeBudget !== 0) {
    throw new Error(`Adopted Meta ad set ${objectId} unexpectedly owns a budget.`);
  }
}

async function assertAdoptedMetaAdMatchesPlan(
  plan: MetaPublishPlan,
  input: MetaPublishExecutionInput,
  requestLog: MetaProviderLogEntry[],
  responseLog: MetaProviderLogEntry[],
  reconciledObjects: MetaReconciledObjects,
  ad: MetaPublishAdPlan,
  objectId: string,
  step: string,
) {
  const payload = await getMetaPreflightObject(
    input,
    requestLog,
    responseLog,
    step,
    `/${objectId}?fields=id,name,account_id,adset_id,creative{id},configured_status,effective_status,status`,
  );
  const creative = recordValue(payload.creative);
  const expectedAdSetId = optionalString(reconciledObjects.adSetIds[ad.adSetLocalId]);
  const expectedCreativeId = optionalString(reconciledObjects.creativeIds[ad.creativeLocalId]);
  if (
    optionalString(payload.id) !== objectId ||
    optionalString(payload.name) !== buildMetaProviderObjectName(plan, ad.localId, ad.name) ||
    !sameMetaAccount(plan.setup.metaAdAccountId, optionalString(payload.account_id)) ||
    !expectedAdSetId ||
    optionalString(payload.adset_id) !== expectedAdSetId ||
    !expectedCreativeId ||
    optionalString(creative?.id) !== expectedCreativeId ||
    !metaObjectConfirmsPaused(payload)
  ) {
    throw new Error(`Adopted Meta ad ${objectId} does not authoritatively match this publish plan.`);
  }
}

function sameMetaAccount(expectedAccountId: string, actualAccountId: string | null): boolean {
  return actualAccountId !== null && normalizeMetaAccountId(actualAccountId) === normalizeMetaAccountId(expectedAccountId);
}

function metaObjectConfirmsPaused(payload: Record<string, unknown>): boolean {
  const configured = optionalString(payload.configured_status)?.toUpperCase() ?? null;
  const effective = optionalString(payload.effective_status)?.toUpperCase() ?? null;
  return configured === "PAUSED" &&
    (effective === "PAUSED" || effective?.endsWith("_PAUSED") === true);
}

async function getMetaPreflightObject(
  input: MetaPublishExecutionInput,
  requestLog: MetaProviderLogEntry[],
  responseLog: MetaProviderLogEntry[],
  step: string,
  path: string,
  accessToken = input.accessToken,
): Promise<Record<string, unknown>> {
  const createdAt = new Date().toISOString();
  requestLog.push({ step, method: "GET", path, createdAt });
  const response = await (input.fetchImpl ?? fetch)(
    `https://graph.facebook.com/${input.graphVersion ?? DEFAULT_META_GRAPH_VERSION}${path}`,
    {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  responseLog.push({ step, method: "GET", path, response: payload, status: response.status, createdAt: new Date().toISOString() });
  if (!response.ok) {
    throw new Error(metaProviderErrorMessage(payload, `Meta preflight ${step} failed with ${response.status}.`));
  }
  return payload;
}

function requireExplicitDailyBudget(plan: MetaPublishPlan): number {
  const value = plan.controls.dailyBudgetMinorUnits;
  if (!Number.isInteger(value) || (value ?? 0) <= 0) {
    throw new Error("A positive integer daily budget is required before any Meta objects are written.");
  }
  return value!;
}

function requireExplicitFulfilmentUrl(fulfilment: MetaOfferFulfilment): string {
  const issues = validateMetaOfferFulfilment(fulfilment);
  if (issues.length > 0) {
    throw new Error(`Offer fulfilment is incomplete: ${issues.join("; ")}`);
  }
  const value = fulfilment.fulfilmentUrl.trim();
  if (!value || !isHttpsDestination(value)) {
    throw new Error("Offer, guide and promise delivery requires an explicit HTTPS fulfilment URL before any Meta objects are written.");
  }
  return value;
}

function leadFormDeliveryUrl(plan: MetaPublishPlan, leadForm: MetaPublishLeadFormPlan): string {
  const fulfilment = plan.controls.fulfilment;
  if (!fulfilment) return leadForm.thankYouWebsiteUrl;

  const exactUrl = requireExplicitFulfilmentUrl(fulfilment);
  if (
    !leadForm.fulfilment ||
    leadForm.fulfilment.fulfilmentUrl.trim() !== exactUrl ||
    leadForm.thankYouWebsiteUrl.trim() !== exactUrl
  ) {
    throw new Error(
      "The Instant Form thank-you/follow-up URL does not match the approved fulfilment URL; no provider objects were written.",
    );
  }
  return exactUrl;
}

function expectedMetaDestinationType(plan: MetaPublishPlan): "ON_AD" | "WEBSITE" {
  return (plan.controls.destinationMode ?? (plan.leadForms.length > 0 ? "instant_form" : "website")) === "instant_form"
    ? "ON_AD"
    : "WEBSITE";
}

function assertReusedParentActive(
  kind: "campaign" | "ad set",
  id: string,
  configuredStatus: string | null,
  effectiveStatus: string | null,
) {
  const configured = configuredStatus?.toUpperCase() ?? null;
  const effective = effectiveStatus?.toUpperCase() ?? null;
  if (configured !== "ACTIVE" || effective !== "ACTIVE") {
    throw new Error(`The reused Meta ${kind} ${id} is not active; Blockwise will not mutate or activate reused parents.`);
  }
}

function assertSameMetaStringSet(label: string, live: string[], expected: string[]) {
  if (!sameStrings(uniqueStrings(live.map((value) => value.toUpperCase())), uniqueStrings(expected.map((value) => value.toUpperCase())))) {
    throw new Error(`The selected Meta campaign ${label} changed; choose it again before publishing.`);
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
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
  expectedName: string,
  expected: MetaPublishLeadFormPlan,
  accessToken: string,
) {
  const step = `lead_form.${expected.localId}.verify`;
  const path = `/${formId}?fields=id,name,locale,is_optimized_for_quality,questions,privacy_policy,thank_you_page,context_card,question_page_custom_headline,follow_up_action_url`;
  const createdAt = new Date().toISOString();
  requestLog.push({ step, method: "GET", path, createdAt });
  const response = await (input.fetchImpl ?? fetch)(
    `https://graph.facebook.com/${input.graphVersion ?? DEFAULT_META_GRAPH_VERSION}${path}`,
    { method: "GET", headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000) },
  );
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  responseLog.push({ step, method: "GET", path, response: payload, status: response.status, createdAt: new Date().toISOString() });
  if (!response.ok) throw new Error(metaProviderErrorMessage(payload, `Meta lead form read-back failed with ${response.status}.`));

  if (!metaLeadFormReadbackMatches(payload, formId, expectedName, expected)) {
    throw new MetaReconciliationRequiredError("Meta did not read back the requested Instant Form fields exactly; the paused campaign was not created.");
  }
}

function canonicalMetaQuestion(value: unknown): string | null {
  const question = recordValue(value);
  if (!question || typeof question.type !== "string" || typeof question.key !== "string") return null;
  const options = question.options == null
    ? []
    : Array.isArray(question.options)
      ? question.options.map((option) => {
          const entry = recordValue(option);
          return entry && typeof entry.key === "string" && typeof entry.label === "string"
            ? { key: entry.key, label: entry.label }
            : null;
        })
      : [null];
  if (options.some((option) => option === null)) return null;
  const label = question.type === "CUSTOM"
    ? (typeof question.label === "string" ? question.label : null)
    : null;
  if (question.type === "CUSTOM" && label === null) return null;
  return JSON.stringify({
    type: question.type,
    key: question.key,
    label,
    options,
  });
}

/** Compare only documented Graph fields, structurally and without substring evidence. */
export function metaLeadFormReadbackMatches(
  payload: Record<string, unknown>,
  formId: string,
  expectedName: string,
  expected: MetaPublishLeadFormPlan,
): boolean {
  const context = recordValue(payload.context_card);
  const privacy = recordValue(payload.privacy_policy);
  const thankYou = recordValue(payload.thank_you_page);
  if (
    payload.id !== formId
    || payload.name !== expectedName
    || payload.locale !== "en_AU"
    || payload.is_optimized_for_quality !== true
    || payload.question_page_custom_headline !== expected.headline
    || context?.title !== expected.headline
    || context?.style !== "PARAGRAPH_STYLE"
    || !Array.isArray(context.content)
    || context.content.length !== 1
    || context.content[0] !== expected.intro
    || privacy?.url !== expected.privacyPolicyUrl
    || privacy?.link_text !== "Privacy Policy"
    || payload.follow_up_action_url !== expected.thankYouWebsiteUrl
    || thankYou?.title !== expected.thankYouTitle
    || thankYou?.body !== expected.thankYouBody
    || thankYou?.button_text !== expected.thankYouButtonText
    || thankYou?.button_type !== expected.thankYouButtonType
    || thankYou?.website_url !== expected.thankYouWebsiteUrl
    || !Array.isArray(payload.questions)
  ) return false;

  const expectedQuestions = [
    ...expected.contactFields.map((type) => ({ type, key: type.toLowerCase(), label: null, options: [] })),
    ...expected.customQuestions.map((label, index) => ({ type: "CUSTOM", key: `custom_${index + 1}`, label, options: [] })),
  ].map((question) => JSON.stringify(question)).sort();
  const actualQuestions = payload.questions.map(canonicalMetaQuestion);
  return actualQuestions.every((question): question is string => question !== null)
    && actualQuestions.length === expectedQuestions.length
    && new Set(actualQuestions).size === actualQuestions.length
    && actualQuestions.sort().every((question, index) => question === expectedQuestions[index]);
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

function assertAllProviderObjectsPaused(
  statuses: NonNullable<MetaReconciledObjects["objectStatuses"]>,
  plan: MetaPublishPlan,
  reconciledObjects: MetaReconciledObjects,
) {
  if (!statuses.campaign || statuses.campaign.id !== reconciledObjects.campaignId || !samePausedStatus(statuses.campaign, "campaign")) {
    throw new MetaReconciliationRequiredError("Meta did not read back the campaign with configured_status PAUSED and effective_status PAUSED.");
  }
  for (const adSet of plan.adSets) {
    const status = statuses.adSets?.[adSet.localId];
    if (!status || status.id !== reconciledObjects.adSetIds[adSet.localId] || !samePausedStatus(status, "adset")) {
      throw new MetaReconciliationRequiredError(`Meta did not read back ad set ${adSet.localId} with configured_status PAUSED and a safe paused effective status.`);
    }
  }
  for (const ad of plan.ads) {
    const status = statuses.ads?.[ad.localId];
    if (!status || status.id !== reconciledObjects.adIds[ad.localId] || !samePausedStatus(status, "ad")) {
      throw new MetaReconciliationRequiredError(`Meta did not read back ad ${ad.localId} with configured_status PAUSED and a safe paused effective status.`);
    }
  }
}

async function verifyPausedMetaReadbackEvidence(
  plan: MetaPublishPlan,
  input: MetaPublishExecutionInput,
  requestLog: MetaProviderLogEntry[],
  responseLog: MetaProviderLogEntry[],
  reconciledObjects: MetaReconciledObjects,
  statuses: NonNullable<MetaReconciledObjects["objectStatuses"]>,
  expectedCreativeAssets: Record<string, { feedImageHash: string; storyImageHash: string }>,
): Promise<MetaPausedReadbackEvidence> {
  const creatives: Record<string, MetaPausedCreativeEvidence> = {};
  for (const creative of plan.creatives) {
    const providerCreativeId = requiredReconciledId(reconciledObjects.creativeIds[creative.localId], "creative");
    const leadFormProviderId = requiredReconciledId(reconciledObjects.leadFormIds[creative.leadFormLocalId], "lead form");
    const expectedAssets = expectedCreativeAssets[creative.localId];
    if (!expectedAssets) {
      throw new MetaReconciliationRequiredError(`Meta creative ${creative.localId} lacks immutable upload evidence; refusing paused readiness.`);
    }
    const payload = await getMetaCreativeReadback(input, requestLog, responseLog, creative.localId, providerCreativeId);
    assertCreativeReadbackMatchesPlan(payload, creative, leadFormProviderId, expectedAssets);
    const feed = requiredCreativeBinding(creative, "feed");
    const story = requiredCreativeBinding(creative, "story");
    creatives[creative.localId] = {
      providerCreativeId,
      leadFormProviderId,
      feed: sourceFreeCreativeAssetEvidence(feed, "feed", expectedAssets.feedImageHash),
      story: sourceFreeCreativeAssetEvidence(story, "story", expectedAssets.storyImageHash),
    };
  }

  return {
    verifiedAt: new Date().toISOString(),
    complianceSubjectHash: plan.complianceSubjectHash,
    campaign: statuses.campaign!,
    adSets: statuses.adSets ?? {},
    ads: statuses.ads ?? {},
    creatives,
  };
}

/**
 * Provider state can change after paused_ready without a Blockwise write.
 * Re-read it immediately before an ACTIVE mutation and replace the durable
 * source-free evidence only if every status, creative asset mapping, and form
 * mapping remains exact for the current immutable plan.
 */
export async function refreshCurrentMetaPausedReadbackEvidence(
  plan: MetaPublishPlan,
  input: MetaPublishExecutionInput,
): Promise<Pick<MetaPublishExecutionResult, "requestLog" | "responseLog" | "reconciledObjects">> {
  const blocker = pausedReadbackEvidenceBlocker(plan);
  if (blocker) throw new Error(blocker);
  const requestLog = [...plan.requestLog];
  const responseLog = [...plan.responseLog];
  const reconciledObjects: MetaReconciledObjects = {
    ...plan.reconciledObjects,
    leadFormIds: { ...plan.reconciledObjects.leadFormIds },
    adSetIds: { ...plan.reconciledObjects.adSetIds },
    creativeIds: { ...plan.reconciledObjects.creativeIds },
    adIds: { ...plan.reconciledObjects.adIds },
  };
  const statuses = await reconcileMetaObjects(input, requestLog, responseLog, reconciledObjects);
  assertAllProviderObjectsPaused(statuses, plan, reconciledObjects);
  const expectedCreativeAssets = Object.fromEntries(plan.creatives.map((creative) => {
    const prior = plan.reconciledObjects.pausedReadbackEvidence!.creatives[creative.localId]!;
    return [creative.localId, {
      feedImageHash: prior.feed.providerImageHash,
      storyImageHash: prior.story.providerImageHash,
    }];
  }));
  reconciledObjects.objectStatuses = statuses;
  reconciledObjects.pausedReadbackEvidence = await verifyPausedMetaReadbackEvidence(
    plan,
    input,
    requestLog,
    responseLog,
    reconciledObjects,
    statuses,
    expectedCreativeAssets,
  );
  return { requestLog, responseLog, reconciledObjects };
}

function sourceFreeCreativeAssetEvidence(
  binding: MetaCreativeRevisionBinding,
  placement: "feed" | "story",
  providerImageHash: string,
): MetaPausedCreativeAssetEvidence {
  if (!binding.asset.contentSha256) {
    throw new MetaReconciliationRequiredError(`Meta ${placement} creative binding has no immutable content hash.`);
  }
  return {
    placement,
    creativeId: binding.creativeId,
    revisionId: binding.revisionId,
    contentSha256: binding.asset.contentSha256,
    providerImageHash,
  };
}

function requiredCreativeBinding(creative: MetaPublishCreativePlan, placement: "feed" | "story"): MetaCreativeRevisionBinding {
  const binding = creative.revisionBindings.find((item) => item.placement === placement);
  if (!binding || binding.format !== (placement === "feed" ? "4:5" : "9:16")) {
    throw new MetaReconciliationRequiredError(`Meta creative ${creative.localId} lacks its required ${placement === "feed" ? "4:5 Feed" : "9:16 Story"} revision binding.`);
  }
  return binding;
}

async function getMetaCreativeReadback(
  input: MetaPublishExecutionInput,
  requestLog: MetaProviderLogEntry[],
  responseLog: MetaProviderLogEntry[],
  localId: string,
  providerCreativeId: string,
): Promise<Record<string, unknown>> {
  const step = `creative.${localId}.verify_asset_feed`;
  const path = `/${providerCreativeId}?fields=id,asset_feed_spec,object_story_spec`;
  const createdAt = new Date().toISOString();
  requestLog.push({ step, method: "GET", path, createdAt });
  const response = await (input.fetchImpl ?? fetch)(
    `https://graph.facebook.com/${input.graphVersion ?? DEFAULT_META_GRAPH_VERSION}${path}`,
    { method: "GET", headers: { authorization: `Bearer ${input.accessToken}` }, signal: AbortSignal.timeout(30_000) },
  );
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  responseLog.push({ step, method: "GET", path, response: payload, status: response.status, createdAt: new Date().toISOString() });
  if (!response.ok) throw new MetaReconciliationRequiredError(metaProviderErrorMessage(payload, `Meta creative read-back failed with ${response.status}.`));
  if (optionalString(payload.id) !== providerCreativeId) {
    throw new MetaReconciliationRequiredError(`Meta creative read-back returned an unexpected object for ${localId}.`);
  }
  return payload;
}

function assertCreativeReadbackMatchesPlan(
  payload: Record<string, unknown>,
  creative: MetaPublishCreativePlan,
  leadFormProviderId: string,
  expectedAssets: { feedImageHash: string; storyImageHash: string },
) {
  const storySpec = recordValue(payload.object_story_spec);
  const linkData = recordValue(storySpec?.link_data);
  const callToAction = recordValue(linkData?.call_to_action);
  const ctaValue = recordValue(callToAction?.value);
  if (optionalString(ctaValue?.lead_gen_form_id) !== leadFormProviderId) {
    throw new MetaReconciliationRequiredError(`Meta creative ${creative.localId} did not read back its exact Instant Form mapping.`);
  }

  const actual = recordValue(payload.asset_feed_spec);
  const expected = buildMetaAssetFeedSpec(expectedAssets.feedImageHash, expectedAssets.storyImageHash);
  if (!actual || !sameJsonValue(actual.ad_formats, expected.ad_formats) || !sameJsonValue(actual.asset_customization_rules, expected.asset_customization_rules)) {
    throw new MetaReconciliationRequiredError(`Meta creative ${creative.localId} did not read back the exact Feed and Story placement rules.`);
  }
  const images = Array.isArray(actual.images) ? actual.images : [];
  const hasImage = (label: string, hash: string) => images.some((candidate) => {
    const image = recordValue(candidate);
    const labels = Array.isArray(image?.adlabels) ? image.adlabels : [];
    return optionalString(image?.hash) === hash && labels.some((item) => recordValue(item)?.name === label);
  });
  if (!hasImage("feed_image", expectedAssets.feedImageHash) || !hasImage("story_image", expectedAssets.storyImageHash)) {
    throw new MetaReconciliationRequiredError(`Meta creative ${creative.localId} did not read back the exact Feed 4:5 and Story 9:16 image mappings.`);
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(sortJsonValue(left)) === JSON.stringify(sortJsonValue(right));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, sortJsonValue(item)]));
  }
  return value;
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

/** Meta's /advideos source upload is multipart; a JSON base64 field is not a
 * valid Graph upload and can be accepted by mocks while failing in production. */
async function postMetaVideoObject(
  input: MetaPublishExecutionInput,
  requestLog: MetaProviderLogEntry[],
  responseLog: MetaProviderLogEntry[],
  step: string,
  accountId: string,
  bytesBase64: string,
  filename: string,
  mimeType?: string,
) {
  const path = `/${accountId}/advideos`;
  const createdAt = new Date().toISOString();
  requestLog.push({ step, method: "POST", path, body: { source: `<redacted ${bytesBase64.length} base64 chars>`, name: filename }, createdAt });
  const bytes = Buffer.from(bytesBase64, "base64");
  if (!bytes.length) throw new Error("Validated video bytes are required before Meta upload.");
  const form = new FormData();
  form.append("source", new Blob([bytes], { type: mimeType || "video/mp4" }), filename);
  form.append("name", filename);
  const response = await (input.fetchImpl ?? fetch)(`https://graph.facebook.com/${input.graphVersion ?? DEFAULT_META_GRAPH_VERSION}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${input.accessToken}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  responseLog.push({ step, method: "POST", path, response: payload, status: response.status, createdAt: new Date().toISOString() });
  if (!response.ok) throw new Error(metaProviderErrorMessage(payload, `Meta request ${step} failed with ${response.status}.`));
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
      ownedAdSetIds: { ...(reconciledObjects.ownedAdSetIds ?? {}) },
      creativeIds: { ...reconciledObjects.creativeIds },
      adIds: { ...reconciledObjects.adIds },
      ownedAdIds: { ...(reconciledObjects.ownedAdIds ?? {}) },
      provenance: {
        ...(reconciledObjects.provenance ?? {}),
        adSets: { ...(reconciledObjects.provenance?.adSets ?? {}) },
        ads: { ...(reconciledObjects.provenance?.ads ?? {}) },
      },
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
  if (plan.campaign.budgetMode === "adset") return false;
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
  return {
    expectedName,
    ownedByPlan: createdByPlan,
    predatesBidStrategyContract: createdByPlan &&
      !Object.prototype.hasOwnProperty.call(creationRequest?.body ?? {}, "bid_strategy"),
  };
}

export type MetaDurablyCreatedObjects = {
  campaignId?: string;
  adSetIds: Record<string, string>;
  adIds: Record<string, string>;
};

/**
 * Ownership is reconstructed from the immutable create exchange, not from a
 * mutable `owned*` map or an exact-name lookup. A successful response that
 * binds the deterministic create request to the persisted ID is required.
 */
export function getDurablyCreatedMetaObjects(plan: MetaPublishPlan): MetaDurablyCreatedObjects {
  const created: MetaDurablyCreatedObjects = { adSetIds: {}, adIds: {} };
  const campaignId = optionalString(plan.reconciledObjects.campaignId);
  if (campaignId && hasDurableMetaCreateExchange(
    plan,
    "campaign.create",
    `/${plan.setup.metaAdAccountId}/campaigns`,
    buildMetaProviderObjectName(plan, plan.campaign.localId, plan.campaign.name),
    campaignId,
  )) {
    created.campaignId = campaignId;
  }

  for (const adSet of plan.adSets) {
    if (adSet.existingId) continue;
    const objectId = optionalString(plan.reconciledObjects.adSetIds[adSet.localId]);
    if (objectId && hasDurableMetaCreateExchange(
      plan,
      `adset.${adSet.localId}`,
      `/${plan.setup.metaAdAccountId}/adsets`,
      buildMetaProviderObjectName(plan, adSet.localId, adSet.name),
      objectId,
    )) {
      created.adSetIds[adSet.localId] = objectId;
    }
  }

  for (const ad of plan.ads) {
    const objectId = optionalString(plan.reconciledObjects.adIds[ad.localId]);
    if (objectId && hasDurableMetaCreateExchange(
      plan,
      `ad.${ad.localId}`,
      `/${plan.setup.metaAdAccountId}/ads`,
      buildMetaProviderObjectName(plan, ad.localId, ad.name),
      objectId,
    )) {
      created.adIds[ad.localId] = objectId;
    }
  }

  return created;
}

function synchronizeMetaCreationEvidence(
  plan: MetaPublishPlan,
  requestLog: MetaProviderLogEntry[],
  responseLog: MetaProviderLogEntry[],
  reconciledObjects: MetaReconciledObjects,
) {
  const evidencePlan: MetaPublishPlan = { ...plan, requestLog, responseLog, reconciledObjects };
  const durable = getDurablyCreatedMetaObjects(evidencePlan);
  const provenance = reconciledObjects.provenance ??= { adSets: {}, ads: {} };
  provenance.adSets ??= {};
  provenance.ads ??= {};

  const campaignId = optionalString(reconciledObjects.campaignId);
  if (campaignId && durable.campaignId === campaignId) {
    reconciledObjects.ownedCampaignId = campaignId;
    provenance.campaign = "created";
  } else {
    delete reconciledObjects.ownedCampaignId;
    if (campaignId && hasExactNameAdoptionExchange(
      evidencePlan,
      "campaign.reconcile_missing",
      `/${plan.setup.metaAdAccountId}/campaigns`,
      campaignId,
    )) {
      provenance.campaign = "adopted";
    } else if (provenance.campaign === "created") {
      delete provenance.campaign;
    }
  }

  for (const [localId, objectId] of Object.entries(reconciledObjects.adSetIds)) {
    if (durable.adSetIds[localId] === objectId) {
      (reconciledObjects.ownedAdSetIds ??= {})[localId] = objectId;
      provenance.adSets[localId] = "created";
    } else {
      delete reconciledObjects.ownedAdSetIds?.[localId];
      if (hasExactNameAdoptionExchange(
        evidencePlan,
        `adset.${localId}.reconcile_missing`,
        `/${plan.setup.metaAdAccountId}/adsets`,
        objectId,
      )) {
        provenance.adSets[localId] = "adopted";
      } else if (provenance.adSets[localId] === "created") {
        delete provenance.adSets[localId];
      }
    }
  }

  for (const [localId, objectId] of Object.entries(reconciledObjects.adIds)) {
    if (durable.adIds[localId] === objectId) {
      (reconciledObjects.ownedAdIds ??= {})[localId] = objectId;
      provenance.ads[localId] = "created";
    } else {
      delete reconciledObjects.ownedAdIds?.[localId];
      if (hasExactNameAdoptionExchange(
        evidencePlan,
        `ad.${localId}.reconcile_missing`,
        `/${plan.setup.metaAdAccountId}/ads`,
        objectId,
      )) {
        provenance.ads[localId] = "adopted";
      } else if (provenance.ads[localId] === "created") {
        delete provenance.ads[localId];
      }
    }
  }
}

function hasExactNameAdoptionExchange(
  plan: MetaPublishPlan,
  step: string,
  edgePath: string,
  objectId: string,
): boolean {
  const requested = plan.requestLog.some((entry) =>
    entry.step === step && entry.method === "GET" && entry.path.startsWith(`${edgePath}?`)
  );
  return requested && plan.responseLog.some((entry) =>
    entry.step === step &&
    entry.method === "GET" &&
    entry.path.startsWith(`${edgePath}?`) &&
    isSuccessfulMetaResponse(entry) &&
    entry.response?.matchedObjectId === objectId
  );
}

function hasDurableMetaCreateExchange(
  plan: MetaPublishPlan,
  step: string,
  path: string,
  expectedName: string,
  objectId: string,
): boolean {
  const requested = plan.requestLog.some((entry) =>
    entry.step === step &&
    entry.method === "POST" &&
    entry.path === path &&
    entry.body?.name === expectedName
  );
  return requested && plan.responseLog.some((entry) =>
    entry.step === step &&
    entry.method === "POST" &&
    entry.path === path &&
    isSuccessfulMetaResponse(entry) &&
    entry.response?.id === objectId
  );
}

type MetaCampaignBidStrategyState = {
  id: string | null;
  name: string | null;
  accountId: string | null;
  objective: string | null;
  specialAdCategories: string[];
  specialAdCategoryCountries: string[];
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
  const path = `/${campaignId}?fields=id,name,account_id,objective,special_ad_categories,special_ad_category_country,daily_budget,lifetime_budget,status,effective_status,configured_status,bid_strategy`;
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
    id: optionalString(payload.id),
    name: optionalString(payload.name),
    accountId: optionalString(payload.account_id),
    objective: optionalString(payload.objective),
    specialAdCategories: metaStringList(payload.special_ad_categories),
    specialAdCategoryCountries: metaStringList(payload.special_ad_category_country),
    dailyBudgetMinorUnits: optionalMetaBudget(payload.daily_budget),
    lifetimeBudgetMinorUnits: optionalMetaBudget(payload.lifetime_budget),
    configuredStatus: optionalString(payload.configured_status),
    effectiveStatus: optionalString(payload.effective_status),
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
  if (typeof body.bytes !== "string" && typeof body.source !== "string") return body;

  return {
    ...body,
    ...(typeof body.bytes === "string" ? { bytes: `<redacted ${body.bytes.length} base64 chars>` } : {}),
    ...(typeof body.source === "string" ? { source: `<redacted ${body.source.length} base64 chars>` } : {}),
  };
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
        // HOUSING special-ad-category targeting requires a minimum radius
        // around city/suburb pins; omitting it gets the ad set rejected, so the
        // minimum is always applied ("selected suburbs only" simply means the
        // user picked their own pins rather than a broader recommendation).
        cities: controls.geo.locations.map((location) => ({
          key: location.key,
          radius: META_HOUSING_MIN_RADIUS_KM,
          distance_unit: "kilometer",
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
    const leadForm = copy.meta.leadForm;
    const defaults: MetaLeadFormDefaults = {
      headline: leadForm?.headline ?? "",
      intro: copy.meta.primaryText[0] ?? leadForm?.headline ?? "",
      contactFields: ["FIRST_NAME", "LAST_NAME", "EMAIL", "PHONE"],
      customQuestions: normalizeLeadFormQuestions(leadForm?.questions ?? []),
      thankYouTitle: leadForm?.thankYouScreen?.title ?? "",
      thankYouBody: leadForm?.thankYouScreen?.body ?? "",
      thankYouButtonType: "VIEW_WEBSITE",
      thankYouButtonText: "Visit website",
    };
    return {
      localId: `form_${index + 1}`,
      name: `${pack.campaign.market.suburb} ${defaults.headline}`,
      ...buildMetaInstantFormSpec(defaults, {
        privacyPolicyUrl: setup.privacyPolicyUrl,
        formCompletionUrl: completionUrl ?? setup.privacyPolicyUrl,
      }),
      questions: defaults.customQuestions,
    };
  });
}

/**
 * Maps each copy pack index to the lead form that survived deduplication in
 * buildLeadFormPlans, so creatives always reference a form that exists.
 */
function resolveLeadFormLocalIdForIndex(leadForms: MetaPublishLeadFormPlan[], pack: AdStudioCampaignPack, setup: MetaConnectionSetup, destinationUrl: string | undefined, index: number): string {
  const copy = pack.copyPacks[index];
  if (!copy) return leadForms[0]?.localId ?? "form_1";

  const questions = normalizeMetaLeadFormQuestions(copy.meta.leadForm.questions);
  const signature = JSON.stringify([
    copy.meta.leadForm.headline,
    questions,
    setup.privacyPolicyUrl,
    copy.meta.leadForm.thankYouScreen.title,
    copy.meta.leadForm.thankYouScreen.body,
    destinationUrl ?? setup.privacyPolicyUrl,
  ]);

  for (const form of leadForms) {
    const formSignature = JSON.stringify([
      form.headline,
      form.questions,
      form.privacyPolicyUrl,
      form.thankYouTitle,
      form.thankYouBody,
      form.thankYouWebsiteUrl,
    ]);
    if (formSignature === signature) return form.localId;
  }

  return leadForms[0]?.localId ?? "form_1";
}

function buildCreativePlans(
  pack: AdStudioCampaignPack,
  setup: MetaConnectionSetup,
  leadForms: MetaPublishLeadFormPlan[],
  destinationUrl?: string,
): MetaPublishCreativePlan[] {
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
  const imageObject = creative.canvas.objects.find((object) => object.role === "primary_image");
  const reference = imageObject?.content?.trim() || imageObject?.assetId?.trim() || "";

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

  if (asset.type === "video") {
    return Boolean(asset.videoId || asset.bytesBase64 || (asset.source === "storage" && asset.storagePath) || (asset.source === "url" && asset.url));
  }

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
    publishContractVersion: plan.publishContractVersion,
    complianceReportId: plan.complianceReportId,
    complianceSubjectHash: plan.complianceSubjectHash,
    complianceCheckedAt: plan.complianceCheckedAt,
    controls: plan.controls,
    source: plan.source ?? null,
  };
}

function planToRow(plan: MetaPublishPlan, userId: string) {
  return {
    id: plan.planId,
    workspace_id: plan.workspaceId,
    adstudio_campaign_id: plan.adStudioCampaignId,
    adstudio_export_id: plan.adStudioExportId,
    customer_ad_id: plan.customerAdId,
    campaign_id: plan.legacyCampaignId,
    provider_connection_id: plan.providerConnectionId,
    approval_request_id: plan.approvalRequestId,
    publication_snapshot_id: plan.publicationSnapshotId ?? null,
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
  adstudio_campaign_id: string | null;
  customer_ad_id: string | null;
  adstudio_export_id: string | null;
  campaign_id: string | null;
  provider_connection_id: string;
  approval_request_id: string | null;
  publication_snapshot_id: string | null;
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
    publishContractVersion?: string | null;
    complianceReportId?: string | null;
    complianceSubjectHash?: string;
    complianceCheckedAt?: string | null;
    controls?: MetaPublishControls;
    source?: MetaPublishPlan["source"];
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
    customerAdId: row.customer_ad_id,
    providerConnectionId: row.provider_connection_id,
    approvalRequestId: row.approval_request_id,
    publicationSnapshotId: row.publication_snapshot_id ?? null,
    adapter: row.adapter,
    status: normalizePersistedMetaPublishStatus(row.status),
    idempotencyKey: row.idempotency_key,
    publishContractVersion: planJson.publishContractVersion === "finished_clone_v1" ? "finished_clone_v1" : null,
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
    source: planJson.source ?? null,
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
    ownedAdSetIds: {},
    creativeIds: {},
    adIds: {},
    ownedAdIds: {},
    provenance: { adSets: {}, ads: {} },
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

function metaStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const normalized = optionalString(entry);
      return normalized ? [normalized] : [];
    });
  }
  const normalized = optionalString(value);
  return normalized ? [normalized] : [];
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
