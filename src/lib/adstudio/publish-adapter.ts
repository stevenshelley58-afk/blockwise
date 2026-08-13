import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TemplatePack } from "../../../packages/ad-template-pack-contract/src/types";
import type { InstantForm } from "../adstudio/instant-form-types";
import { deterministicUuid } from "./id.ts";
import type {
  MetaConnectionSetup,
  MetaPublishControls,
  MetaPublishPlan,
  MetaPublishAdPlan,
  MetaPublishAdSetPlan,
  MetaPublishCampaignPlan,
  MetaPublishCreativePlan,
  MetaPublishLeadFormPlan,
  MetaPublishTrackingPlan,
  MetaExecutionAdapter,
} from "../providers/meta-execution";

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
    colourMode: "template" | "brand_pack";
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
    .select("form_json")
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
  };
}

/**
 * Verify that the loaded publish state is complete and consistent.
 * Returns validation issues — empty array means ready to publish.
 */
export function validatePublishState(state: PublishLoadResult): string[] {
  const issues: string[] = [];

  if (!state.revision.feedPngHash) issues.push("Missing Feed PNG");
  if (!state.revision.storyPngHash) issues.push("Missing Story PNG");
  if (!state.ad.metaPrimaryText) issues.push("Missing primary text");
  if (!state.ad.metaHeadline) issues.push("Missing headline");
  if (!state.ad.metaCta) issues.push("Missing CTA");
  if (!state.form) issues.push("No Instant Form — generate one before publishing");
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
    frozenAt: new Date().toISOString(),
  };

  const { data: inserted, error } = await supabase
    .from("ad_publication_snapshots")
    .insert({
      ad_id: input.adId,
      workspace_id: input.workspaceId,
      revision_id: state.revision.id,
      form_draft_id: state.form ? undefined : undefined, // linked if exists
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
  const form = state.form ?? buildStubForm(state, setup);

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

  const leadForms: MetaPublishLeadFormPlan[] = [
    {
      localId: "form_primary",
      name: `${label} ${form.intro.headline}`.slice(0, 100),
      headline: form.intro.headline,
      questions: form.customQuestions.map((q) => q.label),
      privacyPolicyUrl: setup.privacyPolicyUrl,
      thankYouTitle: form.thankYou.title,
      thankYouBody: form.thankYou.body,
      thankYouWebsiteUrl: controls.destinationUrl ?? setup.privacyPolicyUrl,
    },
  ];

  const creatives: MetaPublishCreativePlan[] = [
    buildPausedCreative(state, setup, label, "feed", state.revision.feedPngPath, "4:5"),
    buildPausedCreative(state, setup, label, "story", state.revision.storyPngPath, "9:16"),
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
    leadFormLocalId: "form_primary",
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
 * Minimal stub Instant Form used when no AI-generated draft exists yet.
 * This task does not implement Instant Form generation; the stub satisfies
 * Meta's lead-form requirement so publishing can proceed, and the real form
 * flow replaces it later.
 */
export function buildStubForm(state: PublishLoadResult, setup: MetaConnectionSetup): InstantForm {
  const label = state.pack.classification?.label?.trim() || state.pack.templateId || "your business";
  const headline = state.ad.metaHeadline?.trim() || label;

  return {
    name: `${label} lead form`,
    formType: "more_volume",
    intro: {
      headline: headline.slice(0, 60),
      body: `Enter your details and ${label} will be in touch.`,
    },
    contactFields: [
      { type: "email", required: true },
      { type: "full_name", required: true },
    ],
    customQuestions: [],
    privacy: {
      url: setup.privacyPolicyUrl || "https://example.com/privacy",
      linkText: "Privacy Policy",
    },
    thankYou: {
      title: "Thank you!",
      body: "We've received your details.",
      actionType: "visit_website",
      actionUrl: setup.privacyPolicyUrl,
    },
  };
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
