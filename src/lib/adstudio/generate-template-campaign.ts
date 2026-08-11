// The complete server-side template-campaign generation pipeline, callable from
// the Vercel campaigns route (customer fast path) or the VPS recovery worker.
//
// Order matters and is the product: brand kit -> slot images -> brief-grounded
// copy (on-image fields + feed copy in one pass) -> one reference clone render
// -> deterministic Feed/Story placement outputs -> pack build -> provided-copy application ->
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
  cloneCorrectionForNextCandidate,
  cloneQualityPassed,
  cloneQualityWarrantsSameTierRetry,
  isAbortError,
  reviewCloneCandidate,
} from "./clone-quality-gate.ts";
import { buildPrebuiltTemplateCloneQa } from "./clone-regions.ts";
import { dataUrlToUploadBytes } from "./generated-media.ts";
import { deriveAndPersistTemplateTextLayers } from "./layer-derivation.ts";
import { generateAdStudioTemplateCopy, type AdStudioCopyFields } from "./copy-generation.ts";
import {
  buildCloneCampaignPack,
  generationRequestFingerprint,
  resolveCloneCampaignId,
} from "./clone-campaign.ts";
import {
  recordCloneCandidateAudit,
  type CloneCandidateAuditClient,
} from "./clone-candidate-audit.ts";
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
import type { ProviderEnvironment } from "./ai-providers.ts";
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
  /** Server-owned reservation for the one paid full-ad generation. */
  creditReservation?: WorkspaceCreditReservation;
  /** Stable run identifier persisted before provider work starts. */
  correlationId?: string;
  /** Deterministic campaign checkpoint used to resume after a function crash. */
  expectedCampaignId?: string;
  /** Explicit service-runtime credentials; Vercel requests use process.env. */
  providerEnv?: ProviderEnvironment;
  /** Worker lease/timeout cancellation propagated to every paid provider. */
  signal?: AbortSignal;
};

export type RunTemplateCampaignGenerationResult = {
  campaignId: string;
  campaignPack: AdStudioCampaignPack;
  /** Background construction of the optional instant text-editing plate. */
  editingLayersTask: Promise<void>;
  /** Ready templates are not released to the customer until that task settles. */
  requiresDeterministicEditing: boolean;
};

