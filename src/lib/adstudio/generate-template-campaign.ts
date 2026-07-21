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
import { cleanPlateFileNameSeed, generateCleanPlate } from "./clean-plate.ts";
import {
  cloneModelProfileForQuality,
  generateCloneWithCascade,
  normalizeCloneRenderAspect,
  persistCloneRender,
  resolveCloneProviders,
  type AdGenerationQuality,
  type CloneGenerationResult,
} from "./clone-generation.ts";
import { runCloneQa } from "./clone-qa.ts";
import { generateAdStudioTemplateCopy } from "./copy-generation.ts";
import { buildCloneCampaignPack } from "./clone-campaign.ts";
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
  AdStudioCloneQa,
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
   * Runs the advisory vision pass (editor regions + copy warnings) and writes
   * it onto the persisted creatives. Call AFTER the customer has the ad: the
   * trigger task awaits it post-"done", the sync route defers it with after().
   * Never throws; returns the primary-format verdict when available.
   */
  enrichQa: () => Promise<AdStudioCloneQa | null>;
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
 * sees this render as soon as it persists, and the advisory QA pass that
 * powers the editor runs afterwards via enrichCloneCreativesWithQa.
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

export type CloneQaEnrichmentInput = {
  supabase: SupabaseGenerationClient;
  workspaceId: string;
  userId: string;
  correlationId: string;
  expectedCopy: Record<string, string>;
  /** Primary format first; its verdict becomes the return value. */
  renders: Array<{ format: TemplateCloneRenderFormat; creativeId: string; imageUrl: string }>;
  quality?: AdGenerationQuality;
  review?: typeof runCloneQa;
  producePlate?: typeof generateCleanPlate;
};

/**
 * Post-persist advisory pass: one vision call per format produces the editor
 * regions and copy warnings, written onto the already-persisted creatives.
 * Failures are contained per format — the customer keeps the ad either way,
 * and a creative that already has a verdict (a fast in-place edit) is never
 * overwritten with a stale one.
 *
 * The same pass produces each format's clean plate (the text-free background
 * the embedded design editor draws real text layers over). Plate production is
 * best-effort: a missing plate only means that creative keeps the in-place
 * editor until the lazy prepare-editor backfill supplies one.
 */
