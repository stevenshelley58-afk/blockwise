// The complete server-side template-campaign generation pipeline, callable from
// the campaigns POST route (synchronous fallback) or the trigger.dev task
// "adstudio.generate.template" (the normal async path; no 120s route ceiling).
//
// Order matters and is the product: brand kit -> slot images -> brief-grounded
// copy (on-image fields + feed copy in one pass) -> reference clone renders
// (feed + story) -> deterministic pack build -> provided-copy application ->
// one transactional persist. The customer gets the finished ad the moment the
// renders persist; vision QA runs AFTER persistence as advisory enrichment
// (editor regions + copy warnings) and never blocks or rerolls a render. The
// editor's history (undo/compare) plus in-place fixes replaced the old
// blocking reroll gate.
import { randomUUID } from "node:crypto";

import { applyProvidedCopyToCampaignPack } from "./campaign-copy-enrichment.ts";
import {
  cloneModelProfileForQuality,
  generateCloneWithCascade,
  normalizeCloneRenderAspect,
  persistCloneRender,
  resolveCloneProviders,
  type CloneGenerationResult,
} from "./clone-generation.ts";
import { detectCloneRegions, type CloneRegion } from "./clone-qa.ts";
import { generateAdStudioTemplateCopy, type AdStudioCopyFields } from "./copy-generation.ts";
import { buildCloneCampaignPack, buildCloneCreative } from "./clone-campaign.ts";
import { persistAdStudioCampaignPack } from "./persistence.ts";
import { ensureRasterReferenceImage } from "./rasterize-reference.ts";
import {
  buildCloneImageRequest,
  resolveCloneCopy,
  type CloneInputs,
} from "./reference-clone.ts";
import { resolveAdStudioImageForModel } from "./resolve-image-for-model.ts";
import { resolveApprovedAdStudioTemplate } from "./template-resolver.ts";
import type { AdStudioTemplate } from "./templates.ts";
import { resolveAdStudioGenerationBrandKit } from "./trial-brand-kit.ts";
import type {
  AdStudioBrandKit,
  AdStudioCampaignPack,
  FirstAdInput,
} from "./types.ts";
import type { ImageProviderAdapter, ImageProviderRequest } from "./providers.ts";
import type { createSupabaseServerClient } from "../supabase/server.ts";
import type { createSupabaseServiceClient } from "../supabase/service.ts";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/**
 * Both the RLS-scoped route client and the service-role client satisfy the same
 * runtime API; downstream helpers are typed against the server client, so the
 * union is normalised once at the top of the run.
 */
export type SupabaseGenerationClient = SupabaseServerClient | SupabaseServiceClient;

/** The campaigns POST body — shared with the route and the job payload. */
export type CreateCampaignBody = {
  brandKit?: AdStudioBrandKit;
  suburb?: string;
  city?: string;
  state?: string;
  firstAd: FirstAdInput;
};

export type RunTemplateCampaignGenerationInput = {
  supabase: SupabaseGenerationClient;
  workspaceId: string;
  userId: string;
  /** Absolute base URL used to resolve the template's public sample image. */
  origin: string;
  body: CreateCampaignBody;
  workspaceName?: string;
  region?: string;
  /** From the route's credit reservation; drives the trial fallback brand kit. */
  isTrialWorkspace?: boolean;
};

export type RunTemplateCampaignGenerationResult = {
  campaignId: string;
  campaignPack: AdStudioCampaignPack;
  /**
   * Fire-and-forget region detection: after the customer has the ad, one
   * vision call per format locates the editable hit-boxes and writes them
   * onto the persisted creatives. Never throws; the main pipeline does not
   * await the result.
   */
  enrichRegions: () => Promise<void>;
  /**
   * The story (9:16) render, generated in parallel with the feed, persists
   * and patches into the already-created campaign once it lands. Undefined
   * when the story render failed during generation (feed stands alone).
   * Callers schedule this via `after()` (route) or await it (trigger task).
   */
  storyTask?: Promise<void>;
};

const PRIMARY_CLONE_FORMAT = "4:5" as const;
const STORY_CLONE_FORMAT = "9:16" as const;
const STORY_RECOMPOSE_PROMPT =
  "Recompose this exact ad design as a 9:16 vertical story: same panel, colours, typography, photo, and copy; extend the background naturally to fill the taller frame; keep all essential content and text inside the central 80% width, with the top and bottom 250px free of text.";

type TemplateCloneRenderFormat = typeof PRIMARY_CLONE_FORMAT | typeof STORY_CLONE_FORMAT;

type GeneratedCloneRender = CloneGenerationResult & {
  attempt: number;
};

