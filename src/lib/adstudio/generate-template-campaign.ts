// The complete server-side template-campaign generation pipeline, callable from
// the Vercel campaigns route (customer fast path) or the VPS recovery worker.
//
// Order matters and is the product: brand kit -> slot images -> brief-grounded
// copy (on-image fields + feed copy in one pass) -> reference clone renders
// (feed + story) -> deterministic pack build -> provided-copy application ->
// one transactional persist. Every candidate passes the subject-invariant
// image-model likeness gate before persistence; failed candidates feed one
// correction back through the same reference-clone request builder.
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
import {
  MAX_RUNTIME_CLONE_CANDIDATES,
  TemplateCampaignQaError,
  cloneQualityPassed,
  reviewCloneCandidate,
} from "./clone-quality-gate.ts";
import { buildPrebuiltTemplateCloneQa } from "./clone-regions.ts";
import { deriveAndPersistTemplateTextLayers } from "./layer-derivation.ts";
import { generateAdStudioTemplateCopy, type AdStudioCopyFields } from "./copy-generation.ts";
import { buildCloneCampaignPack, buildCloneCreative } from "./clone-campaign.ts";
import { loadAdStudioCampaignPack, persistAdStudioCampaignPack } from "./persistence.ts";
import { ensureRasterReferenceImage } from "./rasterize-reference.ts";
import {
  buildCloneImageRequest,
  resolveCloneCopy,
  type CloneInputs,
} from "./reference-clone.ts";
import { resolveAdStudioImageForModel } from "./resolve-image-for-model.ts";
import { resolveApprovedAdStudioTemplate } from "./template-resolver.ts";
import { deterministicEditingReadiness, type AdStudioTemplate } from "./templates.ts";
import { resolveAdStudioGenerationBrandKit } from "./trial-brand-kit.ts";
import type {
  AdStudioBrandKit,
  AdStudioCampaignPack,
  AdStudioCreative,
  FirstAdInput,
  AdStudioCloneQualityReview,
} from "./types.ts";
import type { ImageProviderAdapter, ImageProviderRequest } from "./providers.ts";
import {
  refundWorkspaceCreditReservation,
  settleWorkspaceCreditReservation,
  type WorkspaceCreditReservation,
} from "../credits/workspace-credits.ts";
import { recordCustomerActivationMilestone } from "../activation/customer-activation.ts";
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
  clientMutationId?: string;
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
  /** Server-owned two-render reservation settled independently by format. */
  creditReservation?: WorkspaceCreditReservation;
  /** Stable run identifier persisted before provider work starts. */
  correlationId?: string;
  /** Deterministic campaign checkpoint used to resume after a function crash. */
  expectedCampaignId?: string;
};

export type RunTemplateCampaignGenerationResult = {
  campaignId: string;
  campaignPack: AdStudioCampaignPack;
  /** Background construction of the optional instant text-editing plate. */
  editingLayersTask: Promise<void>;
  /** Ready templates are not released to the customer until that task settles. */
  requiresDeterministicEditing: boolean;
  /**
   * The story (9:16) render starts after the provider returns the feed, then
   * overlaps feed persistence and response preparation.
   * and patches into the already-created campaign once it lands. Undefined
   * when the story render failed during generation (feed stands alone).
   * Callers schedule this via `after()` (route) or await it (VPS recovery).
   */
  storyTask?: Promise<void>;
};

export async function assertDeterministicFeedEditingReady(input: {
  supabase: SupabaseGenerationClient;
  workspaceId: string;
  campaignId: string;
}): Promise<void> {
  const { data, error } = await input.supabase
    .from("adstudio_creatives")
    .select("canvas_json")
    .eq("workspace_id", input.workspaceId)
    .eq("campaign_id", input.campaignId)
    .eq("format", PRIMARY_CLONE_FORMAT)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const canvas = (data?.canvas_json ?? {}) as AdStudioCreative["canvas"];
  const currentImage = canvas.objects?.[0]?.content ?? canvas.objects?.[0]?.assetId ?? "";
  if (
    !currentImage
    || canvas.textLayers?.status !== "ready"
    || !canvas.textLayers.deterministicOnly
    || !canvas.textLayers.validFor.includes(currentImage)
  ) {
    throw new Error("The ad was created, but exact text editing did not finish preparing.");
  }
}

