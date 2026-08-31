import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TemplatePack } from "../../../packages/ad-template-pack-contract/src/types";
import type { InstantForm } from "../adstudio/instant-form-types";
import { deterministicUuid } from "./id.ts";
import {
  loadMetaPublishPlan,
  updateMetaPublishPlanExecution,
  type MetaPublishPlan,
  type MetaReconciledObjectStatus,
} from "../providers/meta-execution.ts";
import { buildMetaPlanMutation, type BuiltMetaPlanMutation } from "../providers/meta-mutations.ts";
import { executeMetaMutationById } from "../providers/meta-mutation-worker.ts";
import type { createSupabaseServiceClient } from "../supabase/service.ts";
import type {
  MetaConnectionSetup,
  MetaPublishControls,
  MetaPublishAdPlan,
  MetaPublishAdSetPlan,
  MetaPublishCampaignPlan,
  MetaPublishCreativePlan,
  MetaPublishLeadFormPlan,
  MetaPublishTrackingPlan,
  MetaExecutionAdapter,
} from "../providers/meta-execution.ts";

// ---------------------------------------------------------------------------
// Phase 7.2 — Publish adapter: new AdDocument → existing Meta pipeline
//
// Replaces client-supplied campaign-pack trust with authoritative server state.
// Replaces flat template_clone_image assumptions with layered document model.
// Replaces static forms with AI-generated Instant Forms.
// Replaces "Submit and go live" with "Paused on Meta" + separate activation.
// ---------------------------------------------------------------------------

export interface PublishInputV2 {
  adId: string;
  workspaceId: string;
  connectionId: string;
  setup: MetaConnectionSetup;
  controls: MetaPublishControls;
  adapter?: MetaExecutionAdapter;
}

export interface PublishLoadResult {
  ad: {
    id: string;
    templatePackId: string;
    colourMode: "template" | "brand_pack" | "custom";
    metaPrimaryText: string;
    metaHeadline: string;
    metaDescription: string;
    metaCta: string;
  };
  revision: {
    id: string;
    revisionNumber: number;
    documentHash: string;
    feedPngHash: string;
    feedPngPath: string;
    storyPngHash: string;
    storyPngPath: string;
  };
  pack: TemplatePack;
  form: InstantForm | null;
  formDraftId: string | null;
  formRevision: number | null;
}

export type PublishRequirements = {
  destinationMode: "website" | "instant_form";
  requiredCtaTypes: string[];
};

/** Read only the optional v2 publish contract; the canonical pack schema stays unchanged. */
export function readPublishRequirements(pack: unknown): PublishRequirements {
  if (!pack || typeof pack !== "object") return { destinationMode: "instant_form", requiredCtaTypes: [] };
  const candidate = (pack as Record<string, unknown>).publishRequirements;
  const metadata = (pack as Record<string, unknown>).metadata;
  const metadataRequirements = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).publishRequirements : null;
  const effectiveCandidate = candidate && typeof candidate === "object" ? candidate : metadataRequirements;
  if (!effectiveCandidate || typeof effectiveCandidate !== "object") return { destinationMode: "instant_form", requiredCtaTypes: [] };
  const record = effectiveCandidate as Record<string, unknown>;
  const nestedDestination = record.destination && typeof record.destination === "object"
    ? record.destination as Record<string, unknown>
    : null;
  const nestedKind = nestedDestination?.kind;
  const destinationMode = record.destinationMode === "website" || record.destinationMode === "instant_form"
    ? record.destinationMode
    : nestedKind === "url" || nestedKind === "article" ? "website"
      : nestedKind === "instant_form" ? "instant_form" : "instant_form";
  const requiredCtaTypes = Array.isArray(record.requiredCtaTypes)
    ? record.requiredCtaTypes.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  return { destinationMode, requiredCtaTypes };
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

/**
 * Load the authoritative server state for publishing.
 * Reads from ad_customer_ads, ad_revisions, ad_template_packs, ad_instant_form_drafts.
 * Rejects if the ad has unsaved changes (no active revision).
 */