type PersistedCloneRender = GeneratedCloneRender & {
  image: string;
};

export function buildTemplateCloneRequestsByFormat(
  template: AdStudioTemplate,
  inputs: CloneInputs,
): Record<TemplateCloneRenderFormat, ImageProviderRequest> {
  const primary = buildCloneImageRequest(template, inputs);
  const storyBase = buildCloneImageRequest(template, {
    ...inputs,
    aspectRatio: STORY_CLONE_FORMAT,
  });

  return {
    [PRIMARY_CLONE_FORMAT]: primary,
    [STORY_CLONE_FORMAT]: {
      ...storyBase,
      prompt: `${STORY_RECOMPOSE_PROMPT}\n\n${storyBase.prompt}`,
    },
  };
}

type CloneRenderDependencies = {
  generate?: typeof generateCloneWithCascade;
  normalize?: typeof normalizeCloneRenderAspect;
};

/**
 * One final-quality render per format: provider cascade (bounded fallback
 * inside) then an exact aspect crop. No vision gate, no reroll — the customer
 * sees this render as soon as it persists, and the editor regions are
 * detected afterwards via enrichCloneCreativesWithRegions.
 */
export async function generateFinalCloneRender(input: {
  format: TemplateCloneRenderFormat;
  providers: ImageProviderAdapter[];
  request: ImageProviderRequest;
  workspaceId: string;
  userId: string;
  correlationId: string;
  modelProfile?: "image_draft" | "image_final";
}, dependencies: CloneRenderDependencies = {}): Promise<GeneratedCloneRender> {
  const generate = dependencies.generate ?? generateCloneWithCascade;
  const normalize = dependencies.normalize ?? normalizeCloneRenderAspect;

  const generated = await generate({
    providers: input.providers,
    request: { ...input.request, seed: (input.request.seed ?? 0) + 1 },
    workspaceId: input.workspaceId,
    userId: input.userId,
    correlationId: input.correlationId,
    attempt: 1,
    modelProfile: input.modelProfile,
  });
  const exactAssetUrl = await normalize(generated.assetUrl, input.format);
  return { ...generated, assetUrl: exactAssetUrl, attempt: 1 };
}

export type CloneRegionsEnrichmentInput = {
  supabase: SupabaseGenerationClient;
  workspaceId: string;
  userId: string;
  correlationId: string;
  expectedCopy: Record<string, string>;
  /** Primary format first. */
  renders: Array<{ format: TemplateCloneRenderFormat; creativeId: string; imageUrl: string }>;
};

/**
 * Post-persist advisory pass: one vision call per format produces the editor
 * regions, written onto the already-persisted creatives. Failures are
 * contained per format — the customer keeps the ad either way, and a creative
 * that already has regions (a fast in-place edit) is never overwritten.
 */
export async function enrichCloneCreativesWithRegions(
  input: CloneRegionsEnrichmentInput,
): Promise<void> {
  const supabase = input.supabase as SupabaseServerClient;

  await Promise.all(input.renders.map(async (render) => {
    try {
      const regions: CloneRegion[] = await detectCloneRegions({
        workspaceId: input.workspaceId,
        userId: input.userId,
        correlationId: input.correlationId,
        imageUrl: render.imageUrl,
        expectedCopy: input.expectedCopy,
        format: render.format,
      });
      if (regions.length === 0) return;

      const { data: row, error } = await supabase
        .from("adstudio_creatives")
        .select("id, canvas_json")
        .eq("workspace_id", input.workspaceId)
        .eq("id", render.creativeId)
        .maybeSingle();
      if (error || !row) return;
      const canvas = (row.canvas_json ?? {}) as Record<string, unknown>;
      const existing = canvas.cloneQa as Record<string, unknown> | undefined;
      if (existing && Array.isArray(existing.regions) && existing.regions.length > 0) return;
      const qaShell = {
        ...(existing ?? {}),
        passed: true,
        attempts: 1,
        checkedAt: new Date().toISOString(),
        copyChecks: existing?.copyChecks ?? [],
        defects: [],
        regions,
      };
      await supabase
        .from("adstudio_creatives")
        .update({ canvas_json: { ...canvas, cloneQa: qaShell }, updated_at: new Date().toISOString() })
        .eq("workspace_id", input.workspaceId)
        .eq("id", render.creativeId);
    } catch {
      // Contained — never break the pipeline for a missing vision pass.
    }
  }));
}

export async function runClonePersistencePipeline<
  Format extends string,
  Generated,
  Persisted,
  Campaign,
