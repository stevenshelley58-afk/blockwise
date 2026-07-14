// The complete server-side template-campaign generation pipeline, callable from
// the campaigns POST route (synchronous fallback) or the trigger.dev task
// "adstudio.generate.template" (the normal async path; no 120s route ceiling).
//
// Order matters and is the product: brand kit -> slot images -> brief-grounded
// copy (on-image fields + feed copy in one pass) -> reference clone renders
// (feed + story) -> blocking QA with one guided correction -> deterministic
// pack build -> provided-copy application -> one transactional persist.
import { randomUUID } from "node:crypto";

import { applyProvidedCopyToCampaignPack } from "./campaign-copy-enrichment.ts";
import {
  CloneGenerationError,
  generateCloneWithCascade,
  normalizeCloneRenderAspect,
  persistCloneRender,
  resolveCloneProviders,
  type CloneGenerationResult,
} from "./clone-generation.ts";
import { cloneQaCorrectionPrompt, runCloneQa } from "./clone-qa.ts";
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
import { ProviderRunPersistenceError } from "../operator/prompts/redact-prompt-run.ts";
import type {
  AdStudioBrandKit,
  AdStudioCampaignPack,
  AdStudioCloneQa,
  AdStudioFormat,
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
  /** Hard time budget; provider-error retries stop once it is spent. */
  deadlineMs: number;
  maxCloneAttempts: number;
  workspaceName?: string;
  region?: string;
  /** From the route's credit reservation; drives the trial fallback brand kit. */
  isTrialWorkspace?: boolean;
};

export type RunTemplateCampaignGenerationResult = {
  campaignId: string;
  campaignPack: AdStudioCampaignPack;
  qa: AdStudioCloneQa | null;
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
  qa: AdStudioCloneQa;
};

export class TemplateCampaignQaError extends Error {
  readonly format: TemplateCloneRenderFormat;
  readonly qa: AdStudioCloneQa | null;