export async function enrichCloneCreativesWithQa(
  input: CloneQaEnrichmentInput,
): Promise<AdStudioCloneQa | null> {
  const review = input.review ?? runCloneQa;
  const producePlate = input.producePlate ?? generateCleanPlate;
  const supabase = input.supabase as SupabaseServerClient;

  const verdicts = await Promise.all(input.renders.map(async (render) => {
    try {
      const qa = await review({
        workspaceId: input.workspaceId,
        userId: input.userId,
        correlationId: input.correlationId,
        imageUrl: render.imageUrl,
        expectedCopy: input.expectedCopy,
        format: render.format,
        attempt: 1,
      });

      const cleanPlate = await producePlate({
        supabase,
        workspaceId: input.workspaceId,
        userId: input.userId,
        correlationId: input.correlationId,
        format: render.format,
        renderImage: render.imageUrl,
        regions: qa.regions,
        quality: input.quality ?? "fast",
        fileNameSeed: cleanPlateFileNameSeed(input.correlationId, render.format),
      });

      const { data: row, error } = await supabase
        .from("adstudio_creatives")
        .select("id, canvas_json")
        .eq("workspace_id", input.workspaceId)
        .eq("id", render.creativeId)
        .maybeSingle();
      if (error || !row) return qa;
      const canvas = (row.canvas_json ?? {}) as Record<string, unknown>;
      if (canvas.cloneQa) return qa;
      await supabase
        .from("adstudio_creatives")
        .update({
          canvas_json: {
            ...canvas,
            cloneQa: qa,
            ...(cleanPlate && !canvas.cloneEdit ? { cloneEdit: { version: 1, cleanPlate } } : {}),
          },
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", input.workspaceId)
        .eq("id", render.creativeId);
      return qa;
    } catch {
      return null;
    }
  }));

  return verdicts[0] ?? null;
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

  // One structured copy pass writes the on-image field values AND the Meta feed
  // copy from the user's brief, so the baked-in text and the feed text tell one
  // story (the template's sample copy is tone/shape reference only).
  const copyResult = await generateAdStudioTemplateCopy({
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

  // Customer-typed on-image values (price, address, phone…) override the
  // model's suggestions VERBATIM — the copy model must never invent facts the
  // customer supplies. QA then verifies these exact strings on the render.
  const customerOnImage: Record<string, string> = {};
  for (const field of template.inputs.text) {
    const provided = firstAd.onImageCopy?.[field.key]?.trim();
    if (provided) customerOnImage[field.key] = provided;
  }
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
  const cloneFormats = Object.keys(cloneRequestsByFormat) as TemplateCloneRenderFormat[];

  const { persistedByFormat: cloneRendersByFormat, campaign: pack } =
    await runClonePersistencePipeline({
      formats: cloneFormats,
      generateAccepted: (format) => generateFinalCloneRender({
        format,
        providers,
        request: cloneRequestsByFormat[format],
        workspaceId: input.workspaceId,
        userId: input.userId,
        correlationId,
        modelProfile,
      }),

      persistClone: async (format, generated): Promise<PersistedCloneRender> => ({
        ...generated,
        image: await persistCloneRender({
          supabase,
          workspaceId: input.workspaceId,
          assetUrl: generated.assetUrl,
          fileNameSeed: `${correlationId}-clone-${format.replace(":", "x")}`,
        }),
      }),

      buildCampaign: (cloneRendersByFormat) => {
        const primaryClone = cloneRendersByFormat[PRIMARY_CLONE_FORMAT];
        const generatedPack = buildCloneCampaignPack({
          workspaceId: input.workspaceId,
          brandKit,
          suburb: body.suburb ?? "Scarborough",
          city: body.city ?? "Perth",
          state: body.state ?? "WA",
          firstAd: {
      ...firstAd,
      imageDataUrl: primaryClone.image,
      templateCloneImage: primaryClone.image,
      templateCloneImagesByFormat: {
        [PRIMARY_CLONE_FORMAT]: cloneRendersByFormat[PRIMARY_CLONE_FORMAT].image,
        [STORY_CLONE_FORMAT]: cloneRendersByFormat[STORY_CLONE_FORMAT].image,
      },
      templateCloneProvider: primaryClone.provider,
      templateCloneModel: primaryClone.model,
      copy: copyResult.copy,
          },
        });
        return applyProvidedCopyToCampaignPack(generatedPack, copyResult.copy);
      },

  // Replace the pack's offer-library defaults with the brief-grounded feed copy
  // (full AI enrichment on template ads was a past regression — it overwrote
  // curated copy with generic text and collapsed CTAs to "Learn more").
      persistCampaign: async (campaign) => {
        const persisted = await persistAdStudioCampaignPack(supabase, campaign, input.userId);
        if (persisted.error) {
          throw new Error(
            `Your ad was generated but could not be saved (${persisted.error.message}). Please try again.`,
          );
        }
      },
    });

  // The advisory pass reuses the in-memory normalized data URLs, so it costs
  // no storage round-trip. Primary format first: its verdict is the headline
  // QA result recorded on the job row.
  const enrichQa = () => enrichCloneCreativesWithQa({
    supabase: input.supabase,
    workspaceId: input.workspaceId,
    userId: input.userId,
    correlationId,
    expectedCopy,
    quality: generationQuality,
    renders: [PRIMARY_CLONE_FORMAT, STORY_CLONE_FORMAT].flatMap((format) => {
      const creative = pack.creatives.find((candidate) => candidate.format === format);
      const render = cloneRendersByFormat[format];
      return creative && render ? [{ format, creativeId: creative.creativeId, imageUrl: render.assetUrl }] : [];
    }),
  });

  return { campaignId: pack.campaign.campaignId, campaignPack: pack, enrichQa };
}