>(input: {
  formats: readonly Format[];
  generateAccepted(format: Format): Promise<Generated>;
  persistClone(format: Format, generated: Generated): Promise<Persisted>;
  buildCampaign(persistedByFormat: Record<Format, Persisted>): Campaign;
  persistCampaign(campaign: Campaign): Promise<void>;
}): Promise<{ persistedByFormat: Record<Format, Persisted>; campaign: Campaign }> {
  const acceptedEntries = await Promise.all(
    input.formats.map(async (format) => [format, await input.generateAccepted(format)] as const),
  );
  const acceptedByFormat = Object.fromEntries(acceptedEntries) as Record<Format, Generated>;

  const persistedEntries = await Promise.all(
    input.formats.map(async (format) => [
      format,
      await input.persistClone(format, acceptedByFormat[format]),
    ] as const),
  );
  const persistedByFormat = Object.fromEntries(persistedEntries) as Record<Format, Persisted>;
  const campaign = input.buildCampaign(persistedByFormat);
  await input.persistCampaign(campaign);
  return { persistedByFormat, campaign };
}

export async function runTemplateCampaignGeneration(
  input: RunTemplateCampaignGenerationInput,
): Promise<RunTemplateCampaignGenerationResult> {
  const supabase = input.supabase as SupabaseServerClient;
  const { body } = input;
  const firstAd = body.firstAd;

  if (!firstAd) throw new Error("Ad generation requires a selected template and customer assets.");
  if (!firstAd.description?.trim()) {
    throw new Error("Add a short description so Blockwise knows what to write.");
  }

  const template = await resolveApprovedAdStudioTemplate({
    templateId: firstAd.templateId,
  });

  const brandKitResult = await resolveAdStudioGenerationBrandKit({
    supabase,
    workspaceId: input.workspaceId,
    workspaceName: input.workspaceName,
    region: input.region,
    userId: input.userId,
    submittedBrandKit: body.brandKit,
    isTrialWorkspace: input.isTrialWorkspace ?? false,
  });
  if (!brandKitResult.ok) {
    throw new Error(brandKitResult.error);
  }
  const brandKit = brandKitResult.brandKit;

  // Resolve each supplied customer image (keyed by slot role or object id, the
  // same contract as customer generation) to a model-consumable reference.
  const suppliedImages = firstAd.imageDataUrls ?? {};
  const resolvedImages: Record<string, string> = {};
  for (const slot of template.inputs.images) {
    const brandLogo = /logo/i.test(slot.key)
      ? brandKit.logos.primaryLogoUrl ?? brandKit.logos.darkLogoUrl ?? brandKit.logos.lightLogoUrl ?? brandKit.logos.faviconUrl
      : undefined;
    const ref = suppliedImages[slot.key] ?? brandLogo;
    if (!ref?.trim()) continue;
    const resolved = await resolveAdStudioImageForModel(supabase, input.workspaceId, ref.trim());
    if (!resolved) {
      throw new Error(`Image for "${slot.label}" could not be read.`);
    }
    resolvedImages[slot.key] = resolved;
  }

  // Single-image submissions may arrive only as firstAd.imageDataUrl.
  const primarySlot = template.inputs.images.find((slot) => slot.required) ?? template.inputs.images[0];
  if (primarySlot && !resolvedImages[primarySlot.key] && firstAd.imageDataUrl?.trim()) {
    const resolved = await resolveAdStudioImageForModel(supabase, input.workspaceId, firstAd.imageDataUrl.trim());
    if (resolved) resolvedImages[primarySlot.key] = resolved;
  }

  const missingSlot = template.inputs.images.find((slot) => slot.required && !resolvedImages[slot.key]);
  if (missingSlot) {
    throw new Error(`Missing required image: ${missingSlot.label}`);
  }

  const correlationId = randomUUID();
  const sourceImageUrl = primarySlot ? resolvedImages[primarySlot.key] : Object.values(resolvedImages)[0];

  // Customer-typed on-image values (price, address, phone…) override the
  // model's suggestions VERBATIM — the copy model must never invent facts the
  // customer supplies. QA then verifies these exact strings on the render.
  const customerOnImage: Record<string, string> = {};
  for (const field of template.inputs.text) {
    const provided = firstAd.onImageCopy?.[field.key]?.trim();
    if (provided) customerOnImage[field.key] = provided;
  }

  // Point 10: when the customer supplied BOTH complete feed copy (headline +
  // primary text) AND every required on-image text field, the 25-47s model copy
  // pass is pure overhead — build the copy result straight from their values.
  // Anything short of that falls back to the single structured copy call so the
  // ad never renders with a blank label.
  const feedCopyComplete =
    Boolean(firstAd.copy?.headline.trim()) && Boolean(firstAd.copy?.primaryText.trim());
  const requiredTextFields = template.inputs.text.filter((field) => field.required);
  const onImageComplete = requiredTextFields.every((field) => Boolean(customerOnImage[field.key]?.trim()));
  const providedCopy: AdStudioCopyFields | undefined =
    feedCopyComplete && onImageComplete && firstAd.copy
      ? {
          headline: firstAd.copy.headline.trim(),
          primaryText: firstAd.copy.primaryText.trim(),
          description: firstAd.copy.description.trim(),
          cta: firstAd.copy.cta.trim() || "Learn more",
        }
      : undefined;

  const copyResult = providedCopy
    ? { onImage: customerOnImage, copy: providedCopy, source: "provided" as const }
    : await generateAdStudioTemplateCopy({
        workspaceId: input.workspaceId,
        userId: input.userId,
        correlationId,
        description: firstAd.description,
        fields: template.inputs.text.map((field) => ({
          key: field.key,
          label: field.label,
          maxLength: field.maxLength,
          sample: field.sample,
        })),
        sourceImageUrl,
        context: {
          goal: template.goal,
          templateName: template.name,
          templateHint: template.audienceIntent,
          businessName: brandKit.identity.tradingName ?? brandKit.identity.businessName,
          voice: brandKit.tone.voice,
          preferredPhrases: brandKit.tone.preferredPhrases,
          neverSay: brandKit.tone.avoid,
        },
      });

  // When the model ran, customer on-image values still win verbatim; when the
  // customer supplied everything, copyResult.onImage IS the customer's values.
  const onImageCopy = { ...copyResult.onImage, ...customerOnImage };

  // Gallery samples are SVGs, which no image provider accepts; rasterize to
  // a PNG data URL before the clone requests are built. The image lane runs
  // one native feed render and one recomposed 9:16 story render in parallel;
  // both persist as soon as they exist and the advisory QA pass follows.
  const referenceImage = await ensureRasterReferenceImage(
    new URL(template.sample.imageSrc, input.origin).toString(),
  );
  const expectedCopy = resolveCloneCopy(template, onImageCopy);
  const cloneRequestsByFormat = buildTemplateCloneRequestsByFormat(template, {
    referenceImage,
    images: resolvedImages,
    copy: onImageCopy,
    brandHex: brandKit.colours.accent || brandKit.colours.primary,
  });
  const generationQuality = firstAd.generationQuality ?? "fast";
  const providers = await resolveCloneProviders(generationQuality);
  const modelProfile = cloneModelProfileForQuality(generationQuality);
  // --- Feed-first critical path (Point 8): both formats generate in parallel,
  // the customer gets the 4:5 ad the instant it persists, the 9:16 story
  // patches into the already-created campaign in the background. ---

  // Generation is the slow part — start both NOW.
  const feedGenPromise = generateFinalCloneRender({
    format: PRIMARY_CLONE_FORMAT,
    providers,
    request: cloneRequestsByFormat[PRIMARY_CLONE_FORMAT],
    workspaceId: input.workspaceId,
    userId: input.userId,
    correlationId,
    modelProfile,
  });
  const storyGenPromise = generateFinalCloneRender({
    format: STORY_CLONE_FORMAT,
    providers,
    request: cloneRequestsByFormat[STORY_CLONE_FORMAT],
    workspaceId: input.workspaceId,
    userId: input.userId,
    correlationId,
    modelProfile,
  });

  // Await only the feed: generate → normalize → upload.
  const feedRender = await feedGenPromise;
  const feedPersisted: PersistedCloneRender = {
    ...feedRender,
    image: await persistCloneRender({
      supabase,
      workspaceId: input.workspaceId,
      assetUrl: feedRender.assetUrl,
      fileNameSeed: `${correlationId}-clone-${PRIMARY_CLONE_FORMAT.replace(":", "x")}`,
    }),
  };

  // Build the campaign with feed-only and persist it immediately — the
  // customer has their ad now, without waiting for the story render.
  const feedPack = applyProvidedCopyToCampaignPack(
    buildCloneCampaignPack({
      workspaceId: input.workspaceId,
      brandKit,
      suburb: body.suburb ?? "Scarborough",
      city: body.city ?? "Perth",
      state: body.state ?? "WA",
      firstAd: {
        ...firstAd,
        imageDataUrl: feedPersisted.image,
        templateCloneImage: feedPersisted.image,
        templateCloneImagesByFormat: {
          [PRIMARY_CLONE_FORMAT]: feedPersisted.image,
        },
        templateCloneProvider: feedPersisted.provider,
        templateCloneModel: feedPersisted.model,
        copy: copyResult.copy,
      },
    }),
    copyResult.copy,
  );

  // Replace the pack's offer-library defaults with the brief-grounded feed copy
  // (full AI enrichment on template ads was a past regression — it overwrote
  // curated copy with generic text and collapsed CTAs to "Learn more").
  const persisted = await persistAdStudioCampaignPack(supabase, feedPack, input.userId);
  if (persisted.error) {
    throw new Error(
      `Your ad was generated but could not be saved (${persisted.error.message}). Please try again.`,
    );
  }

  // Region detection for the feed creative (fires after the response).
  const feedCreative = feedPack.creatives.find((c) => c.format === PRIMARY_CLONE_FORMAT);
  const enrichRegions = () =>
    feedCreative
      ? enrichCloneCreativesWithRegions({
          supabase: input.supabase,
          workspaceId: input.workspaceId,
          userId: input.userId,
          correlationId,
          expectedCopy,
          renders: [{ format: PRIMARY_CLONE_FORMAT, creativeId: feedCreative.creativeId, imageUrl: feedRender.assetUrl }],
        })
      : Promise.resolve();

  // Story background task: the story promise is already in flight (started
  // in parallel above). When it lands, persist it, patch the campaign, and
  // run region detection for the story creative. Never throws outward.
  const storyTask = persistStoryInBackground({
    supabase,
    workspaceId: input.workspaceId,
    userId: input.userId,
    correlationId,
    expectedCopy,
    campaignId: feedPack.campaign.campaignId,
    variantId: feedPack.variants[0].variantId,
    template,
    storyGenPromise,
  });

  return { campaignId: feedPack.campaign.campaignId, campaignPack: feedPack, enrichRegions, storyTask };
}