async function resumePersistedTemplateCampaign(input: {
  supabase: SupabaseGenerationClient;
  workspaceId: string;
  userId: string;
  correlationId: string;
  expectedCampaignId: string;
  template: AdStudioTemplate;
}): Promise<RunTemplateCampaignGenerationResult | null> {
  const campaignPack = await loadAdStudioCampaignPack(
    input.supabase as SupabaseServerClient,
    input.workspaceId,
    input.expectedCampaignId,
  );
  if (!campaignPack) return null;

  const feedCreative = campaignPack.creatives.find((creative) => creative.format === PRIMARY_CLONE_FORMAT);
  const imageRef = feedCreative?.canvas.objects.find((object) => object.role === "primary_image")?.content
    ?? feedCreative?.canvas.objects.find((object) => object.role === "primary_image")?.assetId;
  if (!feedCreative || !imageRef) {
    throw new Error("The persisted generation checkpoint has no finished Feed creative.");
  }

  const editingLayersTask = prepareCloneCreativeTextLayers({
    supabase: input.supabase,
    workspaceId: input.workspaceId,
    userId: input.userId,
    correlationId: input.correlationId,
    template: input.template,
    renders: [{
      format: PRIMARY_CLONE_FORMAT,
      creativeId: feedCreative.creativeId,
      imageRef,
    }],
  });
  void editingLayersTask.catch(() => undefined);

  return {
    campaignId: campaignPack.campaign.campaignId,
    campaignPack,
    editingLayersTask,
    requiresDeterministicEditing: deterministicEditingReadiness(input.template).status === "ready",
  };
}

const PRIMARY_CLONE_FORMAT = "4:5" as const;
const STORY_CLONE_FORMAT = "9:16" as const;
const STORY_RECOMPOSE_PROMPT =
  "Recompose this exact ad design as a 9:16 vertical story: same panel, colours, typography, photo, and copy; extend the background naturally to fill the taller frame; keep all essential content and text inside the central 80% width, with the top and bottom 250px free of text.";

type TemplateCloneRenderFormat = typeof PRIMARY_CLONE_FORMAT | typeof STORY_CLONE_FORMAT;

type GeneratedCloneRender = CloneGenerationResult & {
  attempt: number;
  qualityReview: AdStudioCloneQualityReview;
};

type PersistedCloneRender = GeneratedCloneRender & {
  image: string;
};

export async function startStoryAfterFeed<Feed, Story>(input: {
  generateFeed(): Promise<Feed>;
  generateStory(): Promise<Story>;
}): Promise<{ feed: Feed; storyTask: Promise<Story> }> {
  const feed = await input.generateFeed();
  const storyTask = input.generateStory();
  // The caller can still fail while persisting Feed. Attach a handler now so
  // Story rejection is never unhandled, while preserving it for the later await.
  void storyTask.catch(() => undefined);
  return { feed, storyTask };
}

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
  review?: typeof reviewCloneCandidate;
};

/**
 * Generate, normalize, and independently review candidates before persistence.
 * The same clone request is rebuilt with the image-model correction when a
 * candidate misses the quality lock. Failed candidates are never released.
 */
export async function generateFinalCloneRender(input: {
  format: TemplateCloneRenderFormat;
  templateId: string;
  providers: ImageProviderAdapter[];
  request: ImageProviderRequest;
  referenceImage: string;
  expectedCopy: Record<string, string>;
  expectedAssetKeys: string[];
  buildCorrectedRequest(correction: string): ImageProviderRequest;
  workspaceId: string;
  userId: string;
  correlationId: string;
  modelProfile?: "image_draft" | "image_final";
}, dependencies: CloneRenderDependencies = {}): Promise<GeneratedCloneRender> {
  const generate = dependencies.generate ?? generateCloneWithCascade;
  const normalize = dependencies.normalize ?? normalizeCloneRenderAspect;
  const review = dependencies.review ?? reviewCloneCandidate;
  let request = input.request;
  let lastReview: AdStudioCloneQualityReview | undefined;

  for (let attempt = 1; attempt <= MAX_RUNTIME_CLONE_CANDIDATES; attempt += 1) {
    const candidateRequest = { ...request, seed: (request.seed ?? 0) + attempt };
    const generated = await generate({
      providers: input.providers,
      request: candidateRequest,
      workspaceId: input.workspaceId,
      userId: input.userId,
      correlationId: input.correlationId,
      attempt,
      modelProfile: input.modelProfile,
    });
    const exactAssetUrl = await normalize(generated.assetUrl, input.format);
    lastReview = await review({
      templateId: input.templateId,
      format: input.format,
      attempt,
      referenceImage: input.referenceImage,
      candidateImage: exactAssetUrl,
      request: candidateRequest,
      expectedCopy: input.expectedCopy,
      expectedAssetKeys: input.expectedAssetKeys,
      workspaceId: input.workspaceId,
      userId: input.userId,
      correlationId: input.correlationId,
    });
    if (cloneQualityPassed({ review: lastReview, expectedCopy: input.expectedCopy, expectedAssetKeys: input.expectedAssetKeys })) {
      return { ...generated, assetUrl: exactAssetUrl, attempt, qualityReview: lastReview };
    }
    const correction = lastReview.suggestedCorrection.trim();
    if (!correction || attempt === MAX_RUNTIME_CLONE_CANDIDATES) break;
    request = input.buildCorrectedRequest(correction);
  }
  throw new TemplateCampaignQaError(
    `The ad did not reach ${input.format} likeness quality after ${MAX_RUNTIME_CLONE_CANDIDATES} candidates.`,
    lastReview,
  );
}

