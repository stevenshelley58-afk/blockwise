import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { createImageProviderForCandidate, createOpenAiImageProvider } from "@/lib/adstudio/ai-providers";
import { clampOptionCount, generateCreativeOptions } from "@/lib/adstudio/creative-options";
import { dataUrlToUploadBytes } from "@/lib/adstudio/generated-media";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import type { ImageProviderAdapter, ImageProviderRequest } from "@/lib/adstudio/providers";
import { resolveAdStudioImageForModel } from "@/lib/adstudio/resolve-image-for-model";
import { checkRateLimit } from "@/lib/rate-limit";
import { assembleImagePrompt } from "@/lib/operator/prompts/assemble-prompt";
import { modelCandidateAttempts, resolveRuntimeModelProfile } from "@/lib/operator/prompts/model-profile-runtime";
import { getActivePromptBundle, type PromptKey } from "@/lib/operator/prompts/prompt-registry";
import { recordAdStudioProviderRun } from "@/lib/operator/prompts/redact-prompt-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type GenerateOptionsBody = {
  /** Per-template generative prompt (operator-controlled; never shown to the user). */
  prompt?: string;
  /** The user's copy — grounds the generation and is re-checked for compliance. */
  copyText?: string;
  /** The user's photo (a media path / data URL); resolved to a model reference. */
  sourceImage?: string;
  aspectRatio?: string;
  stylePreset?: string;
  brandKitId?: string;
  optionCount?: number;
  brand?: {
    palette?: string[];
    styleTags?: string[];
    imageTreatment?: string;
  };
};

const IMAGE_PROMPT_KEYS: PromptKey[] = [
  "adstudio.image.system",
  "adstudio.image.input_template",
  "adstudio.image.brand_rules",
  "adstudio.image.negative_prompt",
  "adstudio.image.aspect_ratio_rules",
];