  constructor(format: TemplateCloneRenderFormat, qa: AdStudioCloneQa | null, cause?: unknown) {
    super(
      qa
        ? `${format} creative did not pass verification after bounded attempts.`
        : `${format} creative verification was unavailable. Nothing was saved.`,
    );
    this.name = "TemplateCampaignQaError";
    this.format = format;
    this.qa = qa;
    if (cause !== undefined) this.cause = cause;
  }
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

type CloneQualityGateDependencies = {
  generate?: typeof generateCloneWithCascade;
  review?: typeof runCloneQa;
  normalize?: typeof normalizeCloneRenderAspect;
};

export async function generateQaAcceptedClone(input: {
  format: TemplateCloneRenderFormat;
  providers: ImageProviderAdapter[];
  request: ImageProviderRequest;
  expectedCopy: Record<string, string>;
  workspaceId: string;
  userId: string;
  correlationId: string;
  maxAttempts: number;
  deadline: number;
}, dependencies: CloneQualityGateDependencies = {}): Promise<GeneratedCloneRender & { qa: AdStudioCloneQa }> {
  let lastError: unknown = null;
  let lastQa: AdStudioCloneQa | null = null;
  let correctionPrompt = "";
  let qualityAttempt = 0;
  let providerCallCount = 0;
  let generationAttempt = 0;
  // Sync generation gets one QA-reviewed candidate so it cannot start a
  // second premium render that will outlive Vercel's request ceiling. The
  // background task may request the bounded correction pass.
  const maxQualityAttempts = Math.max(1, Math.min(input.maxAttempts, 2));
  const maxProviderCalls = maxQualityAttempts * 2;
  const generate = dependencies.generate ?? generateCloneWithCascade;
  const review = dependencies.review ?? runCloneQa;
  const normalize = dependencies.normalize ?? normalizeCloneRenderAspect;

  while (providerCallCount < maxProviderCalls && qualityAttempt < maxQualityAttempts) {
    if (generationAttempt > 0 && Date.now() >= input.deadline) break;
    generationAttempt += 1;
    const remainingProviderCalls = maxProviderCalls - providerCallCount;
    try {
      const generated = await generate({
        providers: input.providers.slice(0, remainingProviderCalls),
        request: {
          ...input.request,
          prompt: correctionPrompt
            ? `${input.request.prompt}\n\n${correctionPrompt}`
            : input.request.prompt,
          seed: (input.request.seed ?? 0) + generationAttempt,
        },
        workspaceId: input.workspaceId,
        userId: input.userId,
        correlationId: input.correlationId,
        attempt: generationAttempt,
      });

      let exactAssetUrl: string;
      try {
        exactAssetUrl = await normalize(generated.assetUrl, input.format);
      } catch (error) {
        throw new TemplateCampaignQaError(input.format, null, error);
      }

      providerCallCount += generated.providerAttemptCount;
      qualityAttempt += 1;
      let qa: AdStudioCloneQa;
      try {
        qa = await review({
          workspaceId: input.workspaceId,
          userId: input.userId,
          correlationId: input.correlationId,
          imageUrl: exactAssetUrl,
          expectedCopy: input.expectedCopy,
          format: input.format,
          attempt: qualityAttempt,
        });
      } catch (error) {
        if (error instanceof ProviderRunPersistenceError) throw error;
        throw new TemplateCampaignQaError(input.format, null, error);
      }

      if (qa.passed) return { ...generated, assetUrl: exactAssetUrl, attempt: qualityAttempt, qa };
      lastQa = qa;
      correctionPrompt = cloneQaCorrectionPrompt(qa);
    } catch (error) {
      if (error instanceof ProviderRunPersistenceError || error instanceof TemplateCampaignQaError) throw error;
      if (error instanceof CloneGenerationError) {
        providerCallCount += error.providerAttemptCount;
        if (error.providerAttemptCount === 0) break;
      }
      lastError = error;
      if (Date.now() >= input.deadline) break;
    }
  }

  if (lastQa) throw new TemplateCampaignQaError(input.format, lastQa);
  throw lastError instanceof Error ? lastError : new Error("Clone generation failed. Try again.");
}

export async function runVerifiedClonePersistencePipeline<
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
  const deadline = Date.now() + input.deadlineMs;
  const { body } = input;
  const firstAd = body.firstAd;

  if (!firstAd) throw new Error("Ad generation requires a selected sample and customer assets.");
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
  // one native feed render and one recomposed 9:16 story render in parallel.
  // Every format must pass blocking QA before any render or campaign is saved.
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
  const providers = await resolveCloneProviders();
  const maxAttempts = Math.max(1, input.maxCloneAttempts);
  const cloneFormats = Object.keys(cloneRequestsByFormat) as TemplateCloneRenderFormat[];

  const { persistedByFormat: cloneRendersByFormat, campaign: pack } =
    await runVerifiedClonePersistencePipeline({
      formats: cloneFormats,
      generateAccepted: (format) => generateQaAcceptedClone({
        format,
        providers,
        request: cloneRequestsByFormat[format],
        expectedCopy,
        workspaceId: input.workspaceId,
        userId: input.userId,
        correlationId,
        maxAttempts,
        deadline,
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
      templateCloneQa: primaryClone.qa ?? undefined,
      templateCloneQaByFormat: {
        ...(cloneRendersByFormat[PRIMARY_CLONE_FORMAT].qa
          ? { [PRIMARY_CLONE_FORMAT]: cloneRendersByFormat[PRIMARY_CLONE_FORMAT].qa }
          : {}),
        ...(cloneRendersByFormat[STORY_CLONE_FORMAT].qa
          ? { [STORY_CLONE_FORMAT]: cloneRendersByFormat[STORY_CLONE_FORMAT].qa }
          : {}),
      },
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

  const primaryClone = cloneRendersByFormat[PRIMARY_CLONE_FORMAT];
  return { campaignId: pack.campaign.campaignId, campaignPack: pack, qa: primaryClone.qa };
}