export async function loadPublishState(
  supabase: SupabaseClient,
  adId: string,
  workspaceId: string,
): Promise<PublishLoadResult> {
  // 1. Load ad
  const { data: ad, error: adError } = await supabase
    .from("ad_customer_ads")
    .select("id, template_pack_id, colour_mode, meta_primary_text, meta_headline, meta_description, meta_cta, active_revision_id")
    .eq("id", adId)
    .eq("workspace_id", workspaceId)
    .single();

  if (adError || !ad) throw new PublishError("ad_not_found", "Ad not found");
  if (!ad.active_revision_id) throw new PublishError("not_saved", "Ad has no saved revision — Save before publishing");

  // 2. Load active revision
  const { data: revision, error: revError } = await supabase
    .from("ad_revisions")
    .select("id, revision_number, document_hash, feed_png_hash, feed_png_path, story_png_hash, story_png_path")
    .eq("id", ad.active_revision_id)
    .single();

  if (revError || !revision) throw new PublishError("revision_not_found", "Active revision not found");

  // 3. Load template pack
  const { data: packRow, error: packError } = await supabase
    .from("ad_template_packs")
    .select("pack_json")
    .eq("pack_id", ad.template_pack_id)
    .single();

  if (packError || !packRow) throw new PublishError("pack_not_found", "Template pack not found");
  const pack = packRow.pack_json as unknown as TemplatePack;

  // 4. Load latest Instant Form draft
  const { data: formRow } = await supabase
    .from("ad_instant_form_drafts")
    .select("id, form_json, revision")
    .eq("ad_id", adId)
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();

  const form = formRow ? (formRow.form_json as InstantForm) : null;

  return {
    ad: {
      id: ad.id,
      templatePackId: ad.template_pack_id,
      colourMode: ad.colour_mode,
      metaPrimaryText: ad.meta_primary_text,
      metaHeadline: ad.meta_headline,
      metaDescription: ad.meta_description,
      metaCta: ad.meta_cta,
    },
    revision: {
      id: revision.id,
      revisionNumber: revision.revision_number,
      documentHash: revision.document_hash,
      feedPngHash: revision.feed_png_hash,
      feedPngPath: revision.feed_png_path,
      storyPngHash: revision.story_png_hash,
      storyPngPath: revision.story_png_path,
    },
    pack,
    form,
    formDraftId: formRow?.id ?? null,
    formRevision: typeof formRow?.revision === "number" ? formRow.revision : null,
  };
}

/**
 * Verify that the loaded publish state is complete and consistent.
 * Returns validation issues — empty array means ready to publish.
 */
export function validatePublishState(
  state: PublishLoadResult,
  options: { controls?: MetaPublishControls; setup?: Partial<MetaConnectionSetup> } = {},
): string[] {
  const issues: string[] = [];
  const requirements = readPublishRequirements(state.pack);
  const mode = options.controls?.destinationMode ?? requirements.destinationMode;
  const destinationUrl = options.controls?.destinationUrl?.trim();

  if (!state.revision.feedPngHash) issues.push("Missing Feed PNG");
  if (!state.revision.storyPngHash) issues.push("Missing Story PNG");
  if (!state.ad.metaPrimaryText) issues.push("Missing primary text");
  if (!state.ad.metaHeadline) issues.push("Missing headline");
  if (!state.ad.metaCta) issues.push("Missing CTA");
  if (mode === "website" && (!destinationUrl || !isHttpsUrl(destinationUrl))) {
    issues.push("Missing valid HTTPS destination URL/article — add the article or website URL before publishing");
  }
  if (requirements.requiredCtaTypes.length > 0 && !requirements.requiredCtaTypes.includes(state.ad.metaCta)) {
    issues.push(`CTA must be one of: ${requirements.requiredCtaTypes.join(", ")}`);
  }
  if (mode === "instant_form") {
    if (!state.form) issues.push("No pinned Instant Form — generate and save one before publishing");
    if (!state.formDraftId || !state.formRevision || state.formRevision < 1) {
      issues.push("Instant Form draft identity is missing — save a real form revision before publishing");
    }
    if (state.form && !isHttpsUrl(state.form.privacy.url)) issues.push("Instant Form privacy policy must be a valid HTTPS URL");
    if (state.form && state.form.thankYou.actionType === "none") issues.push("Instant Form thank-you screen needs an action");
    if (state.form && state.form.thankYou.actionType === "call_now") issues.push("Instant Form call-now thank-you actions are not supported by this publisher yet");
    if (state.form && ["visit_website", "download"].includes(state.form.thankYou.actionType) && !isHttpsUrl(state.form.thankYou.actionUrl ?? destinationUrl)) {
      issues.push("Instant Form thank-you website action needs a valid HTTPS URL");
    }
  }
  if (state.ad.colourMode === "brand_pack" && !hasAllColours(state.pack.semanticColours)) {
    issues.push("Brand Pack is missing required colour roles");
  }

  return issues;
}