/** Validate the queue checkpoint before provider credentials or paid work are touched. */
export async function validateTemplateCampaignIdentity(input: {
  workspaceId: string;
  body: CreateCampaignBody;
  expectedCampaignId?: string;
}): Promise<string> {
  const template = await resolveApprovedAdStudioTemplate({ templateId: input.body.firstAd?.templateId });
  const expected = resolveCloneCampaignId({
    workspaceId: input.workspaceId,
    templateId: template.id,
    requestFingerprint: `${input.workspaceId}:${generationRequestFingerprint(input.body)}`,
  });
  if (!input.expectedCampaignId || input.expectedCampaignId !== expected) {
    throw new Error("Generation job campaign identity does not match its request and released template.");
  }
  return expected;
}

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
  providerEnv?: ProviderEnvironment;
}): Promise<RunTemplateCampaignGenerationResult | null> {
  const campaignPack = await loadAdStudioCampaignPack(
    input.supabase as SupabaseServerClient,
    input.workspaceId,
    input.expectedCampaignId,
  );
  if (!campaignPack) return null;

  const renders = resolvePersistedClonePlacementRenders(campaignPack, input.template.format);

  const editingLayersTask = prepareCloneCreativeTextLayers({
    supabase: input.supabase,
    workspaceId: input.workspaceId,
    userId: input.userId,
    correlationId: input.correlationId,
    template: input.template,
    providerEnv: input.providerEnv,
    renders,
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

type TemplateCloneRenderFormat = typeof PRIMARY_CLONE_FORMAT | typeof STORY_CLONE_FORMAT;

export function resolvePersistedClonePlacementRenders(
  campaignPack: AdStudioCampaignPack,
  nativeFormat: TemplateCloneRenderFormat,
): CloneEditingLayersInput["renders"] {
  const derivedFormat = nativeFormat === PRIMARY_CLONE_FORMAT
    ? STORY_CLONE_FORMAT
    : PRIMARY_CLONE_FORMAT;
  return [nativeFormat, derivedFormat].map((format) => {
    const creative = campaignPack.creatives.find((candidate) => candidate.format === format);
    const image = creative?.canvas.objects.find((object) => object.role === "primary_image");
    const imageRef = image?.content ?? image?.assetId;
    if (!creative || !imageRef) {
      throw new Error(`The persisted generation checkpoint has no finished ${format} creative.`);
    }
    return { format, creativeId: creative.creativeId, imageRef };
  });
}

type GeneratedCloneRender = CloneGenerationResult & {
  attempt: number;
  qualityReview: AdStudioCloneQualityReview;
};

type PersistedCloneRender = GeneratedCloneRender & {
  image: string;
};

export function buildTemplateCloneRequest(
  template: AdStudioTemplate,
  inputs: CloneInputs,
): ImageProviderRequest {
  return buildCloneImageRequest(template, { ...inputs, aspectRatio: template.format });
}

/**
 * Build the non-native placement from the one finished ad. The complete native
 * image stays visible and proportionally centred; only the unused canvas is
 * filled from a softened copy of the same pixels. This keeps the QA region
 * affine exact and never asks a provider to redraw or extend the ad.
 */
export async function derivePlacementCloneFromFinishedNative(
  finishedNative: string,
  sourceFormat: TemplateCloneRenderFormat,
  targetFormat: TemplateCloneRenderFormat,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  let nativeBytes: Uint8Array;
  if (finishedNative.startsWith("data:image/")) {
    nativeBytes = dataUrlToUploadBytes(finishedNative).bytes;
  } else {
    const response = await fetchImpl(finishedNative);
    if (!response.ok) throw new Error(`Finished native ad could not be prepared (${response.status}).`);
    nativeBytes = new Uint8Array(await response.arrayBuffer());
  }
  const { default: sharp } = await import("sharp");
  const sizes = {
    [PRIMARY_CLONE_FORMAT]: { width: 1024, height: 1280 },
    [STORY_CLONE_FORMAT]: { width: 864, height: 1536 },
  } as const;
  const source = sizes[sourceFormat];
  const target = sizes[targetFormat];
  const metadata = await sharp(nativeBytes).metadata();
  if (
    !metadata.width
    || !metadata.height
    || metadata.width * source.height !== metadata.height * source.width
  ) {
    throw new Error(`Finished native ad must be a ${sourceFormat} image before deriving ${targetFormat}.`);
  }
  const scale = Math.min(target.width / metadata.width, target.height / metadata.height);
  const foregroundWidth = Math.round(metadata.width * scale);
  const foregroundHeight = Math.round(metadata.height * scale);
  const foregroundLeft = Math.floor((target.width - foregroundWidth) / 2);
  const foregroundTop = Math.floor((target.height - foregroundHeight) / 2);
  const [background, foreground] = await Promise.all([
    sharp(nativeBytes)
      .resize(target.width, target.height, { fit: "cover", position: "centre" })
      .blur(24)
      .modulate({ brightness: 0.55, saturation: 0.75 })
      .png({ compressionLevel: 1 })
      .toBuffer(),
    sharp(nativeBytes)
      .resize(foregroundWidth, foregroundHeight, { fit: "fill" })
      .png({ compressionLevel: 1 })
      .toBuffer(),
  ]);
  const output = await sharp(background)
    .composite([{ input: foreground, left: foregroundLeft, top: foregroundTop }])
    .png({ compressionLevel: 1 })
    .toBuffer();
  return `data:image/png;base64,${output.toString("base64")}`;
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
  providerEnv?: ProviderEnvironment;
  signal?: AbortSignal;
  recordCandidate?(candidate: {
    attempt: number;
    request: ImageProviderRequest;
    candidateImage: string;
    review?: AdStudioCloneQualityReview;
    qaStatus?: "pending" | "passed" | "rejected" | "technical_failed" | "aborted";
    qaError?: string;
    accepted: boolean;
  }): Promise<void>;
}, dependencies: CloneRenderDependencies = {}): Promise<GeneratedCloneRender> {
  const generate = dependencies.generate ?? generateCloneWithCascade;
  const normalize = dependencies.normalize ?? normalizeCloneRenderAspect;
  const review = dependencies.review ?? reviewCloneCandidate;
  let request = input.request;
  let lastReview: AdStudioCloneQualityReview | undefined;
  let nextProviderIndex = 0;
  let generatedCandidateCount = 0;
  let correctedSameTierRetryUsed = false;
  let finalProviderRetryUsed = false;

  for (let attempt = 1; attempt <= MAX_RUNTIME_CLONE_CANDIDATES; attempt += 1) {
    const candidateRequest = {
      ...request,
      seed: (request.seed ?? 0) + attempt,
      signal: input.signal ?? request.signal,
    };
    // A provider that produced a valid image but missed visual QA will not
    // enter the technical fallback inside generateCloneWithCascade. Give the
    // independently priced fallback model the corrected request on later
    // candidates instead of paying the same model to repeat the same failure.
    // The first provider remains available behind that fallback for an actual
    // outage, and every candidate still uses the same canonical clone request.
    // A QA rejection normally advances Flash -> Pro -> GPT Image. One clean
    // near-pass may consume a corrected retry on its current tier, and the
    // final tier gets one corrected retry before failure. This keeps cheap
    // escalation as the default without discarding a 9+ candidate whose only
    // remaining work is the vision review's precise layout correction.
    const candidateProviders = input.providers.length === 0 ? [] : input.providers.slice(nextProviderIndex);
    if (input.providers.length > 0 && candidateProviders.length === 0) break;
    const generated = await generate({
      providers: candidateProviders,
      request: candidateRequest,
      workspaceId: input.workspaceId,
      userId: input.userId,
      correlationId: input.correlationId,
      attempt,
      modelProfile: input.modelProfile,
    });
    generatedCandidateCount += 1;
    // Transport fallback may mean a later tier actually produced the image.
    // Advance from the real successful provider/model. The bounded correction
    // policy below decides whether that tier gets its one permitted retry.
    if (input.providers.length > 0) {
      const successfulOffset = candidateProviders.findIndex((provider) =>
        provider.providerName === generated.provider
        && provider.accounting?.model === generated.model,
      );
      const providerNameOffset = candidateProviders.findIndex((provider) =>
        provider.providerName === generated.provider,
      );
      nextProviderIndex += successfulOffset >= 0
        ? successfulOffset
        : providerNameOffset >= 0 ? providerNameOffset : 0;
    }
    const exactAssetUrl = await normalize(generated.assetUrl, input.format);
    // Persist the normalized paid image before vision QA. A malformed QA
    // response must never make a billable candidate disappear from evidence.
    if (input.recordCandidate) {
      await input.recordCandidate({
        attempt,
        request: candidateRequest,
        candidateImage: exactAssetUrl,
        qaStatus: "pending",
        accepted: false,
      });
    }
    const finalizeQaFailure = async (error: unknown) => {
      if (!input.recordCandidate) return;
      const aborted = input.signal?.aborted === true || isAbortError(error);
      await input.recordCandidate({
        attempt,
        request: candidateRequest,
        candidateImage: exactAssetUrl,
        accepted: false,
        qaStatus: aborted ? "aborted" : "technical_failed",
        qaError: error instanceof Error ? error.message : "Clone QA failed without an error message.",
      });
    };
    try {
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
        providerEnv: input.providerEnv,
        signal: input.signal,
      });
    } catch (error) {
      await finalizeQaFailure(error);
      throw error;
    }
    if (!lastReview) {
      const error = new TemplateCampaignQaError("Clone quality review failed.");
      await finalizeQaFailure(error);
      throw error;
    }
    const accepted = cloneQualityPassed({
      review: lastReview,
      expectedCopy: input.expectedCopy,
      expectedAssetKeys: input.expectedAssetKeys,
    });
    if (input.recordCandidate) {
      await input.recordCandidate({
        attempt,
        request: candidateRequest,
        candidateImage: exactAssetUrl,
        review: lastReview,
        accepted,
      });
    }
    if (accepted) {
      return { ...generated, assetUrl: exactAssetUrl, attempt, qualityReview: lastReview };
    }
    if (attempt === MAX_RUNTIME_CLONE_CANDIDATES) break;
    if (input.providers.length > 0) {
      const atFinalProvider = nextProviderIndex >= input.providers.length - 1;
      const retryCurrentProvider = atFinalProvider
        ? !finalProviderRetryUsed
        : !correctedSameTierRetryUsed && cloneQualityWarrantsSameTierRetry({
          review: lastReview,
          expectedCopy: input.expectedCopy,
          expectedAssetKeys: input.expectedAssetKeys,
        });
      if (retryCurrentProvider) {
        if (atFinalProvider) finalProviderRetryUsed = true;
        else correctedSameTierRetryUsed = true;
      } else {
        nextProviderIndex += 1;
        if (nextProviderIndex >= input.providers.length) break;
      }
    }
    const correction = cloneCorrectionForNextCandidate(lastReview);
    request = { ...input.buildCorrectedRequest(correction), signal: input.signal };
  }
  throw new TemplateCampaignQaError(
    `The ad did not reach ${input.format} likeness quality after ${generatedCandidateCount} candidate(s).`,
    lastReview,
  );
}

