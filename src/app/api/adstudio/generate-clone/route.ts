import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { createImageProviderForCandidate, createOpenAiImageProvider } from "@/lib/adstudio/ai-providers";
import { cloneQaCorrectionPrompt, runCloneQa } from "@/lib/adstudio/clone-qa";
import { runComplianceGate } from "@/lib/adstudio/creative-qa";
import { dataUrlToUploadBytes } from "@/lib/adstudio/generated-media";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { buildCloneImageRequest, resolveCloneCopy } from "@/lib/adstudio/reference-clone";
import { resolveAdStudioImageForModel } from "@/lib/adstudio/resolve-image-for-model";
import { getTemplateBrief } from "@/lib/adstudio/template-brief";
import type { AdStudioCloneQa } from "@/lib/adstudio/types";
import type { ImageProviderAdapter, ImageProviderRequest } from "@/lib/adstudio/providers";
import { modelCandidateAttempts, resolveRuntimeModelProfile } from "@/lib/operator/prompts/model-profile-runtime";
import { recordAdStudioProviderRun } from "@/lib/operator/prompts/redact-prompt-run";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type GenerateCloneBody = {
  /** The gallery template whose design we clone. */
  templateId?: string;
  /** Customer images keyed by the template's image-slot role (media path or data URL). */
  images?: Record<string, string>;
  /** Copy values keyed by the template's copy-field key (falls back to defaults). */
  copy?: Record<string, string>;
  /** Optional brand accent hex override (from the brand kit). */
  brandHex?: string;
  /** "preview" = fast/cheap tier (edit loop); "final" = quality tier (default). */
  tier?: "preview" | "final";
};

// Keep headroom under maxDuration for persistence + response.
const ROUTE_DEADLINE_MS = 100_000;
const MAX_ATTEMPTS: Record<"preview" | "final", number> = { preview: 3, final: 2 };

export async function POST(request: NextRequest) {
  const context = await requireAdStudioRequest(request);
  if (!context.ok) return context.response;

  const rateLimit = await checkRateLimit(context.supabase, context.access.workspaceId, context.access.userId, {
    windowSeconds: 3600,
    maxRequests: 12,
    bucket: "ai-generate-clone",
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const body = await readJsonBody<GenerateCloneBody>(request);
  if (!body.templateId) {
    return NextResponse.json({ error: "templateId is required." }, { status: 400 });
  }

  const brief = getTemplateBrief(body.templateId);
  if (!brief) {
    return NextResponse.json({ error: `Unknown template: ${body.templateId}` }, { status: 404 });
  }

  // Resolve each supplied customer image to something the model can consume.
  const suppliedImages = body.images ?? {};
  const resolvedImages: Record<string, string> = {};
  for (const slot of brief.imageSlots) {
    const ref = suppliedImages[slot.role] ?? (slot.objectId ? suppliedImages[slot.objectId] : undefined);
    if (ref && ref.trim()) {
      const resolved = await resolveAdStudioImageForModel(context.supabase, context.access.workspaceId, ref.trim());
      if (!resolved) {
        return NextResponse.json({ error: `Image for "${slot.role}" could not be read.` }, { status: 400 });
      }
      resolvedImages[slot.role] = resolved;
    } else if (slot.required) {
      return NextResponse.json({ error: `Missing required image: ${slot.role}` }, { status: 400 });
    }
  }

  // The design-to-clone is the template's public sample, made absolute so any provider can fetch it.
  const referenceImage = new URL(brief.referenceImage, request.nextUrl.origin).toString();
  const tier: "preview" | "final" = body.tier === "preview" ? "preview" : "final";

  let expectedCopy: Record<string, string>;
  let baseRequest: ImageProviderRequest;
  try {
    expectedCopy = resolveCloneCopy(brief, body.copy);
    baseRequest = buildCloneImageRequest(brief, {
      referenceImage,
      images: resolvedImages,
      copy: body.copy,
      brandHex: body.brandHex,
    });
  } catch (error) {
    return errorResponse(error, 400);
  }

  const providers = await resolveCloneProviders(tier);
  const correlationId = randomUUID();
  const deadline = Date.now() + ROUTE_DEADLINE_MS;
  const maxAttempts = MAX_ATTEMPTS[tier];

  let qa: AdStudioCloneQa | null = null;
  let lastImage: { assetUrl: string; model: string; provider: string } | null = null;
  let correction = "";

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const generated = await generateWithCascade({
        providers,
        request: {
          ...baseRequest,
          prompt: correction ? `${baseRequest.prompt} ${correction}` : baseRequest.prompt,
          seed: (baseRequest.seed ?? 0) + attempt,
        },
        workspaceId: context.access.workspaceId,
        userId: context.access.userId,
        correlationId,
        tier,
        attempt,
      });
      lastImage = generated;

      // QA on the raw model output (data: URL) — the persisted media path is
      // auth-protected and unreachable for the vision model.
      qa = await runCloneQa({
        workspaceId: context.access.workspaceId,
        userId: context.access.userId,
        correlationId,
        imageUrl: generated.assetUrl,
        expectedCopy,
        attempt,
      });

      if (qa.passed) break;
      if (attempt >= maxAttempts || Date.now() >= deadline) break;
      correction = cloneQaCorrectionPrompt(qa);
    }
  } catch (error) {
    return errorResponse(error, 502);
  }

  if (!lastImage) {
    return NextResponse.json({ error: "Clone generation failed. Try again." }, { status: 502 });
  }

  // A clone that failed copy verification never ships silently: the caller gets
  // the report and decides (the dialog surfaces it as a retryable error).
  if (qa && !qa.passed) {
    return NextResponse.json(
      {
        error: "The generated ad did not render your copy correctly. Please try again.",
        qa,
      },
      { status: 502 },
    );
  }

  const image = await persistGeneratedImage({
    supabase: context.supabase,
    workspaceId: context.access.workspaceId,
    assetUrl: lastImage.assetUrl,
    fileNameSeed: `${correlationId}-clone`,
  });

  return NextResponse.json({
    templateId: body.templateId,
    image,
    model: lastImage.model,
    provider: lastImage.provider,
    qa,
    compliance: runComplianceGate(Object.values(expectedCopy).join(" ")),
  });
}

