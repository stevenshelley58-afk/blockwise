// The complete server-side template-campaign generation pipeline, callable from
// the campaigns POST route (synchronous fallback) or the trigger.dev task
// "adstudio.generate.template" (the normal async path; no 120s route ceiling).
//
// Order matters and is the product: brand kit -> slot images -> brief-grounded
// copy (on-image fields + feed copy in one pass) -> reference clone renders
// (feed + story) -> QA annotation for edit regions and warnings -> deterministic
// pack build -> provided-copy application -> one transactional persist. QA is
// advisory: the user always gets the generated ad and can edit it in place.
import { randomUUID } from "node:crypto";

import { applyProvidedCopyToCampaignPack } from "./campaign-copy-enrichment.ts";
import {
  generateCloneWithCascade,
  persistCloneRender,
  resolveCloneProviders,
  type CloneGenerationResult,
} from "./clone-generation.ts";
import { runCloneQa } from "./clone-qa.ts";
import { generateAdStudioTemplateCopy } from "./copy-generation.ts";
import { generateAdStudioCampaignPack } from "./generator.ts";
import { persistAdStudioCampaignPack } from "./persistence.ts";
import { ensureRasterReferenceImage } from "./rasterize-reference.ts";
import {
  buildCloneImageRequest,
  resolveCloneCopy,
  type CloneInputs,
  type TemplateCloneBrief,
} from "./reference-clone.ts";
import { resolveAdStudioImageForModel } from "./resolve-image-for-model.ts";
import { getTemplateBrief } from "./template-brief.ts";
import { resolveApprovedAdStudioTemplate, templatePromptHint } from "./template-resolver.ts";
import { resolveAdStudioGenerationBrandKit } from "./trial-brand-kit.ts";
import type {
  AdStudioBrandKit,
  AdStudioCampaignPack,
  AdStudioCloneQa,
  AdStudioFormat,
  AdStudioGoal,
  AdStudioPlatform,
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
  goal?: AdStudioGoal;
  suburb?: string;
  city?: string;
  state?: string;
  offerId?: string;
  platforms?: AdStudioPlatform[];
  creativeFormats?: AdStudioFormat[];
  variantCount?: number;
  firstAd?: FirstAdInput;
  sourceImageDataUrl?: string;
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
  /**
   * Image tier. The async job runs "final" (quality); the synchronous
   * degraded-mode fallback runs "preview" (fast) so the whole pipeline fits
   * inside a Vercel request window.
   */
  tier?: "preview" | "final";
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
  "Recompose this exact ad design as a 9:16 vertical story: same panel, colours, typography, photo, and copy; extend the background naturally to fill the taller frame; keep all text inside the central safe area (top and bottom 250px free of text).";

type TemplateCloneRenderFormat = typeof PRIMARY_CLONE_FORMAT | typeof STORY_CLONE_FORMAT;

type GeneratedCloneRender = CloneGenerationResult & {
  attempt: number;
};

type PersistedCloneRender = GeneratedCloneRender & {
  image: string;
  qa: AdStudioCloneQa | null;
};

export function buildTemplateCloneRequestsByFormat(
  brief: TemplateCloneBrief,
  inputs: CloneInputs,
): Record<TemplateCloneRenderFormat, ImageProviderRequest> {
  const primary = buildCloneImageRequest(brief, inputs);
  const storyBase = buildCloneImageRequest(brief, {
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

async function generateCloneWithProviderRetries(input: {
  providers: ImageProviderAdapter[];
  request: ImageProviderRequest;
  workspaceId: string;
  userId: string;
  correlationId: string;
  tier: "preview" | "final";
  maxAttempts: number;
  deadline: number;
}): Promise<GeneratedCloneRender> {
  let lastError: unknown = null;
  const maxAttempts = Math.max(1, input.maxAttempts);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1 && Date.now() >= input.deadline) break;
    try {
      const generated = await generateCloneWithCascade({
        providers: input.providers,
        request: {
          ...input.request,
          seed: (input.request.seed ?? 0) + attempt,
        },
        workspaceId: input.workspaceId,
        userId: input.userId,
        correlationId: input.correlationId,
        tier: input.tier,
        attempt,
      });
      return { ...generated, attempt };
    } catch (error) {
      lastError = error;
      if (Date.now() >= input.deadline) break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Clone generation failed. Try again.");
}

async function annotateCloneQa(input: {
  workspaceId: string;
  userId: string;
  correlationId: string;
  imageUrl: string;
  expectedCopy: Record<string, string>;
  attempt: number;
}): Promise<AdStudioCloneQa | null> {
  try {
    return await runCloneQa(input);
  } catch (error) {
    console.error("adstudio.clone_qa failed; shipping clone without QA annotation", error);
    return null;
  }
}

export async function runTemplateCampaignGeneration(
  input: RunTemplateCampaignGenerationInput,
): Promise<RunTemplateCampaignGenerationResult> {
  const supabase = input.supabase as SupabaseServerClient;
  const deadline = Date.now() + input.deadlineMs;
  const { body } = input;
  const firstAd = body.firstAd;

  if (!firstAd || firstAd.mode !== "template") {
    throw new Error("Template campaign generation requires a template first ad.");
  }
  if (!firstAd.description?.trim()) {
    throw new Error("Add a short description so Blockwise knows what to write.");
  }

  const template = await resolveApprovedAdStudioTemplate({
    templateKey: firstAd.templateKey,
    templateId: firstAd.templateId,
  });
  const brief = getTemplateBrief(template.id);
  if (!brief) {
    throw new Error(`Selected template "${template.id}" has no clone brief.`);
  }

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
  // same contract as the generate-clone route) to a model-consumable reference.
  const suppliedImages = firstAd.imageDataUrls ?? {};
  const resolvedImages: Record<string, string> = {};
  for (const slot of brief.imageSlots) {
    const ref = suppliedImages[slot.role] ?? (slot.objectId ? suppliedImages[slot.objectId] : undefined);
    if (!ref?.trim()) continue;
    const resolved = await resolveAdStudioImageForModel(supabase, input.workspaceId, ref.trim());
    if (!resolved) {
      throw new Error(`Image for "${slot.role}" could not be read.`);
    }
    resolvedImages[slot.role] = resolved;
  }

  // Single-image submissions may arrive only as firstAd.imageDataUrl.
  const primarySlot = brief.imageSlots.find((slot) => slot.required) ?? brief.imageSlots[0];
  if (primarySlot && !resolvedImages[primarySlot.role] && firstAd.imageDataUrl?.trim()) {
    const resolved = await resolveAdStudioImageForModel(supabase, input.workspaceId, firstAd.imageDataUrl.trim());
    if (resolved) resolvedImages[primarySlot.role] = resolved;
  }

  const missingSlot = brief.imageSlots.find((slot) => slot.required && !resolvedImages[slot.role]);
  if (missingSlot) {
    throw new Error(`Missing required image: ${missingSlot.role}`);
  }

  const correlationId = randomUUID();
  const sourceImageUrl = primarySlot ? resolvedImages[primarySlot.role] : Object.values(resolvedImages)[0];

  // One structured copy pass writes the on-image field values AND the Meta feed
  // copy from the user's brief, so the baked-in text and the feed text tell one
  // story (the template's sample copy is tone/shape reference only).
  const copyResult = await generateAdStudioTemplateCopy({
    workspaceId: input.workspaceId,
    userId: input.userId,
    correlationId,
    description: firstAd.description,
    fields: brief.copyFields.map((field) => ({
      key: field.key,
      label: field.label,
      maxLength: field.maxLength,
      sample: field.default,
    })),
    sourceImageUrl,
    context: {
      goal: template.goal,
      templateName: template.name,
      templateHint: templatePromptHint(template),
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
  for (const field of brief.copyFields) {
    const provided = firstAd.onImageCopy?.[field.key]?.trim();
    if (provided) customerOnImage[field.key] = provided;
  }
  const onImageCopy = { ...copyResult.onImage, ...customerOnImage };

  // Gallery samples are SVGs, which no image provider accepts; rasterize to
  // a PNG data URL before the clone requests are built. The image lane runs
  // one native feed render and one recomposed 9:16 story render in parallel;
  // QA annotates each result but never blocks shipping.
  const referenceImage = await ensureRasterReferenceImage(
    new URL(brief.referenceImage, input.origin).toString(),
  );
  const expectedCopy = resolveCloneCopy(brief, onImageCopy);
  const cloneRequestsByFormat = buildTemplateCloneRequestsByFormat(brief, {
    referenceImage,
    images: resolvedImages,
    copy: onImageCopy,
    brandHex: brandKit.colours.accent || brandKit.colours.primary,
  });
  const tier = input.tier ?? "final";
  const providers = await resolveCloneProviders(tier);
  const maxAttempts = Math.max(1, input.maxCloneAttempts);
  const cloneFormats = Object.keys(cloneRequestsByFormat) as TemplateCloneRenderFormat[];

  const generatedEntries = await Promise.all(
    cloneFormats.map(async (format) => {
      const generated = await generateCloneWithProviderRetries({
        providers,
        request: cloneRequestsByFormat[format],
        workspaceId: input.workspaceId,
        userId: input.userId,
        correlationId,
        tier,
        maxAttempts,
        deadline,
      });
      return [format, generated] as const;
    }),
  );
  const generatedByFormat = Object.fromEntries(generatedEntries) as Record<TemplateCloneRenderFormat, GeneratedCloneRender>;

  const qaEntries = await Promise.all(
    cloneFormats.map(async (format) => {
      const generated = generatedByFormat[format];
      const qa = await annotateCloneQa({
        workspaceId: input.workspaceId,
        userId: input.userId,
        correlationId,
        imageUrl: generated.assetUrl,
        expectedCopy,
        attempt: generated.attempt,
      });
      return [format, qa] as const;
    }),
  );
  const qaByFormat = Object.fromEntries(qaEntries) as Record<TemplateCloneRenderFormat, AdStudioCloneQa | null>;

  const persistedEntries = await Promise.all(
    cloneFormats.map(async (format) => {
      const generated = generatedByFormat[format];
      const image = await persistCloneRender({
        supabase,
        workspaceId: input.workspaceId,
        assetUrl: generated.assetUrl,
        fileNameSeed: `${correlationId}-clone-${format.replace(":", "x")}`,
      });
      return [format, { ...generated, image, qa: qaByFormat[format] }] as const;
    }),
  );
  const cloneRendersByFormat = Object.fromEntries(persistedEntries) as Record<TemplateCloneRenderFormat, PersistedCloneRender>;
  const primaryClone = cloneRendersByFormat[PRIMARY_CLONE_FORMAT];

  let pack = generateAdStudioCampaignPack({
    workspaceId: input.workspaceId,
    brandKit,
    goal: template.goal ?? body.goal ?? "seller_leads",
    suburb: body.suburb ?? "Scarborough",
    city: body.city ?? "Perth",
    state: body.state ?? "WA",
    offerId: template.offerId ?? body.offerId ?? "seller_prep_checklist",
    // Google Ads parked for Meta-only v1 (see src/lib/config/feature-flags.ts).
    platforms: body.platforms ?? ["meta"],
    creativeFormats: body.creativeFormats,
    variantCount: body.variantCount ?? 5,
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
    sourceImageDataUrl: body.sourceImageDataUrl,
    sourceImagesBySlot: firstAd.imageDataUrls,
  });

  // Replace the pack's offer-library defaults with the brief-grounded feed copy
  // (full AI enrichment on template ads was a past regression — it overwrote
  // curated copy with generic text and collapsed CTAs to "Learn more").
  pack = applyProvidedCopyToCampaignPack(pack, copyResult.copy);

  // The RPC is transactional; a failure means nothing was written, so surface
  // it as a hard error and let the caller refund/retry.
  const persisted = await persistAdStudioCampaignPack(supabase, pack, input.userId);
  if (persisted.error) {
    throw new Error(
      `Your ad was generated but could not be saved (${persisted.error.message}). Please try again.`,
    );
  }

  return { campaignId: pack.campaign.campaignId, campaignPack: pack, qa: primaryClone.qa };
}