export type CloneEditingLayersInput = {
  supabase: SupabaseGenerationClient;
  workspaceId: string;
  userId: string;
  correlationId: string;
  template: AdStudioTemplate;
  providerEnv?: ProviderEnvironment;
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
        providerEnv: input.providerEnv,
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
  const expectedCampaignId = await validateTemplateCampaignIdentity({
    workspaceId: input.workspaceId,
    body,
    expectedCampaignId: input.expectedCampaignId,
  });

  // The route persists this deterministic ID before any provider call. If
  // Vercel dies after the transactional Feed save, the VPS resumes the saved
  // campaign and its editor preparation instead of buying the same image again.
  const resumed = await resumePersistedTemplateCampaign({
    supabase: input.supabase,
    workspaceId: input.workspaceId,
    userId: input.userId,
    correlationId,
    expectedCampaignId,
    template,
    providerEnv: input.providerEnv,
  });
  if (resumed) return resumed;

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
  // The customer always receives the professional final-image lane. Keeping a
  // caller-supplied "fast" value for backward compatibility must never reduce
  // the quality of the finished ad.
  const generationQuality = "high" as const;
  const rasterPromise = ensureRasterReferenceImage(
    new URL(template.sample.imageSrc, input.origin).toString(),
  );
  const providersPromise = resolveCloneProviders(generationQuality, input.providerEnv);

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
        providerEnv: input.providerEnv,
        signal: input.signal,
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

  // One canonical full-ad request uses the approved template's native format.
  // The other placement is a deterministic derivative of those accepted
  // pixels; it never invokes a second provider or alternate full-ad builder.
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
  const nativeFormat = template.format;
  const derivedFormat = nativeFormat === PRIMARY_CLONE_FORMAT
    ? STORY_CLONE_FORMAT
    : PRIMARY_CLONE_FORMAT;
  const cloneRequest = { ...buildTemplateCloneRequest(template, cloneInputs), signal: input.signal };
  const feedCloneQa = buildPrebuiltTemplateCloneQa(template, expectedCopy, PRIMARY_CLONE_FORMAT);
  const storyCloneQa = buildPrebuiltTemplateCloneQa(template, expectedCopy, STORY_CLONE_FORMAT);
  const modelProfile = cloneModelProfileForQuality(generationQuality);
  // Review every customer/brand asset actually supplied, not just required
  // fields. An optional logo or secondary photo must never be allowed to leak,
  // disappear, or warp simply because its input contract is optional.
  const expectedAssetKeys = template.inputs.images
    .filter((slot) => Boolean(resolvedImages[slot.key]))
    .map((slot) => slot.key);
  const candidateAudit = (format: TemplateCloneRenderFormat) => {
    const candidatePaths = new Map<number, string>();
    return async (candidate: {
      attempt: number;
      request: ImageProviderRequest;
      candidateImage: string;
      review?: AdStudioCloneQualityReview;
      qaStatus?: "pending" | "passed" | "rejected" | "technical_failed" | "aborted";
      qaError?: string;
      accepted: boolean;
    }) => {
      const candidateImagePath = await recordCloneCandidateAudit({
        supabase: input.supabase as unknown as CloneCandidateAuditClient,
        workspaceId: input.workspaceId,
        correlationId,
        templateId: template.id,
        format,
        candidateImagePath: candidatePaths.get(candidate.attempt),
        ...candidate,
      });
      candidatePaths.set(candidate.attempt, candidateImagePath);
    };
  };
  const nativeRender = await generateFinalCloneRender({
    format: nativeFormat,
    templateId: template.id,
    providers,
    request: cloneRequest,
    referenceImage,
    expectedCopy,
    expectedAssetKeys,
    buildCorrectedRequest: (correction) => buildTemplateCloneRequest(template, {
      ...cloneInputs,
      reviewCorrection: correction,
    }),
    workspaceId: input.workspaceId,
    userId: input.userId,
    correlationId,
    modelProfile,
    providerEnv: input.providerEnv,
    signal: input.signal,
    recordCandidate: candidateAudit(nativeFormat),
  });

  const derivedAssetUrl = await derivePlacementCloneFromFinishedNative(
    nativeRender.assetUrl,
    nativeFormat,
    derivedFormat,
  );
  const [nativeImage, derivedImage] = await Promise.all([
    persistCloneRender({
      supabase,
      workspaceId: input.workspaceId,
      assetUrl: nativeRender.assetUrl,
      fileNameSeed: `${correlationId}-clone-${nativeFormat.replace(":", "x")}`,
    }),
    persistCloneRender({
      supabase,
      workspaceId: input.workspaceId,
      assetUrl: derivedAssetUrl,
      fileNameSeed: `${correlationId}-clone-${derivedFormat.replace(":", "x")}`,
    }),
  ]);
  const nativePersisted: PersistedCloneRender = { ...nativeRender, image: nativeImage };
  const placementImages = {
    [nativeFormat]: nativeImage,
    [derivedFormat]: derivedImage,
  } as Record<TemplateCloneRenderFormat, string>;
  const placementAssetUrls = {
    [nativeFormat]: nativeRender.assetUrl,
    [derivedFormat]: derivedAssetUrl,
  } as Record<TemplateCloneRenderFormat, string>;

  // Both immutable placement outputs enter the same transactional pack write,
  // so publish readiness never observes a half-created Feed-only campaign.
  const campaignPack = applyProvidedCopyToCampaignPack(
    buildCloneCampaignPack({
      campaignId: expectedCampaignId,
      workspaceId: input.workspaceId,
      brandKit,
      suburb: body.suburb ?? "Scarborough",
      city: body.city ?? "Perth",
      state: body.state ?? "WA",
      firstAd: {
        ...firstAd,
        imageDataUrl: placementImages[PRIMARY_CLONE_FORMAT],
        templateCloneImage: placementImages[PRIMARY_CLONE_FORMAT],
        templateCloneImagesByFormat: {
          [PRIMARY_CLONE_FORMAT]: placementImages[PRIMARY_CLONE_FORMAT],
          [STORY_CLONE_FORMAT]: placementImages[STORY_CLONE_FORMAT],
        },
        templateCloneProvider: nativePersisted.provider,
        templateCloneModel: nativePersisted.model,
        templateCloneQaByFormat: feedCloneQa
          ? {
              [PRIMARY_CLONE_FORMAT]: feedCloneQa,
              ...(storyCloneQa ? { [STORY_CLONE_FORMAT]: storyCloneQa } : {}),
            }
          : undefined,
        copy: copyResult.copy,
      },
    }),
    copyResult.copy,
  );

  // Replace the pack's offer-library defaults with the brief-grounded feed copy
  // (full AI enrichment on template ads was a past regression — it overwrote
  // curated copy with generic text and collapsed CTAs to "Learn more").
  const persisted = await persistAdStudioCampaignPack(supabase, campaignPack, input.userId);
  if (persisted.error) {
    throw new Error(
      `Your ad was generated but could not be saved (${persisted.error.message}). Please try again.`,
    );
  }

  if (input.creditReservation) {
    await settleWorkspaceCreditReservation({
      reservation: input.creditReservation,
      credits: 1,
      mutationKey: `${input.creditReservation.mutationKey}:settle:full-ad`,
      metadata: {
        format: nativeFormat,
        derivedFormats: [derivedFormat],
        campaignId: campaignPack.campaign.campaignId,
      },
    });
    if (input.creditReservation.creditsOutstanding > 0) {
      await refundWorkspaceCreditReservation({
        reservation: input.creditReservation,
        mutationKey: `${input.creditReservation.mutationKey}:refund:legacy-placement-surplus`,
        reason: "story_is_deterministic_derivative",
        metadata: { campaignId: campaignPack.campaign.campaignId },
      });
    }
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
  const placementCreatives = campaignPack.creatives.flatMap((creative) => {
    const format = creative.format as TemplateCloneRenderFormat;
    const imageRef = placementImages[format] ?? null;
    const imageUrl = placementAssetUrls[format] ?? null;
    return imageRef && imageUrl
      ? [{ format: creative.format as TemplateCloneRenderFormat, creativeId: creative.creativeId, imageRef, imageUrl }]
      : [];
  });
  const editingLayersTask = placementCreatives.length > 0
    ? prepareCloneCreativeTextLayers({
          supabase: input.supabase,
          workspaceId: input.workspaceId,
          userId: input.userId,
          correlationId,
          template,
          providerEnv: input.providerEnv,
          renders: placementCreatives,
        })
    : Promise.resolve();
  void editingLayersTask.catch(() => undefined);

  return {
    campaignId: campaignPack.campaign.campaignId,
    campaignPack,
    editingLayersTask,
    requiresDeterministicEditing: deterministicEditingReadiness(template).status === "ready",
  };
}