/**
 * Freeze a publication snapshot — locks the exact revision, form, and metadata.
 */
export async function freezePublicationSnapshot(
  supabase: SupabaseClient,
  input: PublishInputV2,
  state: PublishLoadResult,
): Promise<{ snapshotId: string }> {
  // Check if a snapshot already exists for this revision
  const { data: existing } = await supabase
    .from("ad_publication_snapshots")
    .select("id")
    .eq("ad_id", input.adId)
    .eq("revision_id", state.revision.id)
    .maybeSingle();

  if (existing) return { snapshotId: existing.id };

  const snapshot = {
    adId: input.adId,
    workspaceId: input.workspaceId,
    revisionNumber: state.revision.revisionNumber,
    documentHash: state.revision.documentHash,
    feedPngHash: state.revision.feedPngHash,
    storyPngHash: state.revision.storyPngHash,
    templateId: state.pack.templateId,
    templateVersion: state.pack.version,
    metaPrimaryText: state.ad.metaPrimaryText,
    metaHeadline: state.ad.metaHeadline,
    metaDescription: state.ad.metaDescription,
    metaCta: state.ad.metaCta,
    colourMode: state.ad.colourMode,
    form: state.form,
    formDraftId: state.formDraftId,
    formRevision: state.formRevision,
    frozenAt: new Date().toISOString(),
  };

  const { data: inserted, error } = await supabase
    .from("ad_publication_snapshots")
    .insert({
      ad_id: input.adId,
      workspace_id: input.workspaceId,
      revision_id: state.revision.id,
      form_draft_id: state.formDraftId,
      snapshot_json: snapshot as unknown as Record<string, unknown>,
    })
    .select("id")
    .single();

  if (error) throw new PublishError("snapshot_failed", error.message);

  return { snapshotId: inserted!.id };
}

/**
 * The editor stores Meta copy inside the AdDocument (document_json), not on
 * the ad row. loadPublishState reads ad_customer_ads.meta_* columns, so before
 * publishing we promote the frozen revision's copy onto the row. The revision
 * is authoritative: the publish always uses the LAST SAVED document.
 */
export async function backfillPublishMetaCopy(
  supabase: SupabaseClient,
  adId: string,
  workspaceId: string,
): Promise<void> {
  const { data: ad } = await supabase
    .from("ad_customer_ads")
    .select("active_revision_id")
    .eq("id", adId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!ad?.active_revision_id) return;

  const { data: revision } = await supabase
    .from("ad_revisions")
    .select("document_json")
    .eq("id", ad.active_revision_id)
    .maybeSingle();

  const document = revision?.document_json as
    | { metaPrimaryText?: string; metaHeadline?: string; metaDescription?: string; metaCta?: string }
    | null
    | undefined;

  if (!document) return;

  await supabase
    .from("ad_customer_ads")
    .update({
      meta_primary_text: document.metaPrimaryText ?? "",
      meta_headline: document.metaHeadline ?? "",
      meta_description: document.metaDescription ?? "",
      meta_cta: document.metaCta ?? "LEARN_MORE",
      updated_at: new Date().toISOString(),
    })
    .eq("id", adId)
    .eq("workspace_id", workspaceId);
}

