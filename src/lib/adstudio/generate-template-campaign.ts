// The complete server-side template-campaign generation pipeline, callable from
// the campaigns POST route (synchronous fallback) or the trigger.dev task
// "adstudio.generate.template" (the normal async path — no 120s route ceiling).
//
// Order matters and is the product: brand kit → slot images → brief-grounded
// copy (on-image fields + feed copy in one pass) → reference clone with QA
// reroll → deterministic pack build → provided-copy application → one
// transactional persist. Every failure throws with a user-readable message; a
// clone that never passes QA throws TemplateCampaignQaError carrying the report.

import { randomUUID } from "node:crypto";

import { applyProvidedCopyToCampaignPack } from "./campaign-copy-enrichment.ts";
import { generateCloneWithCascade, persistCloneRender, resolveCloneProviders } from "./clone-generation.ts";
import { cloneQaCorrectionPrompt, runCloneQa } from "./clone-qa.ts";
import { generateAdStudioTemplateCopy } from "./copy-generation.ts";
import { generateAdStudioCampaignPack } from "./generator.ts";
import { persistAdStudioCampaignPack } from "./persistence.ts";
import { buildCloneImageRequest, resolveCloneCopy } from "./reference-clone.ts";
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

/** Thrown when every clone attempt failed vision QA; carries the last report. */
export class TemplateCampaignQaError extends Error {
  readonly qa: AdStudioCloneQa;

  constructor(message: string, qa: AdStudioCloneQa) {
    super(message);
    this.name = "TemplateCampaignQaError";
    this.qa = qa;
  }
}

export type RunTemplateCampaignGenerationInput = {
  supabase: SupabaseGenerationClient;
  workspaceId: string;
  userId: string;
  /** Absolute base URL used to resolve the template's public sample image. */
  origin: string;
  body: CreateCampaignBody;
  /** Hard time budget; QA rerolls stop once it is spent. */
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

  // Clone cascade + QA reroll (same loop as the generate-clone route, quality
  // tier): generate → verify the exact rendered copy → reroll with a corrective
  // prompt until it passes, attempts or deadline run out.
  const referenceImage = new URL(brief.referenceImage, input.origin).toString();
  const expectedCopy = resolveCloneCopy(brief, copyResult.onImage);
  const baseRequest = buildCloneImageRequest(brief, {
    referenceImage,
    images: resolvedImages,
    copy: copyResult.onImage,
    brandHex: brandKit.colours.accent || brandKit.colours.primary,
  });
  const providers = await resolveCloneProviders("final");
  const maxAttempts = Math.max(1, input.maxCloneAttempts);

  let qa: AdStudioCloneQa | null = null;
  let lastImage: { assetUrl: string; model: string; provider: string } | null = null;
  let correction = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const generated = await generateCloneWithCascade({
      providers,
      request: {
        ...baseRequest,
        prompt: correction ? `${baseRequest.prompt} ${correction}` : baseRequest.prompt,
        seed: (baseRequest.seed ?? 0) + attempt,
      },
      workspaceId: input.workspaceId,
      userId: input.userId,
      correlationId,
      tier: "final",
      attempt,
    });
    lastImage = generated;

    // QA on the raw model output (data: URL) — the persisted media path is
    // auth-protected and unreachable for the vision model.
    qa = await runCloneQa({
      workspaceId: input.workspaceId,
      userId: input.userId,
      correlationId,
      imageUrl: generated.assetUrl,
      expectedCopy,
      attempt,
    });

    if (qa.passed) break;
    if (attempt >= maxAttempts || Date.now() >= deadline) break;
    correction = cloneQaCorrectionPrompt(qa);
  }

  if (!lastImage) {
    throw new Error("Clone generation failed. Try again.");
  }

  // A clone that failed copy verification never ships silently.
  if (qa && !qa.passed) {
    throw new TemplateCampaignQaError(
      "The generated ad did not render your copy correctly. Please try again.",
      qa,
    );
  }

  const cloneImage = await persistCloneRender({
    supabase,
    workspaceId: input.workspaceId,
    assetUrl: lastImage.assetUrl,
    fileNameSeed: `${correlationId}-clone`,
  });

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
      imageDataUrl: cloneImage,
      templateCloneImage: cloneImage,
      templateCloneProvider: lastImage.provider,
      templateCloneModel: lastImage.model,
      templateCloneQa: qa ?? undefined,
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

  return { campaignId: pack.campaign.campaignId, campaignPack: pack, qa };
}