/** Ordered providers for the tier: profile candidates, then a direct-OpenAI last resort. */
async function resolveCloneProviders(tier: "preview" | "final"): Promise<ImageProviderAdapter[]> {
  const profile = await resolveRuntimeModelProfile(tier === "preview" ? "image_draft" : "image_final");
  const providers = modelCandidateAttempts(profile).map((candidate) => createImageProviderForCandidate(candidate));
  providers.push(createOpenAiImageProvider());
  return providers;
}

async function generateWithCascade(input: {
  providers: ImageProviderAdapter[];
  request: ImageProviderRequest;
  workspaceId: string;
  userId: string;
  correlationId: string;
  tier: "preview" | "final";
  attempt: number;
}): Promise<{ assetUrl: string; model: string; provider: string }> {
  const startedAt = Date.now();
  const attempts: Array<{ provider: string; model: string; status: "attempted" | "failed" | "completed"; error?: string }> = [];
  const prompt = {
    system: "",
    user: input.request.prompt,
    fullPrompt: input.request.prompt,
    promptVersions: [],
    fallbackPromptUsed: false,
    warnings: [],
  };
  let lastError: unknown = null;

  for (const provider of input.providers) {
    attempts.push({ provider: provider.providerName, model: "unknown", status: "attempted" });
    try {
      const result = await provider.generate(input.request);
      if (!result.assetUrl) throw new Error("Provider returned no image.");
      attempts[attempts.length - 1] = { provider: provider.providerName, model: result.model, status: "completed" };
      await recordAdStudioProviderRun({
        workspaceId: input.workspaceId,
        userId: input.userId,
        correlationId: input.correlationId,
        taskType: "adstudio.clone",
        modelProfile: input.tier === "preview" ? "image_draft" : "image_final",
        prompt,
        input: { tier: input.tier, attempt: input.attempt },
        attempts,
        latencyMs: Date.now() - startedAt,
        providerName: provider.providerName,
        providerType: "image_generation",
        modelName: result.model,
        output: null,
        status: "completed",
      });
      return { assetUrl: result.assetUrl, model: result.model, provider: provider.providerName };
    } catch (error) {
      lastError = error;
      attempts[attempts.length - 1] = {
        provider: provider.providerName,
        model: "unavailable",
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  await recordAdStudioProviderRun({
    workspaceId: input.workspaceId,
    userId: input.userId,
    correlationId: input.correlationId,
    taskType: "adstudio.clone",
    modelProfile: input.tier === "preview" ? "image_draft" : "image_final",
    prompt,
    input: { tier: input.tier, attempt: input.attempt },
    attempts,
    latencyMs: Date.now() - startedAt,
    providerName: "unavailable",
    providerType: "image_generation",
    modelName: "unavailable",
    output: null,
    status: "failed",
    error: lastError,
  });
  throw lastError instanceof Error ? lastError : new Error("Clone generation is not configured.");
}

async function persistGeneratedImage(input: {
  supabase: {
    storage: {
      from(bucket: string): {
        upload(
          path: string,
          bytes: Uint8Array,
          options: { contentType: string; upsert: boolean },
        ): Promise<{ error: { message: string } | null }>;
      };
    };
  };
  workspaceId: string;
  assetUrl: string;
  fileNameSeed: string;
}): Promise<string> {
  if (!input.assetUrl || !input.assetUrl.startsWith("data:image/")) return input.assetUrl;
  const decoded = dataUrlToUploadBytes(input.assetUrl);
  const storagePath = `${input.workspaceId}/adstudio/clones/${input.fileNameSeed}.${decoded.extension}`;
  const { error } = await input.supabase.storage
    .from("workspace-artifacts")
    .upload(storagePath, decoded.bytes, { contentType: decoded.contentType, upsert: false });
  if (error) throw new Error("Generated clone could not be stored.");
  return `/api/adstudio/media?path=${encodeURIComponent(storagePath)}`;
}
