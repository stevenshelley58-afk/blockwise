import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { createOpenAiImageProvider, generateMixedImageVariantsInParallel } from "@/lib/adstudio";
import { createImageProviderForCandidate } from "@/lib/adstudio/ai-providers";
import { dataUrlToUploadBytes } from "@/lib/adstudio/generated-media";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import type { ImageProviderAdapter, ImageProviderRequest, ImageProviderResponse } from "@/lib/adstudio/providers";
import { assembleImagePrompt } from "@/lib/operator/prompts/assemble-prompt";
import { modelCandidateAttempts, resolveRuntimeModelProfile } from "@/lib/operator/prompts/model-profile-runtime";
import { getActivePromptBundle, type PromptKey } from "@/lib/operator/prompts/prompt-registry";
import { recordAdStudioProviderRun } from "@/lib/operator/prompts/redact-prompt-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type GenerateImageBody = {
  prompt?: string;
  aspectRatio?: string;
  stylePreset?: string;
  referenceAssets?: string[];
  variantCount?: number;
  brandKitId?: string;
  /** Brand kit visual context - appended so scenes match the brand look. */
  brand?: {
    palette?: string[];
    styleTags?: string[];
    imageTreatment?: string;
  };
};

type ImageGenerationResult = {
  result: ImageProviderResponse;
  providerName: string;
  modelName: string;
  attempts: Array<{ provider: string; model: string; status: "attempted" | "failed" | "completed"; error?: string }>;
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

  const body = await readJsonBody<GenerateImageBody>(request);

  if (!body.prompt || !body.prompt.trim()) {
    return NextResponse.json({ error: "An image prompt is required." }, { status: 400 });
  }

  const startedAt = Date.now();
  const correlationId = randomUUID();
  const referenceAssets = body.referenceAssets ?? [];
  const aspectRatio = body.aspectRatio ?? "1:1";
  const stylePreset = body.stylePreset ?? "real_estate_photography";
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
  };

  try {
    if ((body.variantCount ?? 1) > 1) {
      const variants = await generateMixedDraftVariants(imageInput);
      const first = variants.variants.find((variant) => variant.assetUrl);

      if (!first) {
        await recordAdStudioProviderRun({
          workspaceId: context.access.workspaceId,
          userId: context.access.userId,
          correlationId,
          taskType: "adstudio.image",
          modelProfile: "image_draft",
          prompt: assembled,
          input: {
            prompt: body.prompt,
            brand: body.brand,
            aspectRatio,
            stylePreset,
            referenceAssets,
            variantCount: body.variantCount,
          },
          attempts: variants.attempts,
          latencyMs: Date.now() - startedAt,
          providerName: "mixed",
          providerType: "image_generation",
          modelName: "unavailable",
          output: null,
          status: "failed",
          error: new Error("No image was returned by the providers."),
        });
        return NextResponse.json({ error: "No image was returned by the providers." }, { status: 502 });
      }

      await recordAdStudioProviderRun({
        workspaceId: context.access.workspaceId,
        userId: context.access.userId,
        correlationId,
        taskType: "adstudio.image",
        modelProfile: "image_draft",
        prompt: assembled,
        input: {
          prompt: body.prompt,
          brand: body.brand,
          aspectRatio,
          stylePreset,
          referenceAssets,
          variantCount: body.variantCount,
        },
        attempts: variants.attempts,
        latencyMs: Date.now() - startedAt,
        providerName: "mixed",
        providerType: "image_generation",
        modelName: first.model,
        output: first,
        status: "completed",
      });

      const storedVariants = await Promise.all(
        variants.variants.map((variant) =>
          persistGeneratedImage({
            supabase: context.supabase,
            workspaceId: context.access.workspaceId,
            brandKitId: body.brandKitId,
            assetUrl: variant.assetUrl,
            fileNameSeed: `${correlationId}-${variant.seed}`,
          }),
        ),
      );
      const storedFirst = storedVariants[variants.variants.indexOf(first)] ?? first.assetUrl;

      return NextResponse.json({
        image: storedFirst,
        model: first.model,
        variants: variants.variants.map((variant, index) => ({
          image: storedVariants[index] ?? variant.assetUrl,
          model: variant.model,
          provider: variant.providerMetadata.provider,
          index,
        })),
      });
    }

    const generation = await generateSingleImageWithProfile(imageInput);

    if (!generation.result.assetUrl) {
      await recordAdStudioProviderRun({
        workspaceId: context.access.workspaceId,
        userId: context.access.userId,
        correlationId,
        taskType: "adstudio.image",
        modelProfile: "image_final",
        prompt: assembled,
        input: {
          prompt: body.prompt,
          brand: body.brand,
          aspectRatio,
          stylePreset,
          referenceAssets,
          variantCount: body.variantCount,
        },
        attempts: generation.attempts,
        latencyMs: Date.now() - startedAt,
        providerName: generation.providerName,
        providerType: "image_generation",
        modelName: generation.modelName,
        output: generation.result,
        status: "failed",
        error: new Error("No image was returned by the provider."),
      });
      return NextResponse.json({ error: "No image was returned by the provider." }, { status: 502 });
    }

    await recordAdStudioProviderRun({
      workspaceId: context.access.workspaceId,
      userId: context.access.userId,
      correlationId,
      taskType: "adstudio.image",
      modelProfile: "image_final",
      prompt: assembled,
      input: {
        prompt: body.prompt,
        brand: body.brand,
        aspectRatio,
        stylePreset,
        referenceAssets,
        variantCount: body.variantCount,
      },
      attempts: generation.attempts,
      latencyMs: Date.now() - startedAt,
      providerName: generation.providerName,
      providerType: "image_generation",
      modelName: generation.modelName,
      output: generation.result,
      status: "completed",
    });

    const storedImage = await persistGeneratedImage({
      supabase: context.supabase,
      workspaceId: context.access.workspaceId,
      brandKitId: body.brandKitId,
      assetUrl: generation.result.assetUrl,
      fileNameSeed: correlationId,
    });

    return NextResponse.json({ image: storedImage, model: generation.result.model });
  } catch (error) {
    await recordAdStudioProviderRun({
      workspaceId: context.access.workspaceId,
      userId: context.access.userId,
      correlationId,
      taskType: "adstudio.image",
      modelProfile: (body.variantCount ?? 1) > 1 ? "image_draft" : "image_final",
      prompt: assembled,
      input: {
        prompt: body.prompt,
        brand: body.brand,
        aspectRatio,
        stylePreset,
        referenceAssets,
        variantCount: body.variantCount,
      },
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

  let storedUrl = input.assetUrl;
  let storagePath: string | null = null;
  let contentType: string | null = null;

  if (input.assetUrl.startsWith("data:image/")) {
    const decoded = dataUrlToUploadBytes(input.assetUrl);
    contentType = decoded.contentType;
    storagePath = `${input.workspaceId}/adstudio/generated/${input.fileNameSeed}.${decoded.extension}`;
    const { error } = await input.supabase.storage
      .from("workspace-artifacts")
      .upload(storagePath, decoded.bytes, { contentType: decoded.contentType, upsert: false });
    if (error) throw new Error("Generated image could not be stored.");
    storedUrl = `/api/adstudio/media?path=${encodeURIComponent(storagePath)}`;
  }

  if (input.brandKitId) {
    await recordGeneratedAsset({
      supabase: input.supabase,
      workspaceId: input.workspaceId,
      brandKitId: input.brandKitId,
      sourceUrl: storedUrl.startsWith("/api/adstudio/media?") ? undefined : storedUrl,
      storagePath,
      metadata: {
        generated: true,
        contentType,
      },
    });
  }

  return storedUrl;
}

async function recordGeneratedAsset(input: {
  supabase: any;
  workspaceId: string;
  brandKitId: string;
  sourceUrl?: string;
  storagePath: string | null;
  metadata: Record<string, unknown>;
}) {
  const { data: brandKit, error: brandError } = await input.supabase
    .from("adstudio_brand_kits")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.brandKitId)
    .maybeSingle();

  if (brandError) throw new Error(brandError.message);
  if (!brandKit) return;

  const { error } = await input.supabase.from("adstudio_brand_assets").insert({
    workspace_id: input.workspaceId,
    brand_kit_id: input.brandKitId,
    asset_type: "listing_image",
    source_url: input.sourceUrl,
    storage_path: input.storagePath,
    metadata_json: input.metadata,
  });
  if (error) throw new Error(error.message);
}

async function generateMixedDraftVariants(input: ImageProviderRequest): Promise<{
  variants: ImageProviderResponse[];
  attempts: ImageGenerationResult["attempts"];
}> {
  const profile = await resolveRuntimeModelProfile("image_draft");
  const candidates = modelCandidateAttempts(profile);
  const openAiModel = candidates.find((candidate) => candidate.provider === "openai")?.model;
  const openRouterModel = candidates.find((candidate) => candidate.provider === "openrouter")?.model;
  const variants = await generateMixedImageVariantsInParallel(input, {
    openAiModel,
    openRouterModel,
  });

  return {
    variants,
    attempts: variants.map((variant) => ({
      provider: String(variant.providerMetadata.provider ?? "unknown"),
      model: variant.model,
      status: variant.assetUrl ? "completed" : "failed",
    })),
  };
}

async function generateSingleImageWithProfile(input: ImageProviderRequest): Promise<ImageGenerationResult> {
  const profile = await resolveRuntimeModelProfile("image_final");
  const attempts: ImageGenerationResult["attempts"] = [];
  let lastError: unknown = null;

  for (const candidate of modelCandidateAttempts(profile)) {
    const provider = createImageProviderForCandidate(candidate);
    attempts.push({ provider: provider.providerName, model: candidate.model, status: "attempted" });

    try {
      const result = await provider.generate(input);
      attempts[attempts.length - 1] = { provider: provider.providerName, model: candidate.model, status: "completed" };
      return {
        result,
        providerName: provider.providerName,
        modelName: result.model,
        attempts,
      };
    } catch (error) {
      lastError = error;
      attempts[attempts.length - 1] = {
        provider: provider.providerName,
        model: candidate.model,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const fallbackProvider: ImageProviderAdapter = createOpenAiImageProvider();
  attempts.push({ provider: fallbackProvider.providerName, model: "env_default", status: "attempted" });

  try {
    const result = await fallbackProvider.generate(input);
    attempts[attempts.length - 1] = { provider: fallbackProvider.providerName, model: "env_default", status: "completed" };
    return {
      result,
      providerName: fallbackProvider.providerName,
      modelName: result.model,
      attempts,
    };
  } catch (error) {
    attempts[attempts.length - 1] = {
      provider: fallbackProvider.providerName,
      model: "env_default",
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
    if (lastError instanceof Error) throw lastError;
    throw error;
  }
}