// ---------------------------------------------------------------------------
// BW-M — Paused publish plan builder
//
// Builds a MetaPublishPlan whose campaign, ad set, lead form, creatives, and
// ads are ALL PAUSED, from the frozen publish state. Never "Live": activation
// is a separate later task. The plan can be persisted and executed by the
// existing Meta pipeline (meta-publish-worker / marketing_api adapter).
// ---------------------------------------------------------------------------

export interface PausedPublishPlanInput {
  adId: string;
  workspaceId: string;
  connectionId: string;
  setup: MetaConnectionSetup;
  controls?: MetaPublishControls;
  state: PublishLoadResult;
}

export function buildPausedMetaPublishPlan(input: PausedPublishPlanInput): MetaPublishPlan {
  const { state, setup } = input;
  const label = state.pack.classification?.label?.trim() || state.pack.templateId || "Blockwise ad";
  const country = controlsCountry(input.controls) || "AU";
  const controls = normalizePausedControls(input.controls ?? {}, country);
  const now = new Date().toISOString();
  const requirements = readPublishRequirements(state.pack);
  const mode = input.controls?.destinationMode ?? requirements.destinationMode;
  const issues = validatePublishState(state, { controls: { ...(input.controls ?? {}), destinationMode: mode }, setup });
  if (issues.length > 0) throw new PublishError("publish_dependencies_missing", issues.join("; "));
  const form = state.form;
  if (mode === "instant_form" && !form) throw new PublishError("publish_dependencies_missing", "No pinned Instant Form — generate and save one before publishing");

  const campaign: MetaPublishCampaignPlan = {
    localId: "campaign_main",
    name: `${label} — ${state.revision.revisionNumber}`,
    objective: "OUTCOME_LEADS",
    status: "PAUSED",
    specialAdCategories: ["HOUSING"],
    specialAdCategoryCountries: [country],
    budgetMode: "campaign",
  };

  const adSets: MetaPublishAdSetPlan[] = [
    {
      localId: "adset_primary",
      name: `${label} homeowners`,
      campaignLocalId: "campaign_main",
      billingEvent: "IMPRESSIONS",
      optimizationGoal: "LEAD_GENERATION",
      status: "PAUSED",
      dailyBudgetMinorUnits: controls.dailyBudgetMinorUnits ?? 2000,
      targeting: buildPausedTargeting(controls),
      startTime: controls.schedule?.startTime ?? null,
      endTime: controls.schedule?.endTime ?? null,
    },
  ];

  const leadForms: MetaPublishLeadFormPlan[] = mode === "instant_form" ? [{
      localId: "form_primary",
      name: `${label} ${form!.intro.headline}`.slice(0, 100),
      headline: form!.intro.headline,
      questions: form!.customQuestions.map((q) => q.label),
      privacyPolicyUrl: form!.privacy.url,
      thankYouTitle: form!.thankYou.title,
      thankYouBody: form!.thankYou.body,
      thankYouWebsiteUrl: form!.thankYou.actionUrl ?? controls.destinationUrl!,
    }] : [];

  const creatives: MetaPublishCreativePlan[] = [
    buildPausedCreative(state, setup, label, "feed", state.revision.feedPngPath, "4:5", mode),
    buildPausedCreative(state, setup, label, "story", state.revision.storyPngPath, "9:16", mode),
  ];

  const ads: MetaPublishAdPlan[] = [
    {
      localId: "ad_feed",
      name: `${label} Feed ad`,
      adSetLocalId: "adset_primary",
      creativeLocalId: "creative_feed",
      status: "PAUSED",
      variantTag: null,
    },
    {
      localId: "ad_story",
      name: `${label} Story ad`,
      adSetLocalId: "adset_primary",
      creativeLocalId: "creative_story",
      status: "PAUSED",
      variantTag: null,
    },
  ];

  const tracking: MetaPublishTrackingPlan = {
    utmSource: "meta",
    utmMedium: "paid_social",
    utmCampaign: slug(label),
    utmContentPrefix: slug(label),
  };

  const idempotencyKey = buildPausedPlanIdempotencyKey(input, state, country);
  const planId = deterministicUuid(`meta_publish_plan:${idempotencyKey}`);

  return {
    planId,
    workspaceId: input.workspaceId,
    adStudioCampaignId: input.adId,
    adStudioExportId: null,
    legacyCampaignId: null,
    providerConnectionId: input.connectionId,
    approvalRequestId: null,
    adapter: "marketing_api",
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
      leadFormIds: {},
      adSetIds: {},
      creativeIds: {},
      adIds: {},
    },
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
}