/**
 * Awaits the in-flight story (9:16) render, persists it, patches the
 * already-created campaign row (adds the format + creative), and runs
 * region detection. All errors are contained — the feed ad stands alone.
 */
async function persistStoryInBackground(input: {
  supabase: SupabaseServerClient;
  workspaceId: string;
  userId: string;
  correlationId: string;
  expectedCopy: Record<string, string>;
  campaignId: string;
  variantId: string;
  template: AdStudioTemplate;
  storyGenPromise: Promise<GeneratedCloneRender>;
}): Promise<void> {
  try {
    const storyRender = await input.storyGenPromise;
    const storyImage = await persistCloneRender({
      supabase: input.supabase,
      workspaceId: input.workspaceId,
      assetUrl: storyRender.assetUrl,
      fileNameSeed: `${input.correlationId}-clone-${STORY_CLONE_FORMAT.replace(":", "x")}`,
    });

    const storyCreative = buildCloneCreative({
      campaignId: input.campaignId,
      variantId: input.variantId,
      template: input.template,
      format: STORY_CLONE_FORMAT,
      cloneImage: storyImage,
    });

    // Patch the campaign: add the story format to the declared formats.
    const { data: campaignRow } = await input.supabase
      .from("adstudio_campaigns")
      .select("creative_formats_json")
      .eq("id", input.campaignId)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle();
    const currentFormats = (campaignRow?.creative_formats_json as string[] | null) ?? [];
    await input.supabase
      .from("adstudio_campaigns")
      .update({
        creative_formats_json: [...new Set([...currentFormats, STORY_CLONE_FORMAT])],
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.campaignId)
      .eq("workspace_id", input.workspaceId);

    // Insert the story creative row.
    await input.supabase.from("adstudio_creatives").insert({
      id: storyCreative.creativeId,
      workspace_id: input.workspaceId,
      campaign_id: input.campaignId,
      variant_id: input.variantId,
      format: STORY_CLONE_FORMAT,
      width: storyCreative.canvas.width,
      height: storyCreative.canvas.height,
      canvas_json: storyCreative.canvas,
      render_status: "rendered",
      preview_svg: null,
      updated_at: new Date().toISOString(),
    });

    // Region detection for the story creative.
    await enrichCloneCreativesWithRegions({
      supabase: input.supabase,
      workspaceId: input.workspaceId,
      userId: input.userId,
      correlationId: input.correlationId,
      expectedCopy: input.expectedCopy,
      renders: [{ format: STORY_CLONE_FORMAT, creativeId: storyCreative.creativeId, imageUrl: storyRender.assetUrl }],
    });
  } catch (error) {
    // Story failure must NEVER fail the feed. Log and contain.
    console.error("adstudio: story (9:16) background persist failed", error);
  }
}