export async function POST(request: NextRequest) {
  const context = await requireAdStudioRequest(request);

  if (!context.ok) {
    return context.response;
  }

  const rateLimit = await checkRateLimit(
    context.supabase,
    context.access.workspaceId,
    context.access.userId,
    { windowSeconds: 3600, maxRequests: 8, bucket: "ai-generate-options" },
  );
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const body = await readJsonBody<GenerateOptionsBody>(request);

  if (!body.prompt || !body.prompt.trim()) {
    return NextResponse.json({ error: "A generative prompt is required." }, { status: 400 });
  }

  const startedAt = Date.now();
  const correlationId = randomUUID();
  const aspectRatio = body.aspectRatio ?? "1:1";
  const stylePreset = body.stylePreset ?? "real_estate_photography";
  const copyText = typeof body.copyText === "string" ? body.copyText : "";
  const count = clampOptionCount(body.optionCount);

  // Resolve the user's photo to a model-consumable reference. With WS1, OpenAI's
  // gpt-image-2 can now consume references via /images/edits, so the photo grounds
  // the generative options (it does not just sit in the prompt text).
  let referenceAssets: string[] = [];
  if (body.sourceImage && body.sourceImage.trim()) {
    const resolved = await resolveAdStudioImageForModel(
      context.supabase,
      context.access.workspaceId,
      body.sourceImage.trim(),
    );
    if (!resolved) {
      return NextResponse.json({ error: "Source image could not be read for generation." }, { status: 400 });
    }
    referenceAssets = [resolved];
  }

  const bundle = await getActivePromptBundle(IMAGE_PROMPT_KEYS);
  const assembled = assembleImagePrompt({
    bundle,
    prompt: body.prompt.trim(),
    brand: body.brand,
    aspectRatio,
    stylePreset,
    referenceAssets,
  });
  const imageInput: ImageProviderRequest = {
    prompt: assembled.fullPrompt,
    negativePrompt: bundle["adstudio.image.negative_prompt"].body,
    referenceAssets,
    aspectRatio,
    stylePreset,
    requiresReferenceAssets: referenceAssets.length > 0,
    seed: 0,
  };

  try {
    const profile = await resolveRuntimeModelProfile("image_generative");
    const providers: ImageProviderAdapter[] = [
      ...modelCandidateAttempts(profile).map((candidate) => createImageProviderForCandidate(candidate)),
      createOpenAiImageProvider(),
    ];

    const generated = await generateCreativeOptions({ providers, imageInput, copyText, count });

    if (generated.options.length === 0) {
      await recordAdStudioProviderRun({
        workspaceId: context.access.workspaceId,
        userId: context.access.userId,
        correlationId,
        taskType: "adstudio.image",
        modelProfile: "image_generative",
        prompt: assembled,
        input: { prompt: body.prompt, brand: body.brand, aspectRatio, stylePreset, optionCount: count },
        attempts: generated.attempts,
        latencyMs: Date.now() - startedAt,
        providerName: "unavailable",
        providerType: "image_generation",
        modelName: "unavailable",
        output: null,
        status: "failed",
        error: new Error("No generative options were returned by the providers."),
      });
      return NextResponse.json({ error: "No generative options were returned." }, { status: 502 });
    }

    const stored = await Promise.all(
      generated.options.map((option) =>
        persistGeneratedImage({
          supabase: context.supabase,
          workspaceId: context.access.workspaceId,
          brandKitId: body.brandKitId,
          assetUrl: option.assetUrl,
          fileNameSeed: `${correlationId}-opt-${option.index}`,
        }),
      ),
    );

    await recordAdStudioProviderRun({
      workspaceId: context.access.workspaceId,
      userId: context.access.userId,
      correlationId,
      taskType: "adstudio.image",
      modelProfile: "image_generative",
      prompt: assembled,
      input: { prompt: body.prompt, brand: body.brand, aspectRatio, stylePreset, optionCount: count },
      attempts: generated.attempts,
      latencyMs: Date.now() - startedAt,
      providerName: generated.options[0].provider,
      providerType: "image_generation",
      modelName: generated.options[0].model,
      output: {
        assetUrl: generated.options[0].assetUrl,
        seed: generated.options[0].seed,
        model: generated.options[0].model,
        providerMetadata: { provider: generated.options[0].provider, optionCount: generated.options.length },
      },
      status: "completed",
    });

    return NextResponse.json({
      options: generated.options.map((option, index) => ({
        image: stored[index] ?? option.assetUrl,
        model: option.model,
        provider: option.provider,
        index: option.index,
      })),
      // WS7: edits/generation re-trigger the compliance check.
      compliance: { pass: generated.compliance.pass, issues: generated.compliance.issues },
    });
  } catch (error) {
    await recordAdStudioProviderRun({
      workspaceId: context.access.workspaceId,
      userId: context.access.userId,
      correlationId,
      taskType: "adstudio.image",
      modelProfile: "image_generative",
      prompt: assembled,
      input: { prompt: body.prompt, brand: body.brand, aspectRatio, stylePreset, optionCount: count },
      attempts: [],
      latencyMs: Date.now() - startedAt,
      providerName: "unavailable",
      providerType: "image_generation",
      modelName: "unavailable",
      output: null,
      status: "failed",
      error,
    });
    return errorResponse(error, 500);
  }
}

async function persistGeneratedImage(input: {
  supabase: any;
  workspaceId: string;
  brandKitId?: string;
  assetUrl: string;
  fileNameSeed: string;
}): Promise<string> {
  if (!input.assetUrl) return input.assetUrl;
  if (!input.assetUrl.startsWith("data:image/")) return input.assetUrl;

  const decoded = dataUrlToUploadBytes(input.assetUrl);
  const storagePath = `${input.workspaceId}/adstudio/options/${input.fileNameSeed}.${decoded.extension}`;
  const { error } = await input.supabase.storage
    .from("workspace-artifacts")
    .upload(storagePath, decoded.bytes, { contentType: decoded.contentType, upsert: false });
  if (error) throw new Error("Generated option could not be stored.");

  return `/api/adstudio/media?path=${encodeURIComponent(storagePath)}`;
}