export type CloneEditingLayersInput = {
  supabase: SupabaseGenerationClient;
  workspaceId: string;
  userId: string;
  correlationId: string;
  template: AdStudioTemplate;
  renders: Array<{
    format: TemplateCloneRenderFormat;
    creativeId: string;
    imageRef: string;
    imageUrl?: string;
  }>;
};

/**
 * Build text-free plates with no vision or region discovery. Partial
 * templates keep this advisory and may fall back to a targeted model edit;
 * explicitly ready templates wait for it before generation is released.
 */
export async function prepareCloneCreativeTextLayers(
  input: CloneEditingLayersInput,
): Promise<void> {
  const supabase = input.supabase as SupabaseServerClient;

  await Promise.all(input.renders.map(async (render) => {
    try {
      const { data: row, error } = await supabase
        .from("adstudio_creatives")
        .select("id, canvas_json, active_revision_id")
        .eq("workspace_id", input.workspaceId)
        .eq("id", render.creativeId)
        .maybeSingle();
      if (error || !row) return;
      const canvas = (row.canvas_json ?? {}) as AdStudioCreative["canvas"];
      if (!canvas.cloneQa?.regions.length) return;
      await deriveAndPersistTemplateTextLayers({
        supabase,
        workspaceId: input.workspaceId,
        userId: input.userId,
        correlationId: input.correlationId,
        creativeId: render.creativeId,
        activeRevisionId: row.active_revision_id,
        format: render.format,
        canvas,
        currentImageRef: render.imageRef,
        currentImageUrl: render.imageUrl,
        template: input.template,
      });
    } catch {
      // Advisory only — the targeted image-model edit remains available.
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
  const correlationId = input.correlationId ?? randomUUID();

  // The route persists this deterministic ID before any provider call. If
  // Vercel dies after the transactional Feed save, the VPS resumes the saved
  // campaign and its editor preparation instead of buying the same image again.
  if (input.expectedCampaignId) {
    const resumed = await resumePersistedTemplateCampaign({
      supabase: input.supabase,
      workspaceId: input.workspaceId,
      userId: input.userId,
      correlationId,
      expectedCampaignId: input.expectedCampaignId,
      template,
    });
    if (resumed) return resumed;
  }

  const brandKitResult = await resolveAdStudioGenerationBrandKit({
    supabase,
    workspaceId: input.workspaceId,
    workspaceName: input.workspaceName,
    region: input.region,
    userId: input.userId,
  });
  if (!brandKitResult.ok) {
    throw new Error(brandKitResult.error);
  }
  const brandKit = brandKitResult.brandKit;

  // Resolve each supplied customer image (keyed by slot role or object id, the
  // same contract as customer generation) to a model-consumable reference.
  // Slots are independent — resolve them in parallel.
  const suppliedImages = firstAd.imageDataUrls ?? {};
  const resolvedImages: Record<string, string> = {};
  await Promise.all(template.inputs.images.map(async (slot) => {
    const brandLogo = /logo/i.test(slot.key)
      ? brandKit.logos.primaryLogoUrl ?? brandKit.logos.darkLogoUrl ?? brandKit.logos.lightLogoUrl ?? brandKit.logos.faviconUrl
      : undefined;
    const ref = suppliedImages[slot.key] ?? brandLogo;
    if (!ref?.trim()) return;
    const resolved = await resolveAdStudioImageForModel(supabase, input.workspaceId, ref.trim());
    if (!resolved) {
      throw new Error(`Image for "${slot.label}" could not be read.`);
    }
    resolvedImages[slot.key] = resolved;
  }));

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

  const sourceImageUrl = primarySlot ? resolvedImages[primarySlot.key] : Object.values(resolvedImages)[0];

  // Customer-typed on-image values (price, address, phone…) override the
  // model's suggestions VERBATIM — the copy model must never invent facts the
  // customer supplies. These exact strings become the editor's copyValues.
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

  // The raster reference and provider cascade don't depend on the copy
  // result — start them NOW so they overlap the 25-47s copy call instead of
  // following it. Gallery samples are SVGs, which no image provider accepts;
  // rasterize to a PNG data URL before the clone requests are built.
  const generationQuality = firstAd.generationQuality ?? "fast";
  const rasterPromise = ensureRasterReferenceImage(
    new URL(template.sample.imageSrc, input.origin).toString(),
  );
  const providersPromise = resolveCloneProviders(generationQuality);

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

  // The image lane prioritises the customer-visible feed, then starts the
  // recomposed 9:16 story after Feed clears blocking visual QA, while Feed
  // persistence continues. The matching-format
  // editor map was measured offline.
  const [referenceImage, providers] = await Promise.all([rasterPromise, providersPromise]);
  const expectedCopy = resolveCloneCopy(template, onImageCopy);
  const cloneInputs: CloneInputs = {
    referenceImage,
    images: resolvedImages,
    copy: onImageCopy,
    colourSource: firstAd.colourSource ?? "template",
    brandColours: ([
      ["primary", brandKit.colours.primary],
      ["secondary", brandKit.colours.secondary],
      ["accent", brandKit.colours.accent],
      ["background", brandKit.colours.background],
      ["text", brandKit.colours.text],
    ] as const)
      .filter(([, value]) => value.trim())
      .map(([label, value]) => `${label} ${value.trim()}`),
  };
  const cloneRequestsByFormat = buildTemplateCloneRequestsByFormat(template, cloneInputs);
  const feedCloneQa = buildPrebuiltTemplateCloneQa(template, expectedCopy, PRIMARY_CLONE_FORMAT);
  const modelProfile = cloneModelProfileForQuality(generationQuality);
  // Review every customer/brand asset actually supplied, not just required
  // fields. An optional logo or secondary photo must never be allowed to leak,
  // disappear, or warp simply because its input contract is optional.
  const expectedAssetKeys = template.inputs.images
    .filter((slot) => Boolean(resolvedImages[slot.key]))
    .map((slot) => slot.key);
  // --- Feed-first critical path: give Gemini the Feed request exclusively so
  // it does not compete with Story for provider quota or bandwidth. Once the
  // Feed is accepted, Story starts and overlaps upload/DB work.
  // This improves time-to-first-ad while still reducing two-format wall time. ---
  const { feed: feedRender, storyTask: storyGenPromise } = await startStoryAfterFeed({
    generateFeed: () => generateFinalCloneRender({
      format: PRIMARY_CLONE_FORMAT,
      templateId: template.id,
      providers,
      request: cloneRequestsByFormat[PRIMARY_CLONE_FORMAT],
      referenceImage,
      expectedCopy,
      expectedAssetKeys,
      buildCorrectedRequest: (correction) => buildTemplateCloneRequestsByFormat(template, {
        ...cloneInputs,
        reviewCorrection: correction,
      })[PRIMARY_CLONE_FORMAT],
      workspaceId: input.workspaceId,
      userId: input.userId,
      correlationId,
      modelProfile,
    }),
    generateStory: () => generateFinalCloneRender({
      format: STORY_CLONE_FORMAT,
      templateId: template.id,
      providers,
      request: cloneRequestsByFormat[STORY_CLONE_FORMAT],
      referenceImage,
      expectedCopy,
      expectedAssetKeys,
      buildCorrectedRequest: (correction) => buildTemplateCloneRequestsByFormat(template, {
        ...cloneInputs,
        reviewCorrection: correction,
      })[STORY_CLONE_FORMAT],
      workspaceId: input.workspaceId,
      userId: input.userId,
      correlationId,
      modelProfile,
    }),
  });

  // Story is now rendering while the feed uploads.
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
        templateCloneQaByFormat: feedCloneQa
          ? { [PRIMARY_CLONE_FORMAT]: feedCloneQa }
          : undefined,
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

  if (input.creditReservation) {
    await settleWorkspaceCreditReservation({
      reservation: input.creditReservation,
      credits: 1,
      mutationKey: `${input.creditReservation.mutationKey}:settle:4x5`,
      metadata: { format: PRIMARY_CLONE_FORMAT, campaignId: feedPack.campaign.campaignId },
    });
  }
  try {
    await recordCustomerActivationMilestone({
      workspaceId: input.workspaceId,
      milestone: "first_ad_pack_generated",
      occurredAt: new Date().toISOString(),
    });
  } catch (error) {
    // Campaign rows remain authoritative; the activation resolver repairs this
    // monotonic milestone on the next read.
    console.error("adstudio: activation milestone repair deferred", error);
  }

  // Regions are already in the persisted creative. The caller decides whether
  // this plate remains advisory (partial template) or gates release (ready
  // template).
  const feedCreative = feedPack.creatives.find((c) => c.format === PRIMARY_CLONE_FORMAT);
  const editingLayersTask = feedCreative
    ? prepareCloneCreativeTextLayers({
          supabase: input.supabase,
          workspaceId: input.workspaceId,
          userId: input.userId,
          correlationId,
          template,
          renders: [{
            format: PRIMARY_CLONE_FORMAT,
            creativeId: feedCreative.creativeId,
            imageRef: feedPersisted.image,
            imageUrl: feedRender.assetUrl,
          }],
        })
    : Promise.resolve();
  void editingLayersTask.catch(() => undefined);

  // Story background task: the story promise is already in flight. When it
  // lands, persist it, patch the campaign, and
  // attach its native-format prebuilt regions. Never throws outward.
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
    creditReservation: input.creditReservation,
  });

  return {
    campaignId: feedPack.campaign.campaignId,
    campaignPack: feedPack,
    editingLayersTask,
    requiresDeterministicEditing: deterministicEditingReadiness(template).status === "ready",
    storyTask,
  };
}

/**
 * Awaits the in-flight story (9:16) render, persists it, patches the
 * already-created campaign row (adds the format + creative), and prepares
 * optional text layers. All errors are contained — the feed ad stands alone.
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
  creditReservation?: WorkspaceCreditReservation;
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
      cloneQa: buildPrebuiltTemplateCloneQa(
        input.template,
        input.expectedCopy,
        STORY_CLONE_FORMAT,
      ),
    });

    // Patch the campaign: add the story format to the declared formats.
    const { data: campaignRow } = await input.supabase
      .from("adstudio_campaigns")
      .select("creative_formats_json")
      .eq("id", input.campaignId)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle();
    const currentFormats = (campaignRow?.creative_formats_json as string[] | null) ?? [];
    const campaignUpdate = await input.supabase
      .from("adstudio_campaigns")
      .update({
        creative_formats_json: [...new Set([...currentFormats, STORY_CLONE_FORMAT])],
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.campaignId)
      .eq("workspace_id", input.workspaceId);
    if (campaignUpdate.error) throw new Error(campaignUpdate.error.message);

    // Insert the story creative row.
    const creativeInsert = await input.supabase.from("adstudio_creatives").insert({
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
    if (creativeInsert.error) throw new Error(creativeInsert.error.message);

    if (input.creditReservation) {
      await settleWorkspaceCreditReservation({
        reservation: input.creditReservation,
        credits: 1,
        mutationKey: `${input.creditReservation.mutationKey}:settle:9x16`,
        metadata: { format: STORY_CLONE_FORMAT, campaignId: input.campaignId },
      });
    }

    await prepareCloneCreativeTextLayers({
      supabase: input.supabase,
      workspaceId: input.workspaceId,
      userId: input.userId,
      correlationId: input.correlationId,
      template: input.template,
      renders: [{
        format: STORY_CLONE_FORMAT,
        creativeId: storyCreative.creativeId,
        imageRef: storyImage,
        imageUrl: storyRender.assetUrl,
      }],
    });
  } catch (error) {
    if (input.creditReservation?.creditsOutstanding) {
      try {
        await refundWorkspaceCreditReservation({
          reservation: input.creditReservation,
          credits: 1,
          mutationKey: `${input.creditReservation.mutationKey}:refund:9x16`,
          reason: "story_render_failed",
          metadata: { format: STORY_CLONE_FORMAT, campaignId: input.campaignId },
        });
      } catch (refundError) {
        console.error("adstudio: story credit refund failed", refundError);
      }
    }
    // Story failure must NEVER fail the feed. Log and contain.
    console.error("adstudio: story (9:16) background persist failed", error);
  }
}