function buildPausedCreative(
  state: PublishLoadResult,
  setup: MetaConnectionSetup,
  label: string,
  placement: "feed" | "story",
  pngPath: string,
  format: "4:5" | "9:16",
  destinationMode: "website" | "instant_form",
): MetaPublishCreativePlan {
  return {
    localId: `creative_${placement}`,
    name: `${label} ${placement === "feed" ? "Feed" : "Story"}`,
    pageId: setup.pageId,
    instagramActorId: setup.instagramActorId ?? null,
    headline: state.ad.metaHeadline || label,
    primaryText: state.ad.metaPrimaryText || label,
    description: state.ad.metaDescription || "",
    cta: state.ad.metaCta || "LEARN_MORE",
    leadFormLocalId: destinationMode === "instant_form" ? "form_primary" : "",
    adStudioCreativeId: null,
    format,
    asset: pngPath
      ? {
          type: "image",
          source: "storage",
          mimeType: "image/png",
          filename: `${placement}.png`,
          storagePath: pngPath,
        }
      : null,
  };
}

function buildPausedTargeting(controls: MetaPublishControls): Record<string, unknown> {
  const geoLocations = controls.geo?.type === "cities" && controls.geo.locations.length > 0
    ? {
        cities: controls.geo.locations.map((location) => ({
          key: location.key,
          ...(controls.geo?.type === "cities" && controls.geo.includeSurroundingSuburbs
            ? { radius: 25, distance_unit: "kilometer" }
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
              radius: Math.max(25, controls.geo.radiusKm),
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

function normalizePausedControls(controls: MetaPublishControls, country: string): MetaPublishControls {
  return {
    dailyBudgetMinorUnits: controls.dailyBudgetMinorUnits && controls.dailyBudgetMinorUnits > 0
      ? Math.round(controls.dailyBudgetMinorUnits)
      : 2000,
    ...(controls.destinationUrl?.trim() ? { destinationUrl: controls.destinationUrl.trim() } : {}),
    ...(controls.destinationMode ? { destinationMode: controls.destinationMode } : {}),
    geo: controls.geo ?? { type: "country", country },
    schedule: {
      startTime: controls.schedule?.startTime ?? null,
      endTime: controls.schedule?.endTime ?? null,
    },
    placements: {
      publisherPlatforms: controls.placements?.publisherPlatforms?.length ? controls.placements.publisherPlatforms : ["facebook", "instagram"],
      facebookPositions: controls.placements?.facebookPositions ?? [],
      instagramPositions: controls.placements?.instagramPositions ?? [],
    },
  };
}

function controlsCountry(controls: MetaPublishControls | undefined): string | null {
  if (controls?.geo?.type === "country" && controls.geo.country?.trim()) return controls.geo.country.trim();
  return null;
}

/**
 * Deterministic idempotency key: same ad + revision + setup + controls →
 * same plan. Re-publishing the frozen revision is therefore idempotent and
 * the plan upsert (workspace_id, idempotency_key) never duplicates objects.
 */
function buildPausedPlanIdempotencyKey(
  input: PausedPublishPlanInput,
  state: PublishLoadResult,
  country: string,
): string {
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        revisionId: state.revision.id,
        revisionNumber: state.revision.revisionNumber,
        feedPngHash: state.revision.feedPngHash,
        storyPngHash: state.revision.storyPngHash,
        setup: input.setup,
        controls: input.controls ?? {},
        country,
      }),
    )
    .digest("hex")
    .slice(0, 16);

  return [
    "meta_publish",
    input.workspaceId,
    `ad_${input.adId}`,
    `revision_${state.revision.revisionNumber}`,
    `execution_${fingerprint}`,
  ].join(":");
}

/**
 * Resolve storage-sourced creative images to inline bytes just before the
 * adapter executes — mirrors meta-publish-worker's resolveStorageCreativeAssets
 * so plans stay small in the database. Storage paths must stay inside the
 * workspace bucket.
 */
export async function resolvePublishCreativeAssets(
  serviceSupabase: SupabaseClient,
  plan: MetaPublishPlan,
): Promise<MetaPublishPlan> {
  const creatives = await Promise.all(plan.creatives.map(async (creative) => {
    const asset = creative.asset;
    if (!asset || asset.source !== "storage" || !asset.storagePath || asset.bytesBase64 || asset.imageHash) {
      return creative;
    }

    const storagePath = asset.storagePath;
    if (!storagePath.startsWith(`${plan.workspaceId}/`) || storagePath.includes("..")) {
      throw new PublishError("creative_image_outside_workspace", `The finished ad image for ${creative.name} is outside this workspace.`);
    }

    const { data, error } = await serviceSupabase.storage.from("workspace-artifacts").download(storagePath);
    if (error || !data) {
      throw new PublishError("creative_image_missing", `The finished ad image for ${creative.name} could not be loaded. Regenerate the ad and try again.`);
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

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "meta";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasAllColours(colours: Record<string, string>): boolean {
  const required = ["background", "primary", "secondary", "accent", "mainText", "inverseText"];
  return required.every(r => colours[r] && colours[r]!.length > 0);
}

export class PublishError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// BW-Q — explicit Activate after a PAUSED publish
//
// Publish creates campaign / ad set / creative / ad objects PAUSED on Meta.
// Activation is a SEPARATE explicit action: it flips the created campaign,
// ad sets, and ads to ACTIVE through the existing meta_publish_plan_mutations
// machinery (safe activation — children first, campaign last, every object
// verified). It NEVER runs automatically and NEVER claims the ad was already
// live. With provider writes disabled it returns a clear dry-run receipt and
// changes nothing on Meta.
// ---------------------------------------------------------------------------

type ActivationServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type ActivationTargets = {
  campaignId: string;
  adSetIds: string[];
  adIds: string[];
};

/** The Meta object IDs created by a paused publish, or null when nothing exists. */
export function activationTargets(plan: MetaPublishPlan): ActivationTargets | null {
  const campaignId = plan.reconciledObjects.campaignId?.trim();
  if (!campaignId) return null;
  return {
    campaignId,
    adSetIds: Object.values(plan.reconciledObjects.adSetIds).filter((id): id is string => Boolean(id)),
    adIds: Object.values(plan.reconciledObjects.adIds).filter((id): id is string => Boolean(id)),
  };
}

export type ActivationReadiness =
  | { ok: true; targets: ActivationTargets }
  | { ok: false; code: "never_created_on_meta" | "not_paused_on_meta"; message: string };

/**
 * A publish plan can only be activated when it actually created PAUSED objects
 * on Meta (status paused_live with reconciled object IDs). A "draft" plan is a
 * dry-run publish — nothing exists on Meta, so activation must refuse, not
 * invent a live state.
 */
export function assertActivationReadiness(plan: MetaPublishPlan): ActivationReadiness {
  if (plan.status === "draft") {
    return {
      ok: false,
      code: "never_created_on_meta",
      message:
        "The publish for this ad was a dry run — no Meta objects were created (provider writes were disabled). " +
        "Enable provider writes, publish again, then Activate.",
    };
  }

  if (plan.status !== "paused_live") {
    return {
      ok: false,
      code: "not_paused_on_meta",
      message: `This publish plan is not paused on Meta (status: ${plan.status}). Activation only runs for a plan that created PAUSED objects.`,
    };
  }

  const targets = activationTargets(plan);
  if (!targets) {
    return {
      ok: false,
      code: "not_paused_on_meta",
      message: "The publish plan has no Meta object IDs — nothing was created on Meta, so there is nothing to activate.",
    };
  }

  return { ok: true, targets };
}

export type ActivationPlan =
  | {
      mode: "dry_run";
      planId: string;
      status: "paused";
      targets: ActivationTargets;
      message: string;
    }
  | {
      mode: "activate";
      planId: string;
      status: "activated";
      mutation: BuiltMetaPlanMutation;
      targets: ActivationTargets;
      message: string;
    };

/**
 * Decide what the Activate action does for a paused plan — without touching
 * Meta. When provider writes are disabled the outcome is a dry-run receipt
 * that says the campaign stays PAUSED (never a fake "live"). Otherwise it
 * builds the "activate" mutation the existing Meta mutation machinery runs.
 */
export function planActivation(
  plan: MetaPublishPlan,
  input: { requestedBy?: string | null; providerWritesEnabled: boolean },
): ActivationPlan {
  const readiness = assertActivationReadiness(plan);
  if (!readiness.ok) throw new PublishError(readiness.code, readiness.message);
  const { targets } = readiness;

  if (!input.providerWritesEnabled) {
    return {
      mode: "dry_run",
      planId: plan.planId,
      status: "paused",
      targets,
      message:
        "Activation was NOT applied — provider writes are disabled (BLOCKWISE_ENABLE_PROVIDER_WRITES=false). " +
        "The campaign stays PAUSED on Meta. Enable provider writes and publish again.",
    };
  }

  const mutation = buildMetaPlanMutation({
    workspaceId: plan.workspaceId,
    planId: plan.planId,
    requestedBy: input.requestedBy ?? null,
    action: "activate",
    payload: targets,
  });

  return {
    mode: "activate",
    planId: plan.planId,
    status: "activated",
    mutation,
    targets,
    message:
      "Activated on Meta — the campaign, ad sets, and ads are now ACTIVE and can deliver. " +
      "Nothing was live before this explicit Activate.",
  };
}

/**
 * Record the post-activation truth on the plan: every reconciled object is
 * ACTIVE. The plan status stays paused_live (that status describes the create
 * lifecycle); the applied "activate" mutation row is the activation record.
 */
export function markPlanObjectsActive(plan: MetaPublishPlan): MetaPublishPlan {
  const objectStatuses: NonNullable<MetaPublishPlan["reconciledObjects"]["objectStatuses"]> = {};

  if (plan.reconciledObjects.campaignId) {
    objectStatuses.campaign = {
      id: plan.reconciledObjects.campaignId,
      configuredStatus: "ACTIVE",
      effectiveStatus: "ACTIVE",
    };
  }

  objectStatuses.adSets = Object.fromEntries(
    Object.entries(plan.reconciledObjects.adSetIds).map(([localId, id]) => [
      localId,
      { id, configuredStatus: "ACTIVE", effectiveStatus: "ACTIVE" },
    ]),
  );
  objectStatuses.ads = Object.fromEntries(
    Object.entries(plan.reconciledObjects.adIds).map(([localId, id]) => [
      localId,
      { id, configuredStatus: "ACTIVE", effectiveStatus: "ACTIVE" },
    ]),
  );

  return {
    ...plan,
    reconciledObjects: { ...plan.reconciledObjects, objectStatuses },
    updatedAt: new Date().toISOString(),
  };
}

/** The most recent publish plan for an ad, or null when the ad was never published. */
export async function loadLatestPublishPlanForAd(
  serviceSupabase: ActivationServiceClient,
  workspaceId: string,
  adId: string,
): Promise<MetaPublishPlan | null> {
  const { data, error } = await serviceSupabase
    .from("meta_publish_plans")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("adstudio_campaign_id", adId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  return loadMetaPublishPlan(serviceSupabase, { workspaceId, planId: data.id });
}

export type ActivatePausedPublishInput = {
  adId: string;
  workspaceId: string;
  /** Optional explicit plan from the paused receipt; otherwise the latest plan for the ad. */
  planId?: string;
  requestedBy?: string | null;
  providerWritesEnabled: boolean;
  fetchImpl?: typeof fetch;
  compensationFetchImpl?: typeof fetch;
};

export type ActivatePausedPublishOutcome =
  | { mode: "dry_run"; planId: string; status: "paused"; targets: ActivationTargets; message: string }
  | {
      mode: "activate";
      planId: string;
      status: "activated";
      mutationId: string;
      targets: ActivationTargets;
      message: string;
    };

/**
 * Orchestrate the Activate action for a PAUSED Meta publish. NEVER auto-live:
 * only a plan that created PAUSED objects on Meta can be activated, the
 * customer's Activate click is the single explicit approval, and with provider
 * writes disabled the outcome is a dry-run receipt that changes nothing.
 */
export async function activatePausedMetaPublish(
  serviceSupabase: ActivationServiceClient,
  input: ActivatePausedPublishInput,
): Promise<ActivatePausedPublishOutcome> {
  const plan = input.planId
    ? await loadMetaPublishPlan(serviceSupabase, {
        workspaceId: input.workspaceId,
        planId: input.planId,
      })
    : await loadLatestPublishPlanForAd(serviceSupabase, input.workspaceId, input.adId);

  if (!plan) {
    throw new PublishError("no_paused_plan", "No paused Meta publish plan found for this ad — publish it first.");
  }

  const planned = planActivation(plan, {
    requestedBy: input.requestedBy,
    providerWritesEnabled: input.providerWritesEnabled,
  });

  if (planned.mode === "dry_run") {
    return {
      mode: "dry_run",
      planId: planned.planId,
      status: planned.status,
      targets: planned.targets,
      message: planned.message,
    };
  }

  const mutation = planned.mutation;
  const now = new Date().toISOString();

  // The Activate click IS the explicit approval — record the mutation and its
  // approval in one durable commit so the canonical worker (executeMetaMutationById)
  // can run it synchronously with approvalStatus "approved".
  const { error: mutationError } = await serviceSupabase
    .from("meta_publish_plan_mutations")
    .insert({
      id: mutation.mutationId,
      workspace_id: mutation.workspaceId,
      meta_publish_plan_id: mutation.planId,
      action: mutation.action,
      status: "approved",
      payload_json: mutation.payload,
      requested_by: mutation.requestedBy,
      request_log_json: mutation.requestLog,
      response_log_json: mutation.responseLog,
      last_error: mutation.lastError,
      updated_at: mutation.updatedAt,
    });

  if (mutationError) {
    throw new Error(mutationError.message);
  }

  const { data: approval, error: approvalError } = await serviceSupabase
    .from("approval_requests")
    .insert({
      workspace_id: mutation.workspaceId,
      target_type: mutation.approval.targetType,
      target_id: mutation.approval.targetId,
      status: "approved",
      requested_by: mutation.requestedBy,
      approved_by: mutation.requestedBy,
      resolved_at: now,
      risk_summary: mutation.approval.riskSummary,
    })
    .select("id,status,risk_summary")
    .single();

  if (approvalError || !approval) {
    throw new Error(approvalError?.message ?? "Unable to record the activation approval.");
  }

  const { error: linkError } = await serviceSupabase
    .from("meta_publish_plan_mutations")
    .update({ approval_request_id: approval.id, updated_at: now })
    .eq("workspace_id", mutation.workspaceId)
    .eq("id", mutation.mutationId);

  if (linkError) {
    throw new Error(linkError.message);
  }

  const executed = await executeMetaMutationById({
    serviceSupabase,
    workspaceId: input.workspaceId,
    mutationId: mutation.mutationId,
    fetchImpl: input.fetchImpl,
    compensationFetchImpl: input.compensationFetchImpl,
  });

  if (executed.status !== "applied") {
    throw new PublishError(
      "activation_failed",
      executed.lastError ?? "Meta could not activate the paused campaign — it stays PAUSED on Meta.",
    );
  }

  // Record the activated object statuses on the plan (the mutation row is the
  // durable activation record; the plan status itself stays paused_live).
  await updateMetaPublishPlanExecution(serviceSupabase, markPlanObjectsActive(plan));

  return {
    mode: "activate",
    planId: plan.planId,
    status: "activated",
    mutationId: mutation.mutationId,
    targets: planned.targets,
    message: planned.message,
  };
}
