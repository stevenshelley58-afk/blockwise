import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { createImageProviderForCandidate, createOpenRouterImageProvider } from "@/lib/adstudio/ai-providers";
import { dataUrlToUploadBytes } from "@/lib/adstudio/generated-media";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import {
  buildTruthPreservingRepairPrompt,
  generateTruthPreservingRepair,
  repairAssetMetadata,
  repairStoragePath,
  validateImageRepairRequest,
  type ImageRepairRequest,
} from "@/lib/adstudio/image-repair";
import type { AdStudioFormat } from "@/lib/adstudio";
import type { ImageProviderRequest } from "@/lib/adstudio/providers";
import { resolveAdStudioImageForModel } from "@/lib/adstudio/resolve-image-for-model";
import { checkRateLimit } from "@/lib/rate-limit";
import { modelCandidateAttempts, resolveRuntimeModelProfile } from "@/lib/operator/prompts/model-profile-runtime";
import { assembleImagePrompt } from "@/lib/operator/prompts/assemble-prompt";
import { getActivePromptBundle, type PromptKey } from "@/lib/operator/prompts/prompt-registry";
import { recordAdStudioProviderRun } from "@/lib/operator/prompts/redact-prompt-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
    { windowSeconds: 3600, maxRequests: 12, bucket: "ai-repair-image" },
  );
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  let body: ReturnType<typeof validateImageRepairRequest>;
  try {
    body = validateImageRepairRequest(await readJsonBody<ImageRepairRequest>(request));
  } catch (error) {
    return errorResponse(error, 400);
  }

  if (!body.brandKitId) {
    return NextResponse.json({ error: "brandKitId is required." }, { status: 400 });
  }
  if (!(await brandKitExists(context.supabase, context.access.workspaceId, body.brandKitId))) {
    return NextResponse.json({ error: "Brand kit not found." }, { status: 404 });
  }

  const sourceImageForModel = await resolveAdStudioImageForModel(
    context.supabase,
    context.access.workspaceId,
    body.sourceImage,
  );
  if (!sourceImageForModel) {
    return NextResponse.json({ error: "Source image could not be read for auto fit." }, { status: 400 });
  }

  const bundle = await getActivePromptBundle(IMAGE_PROMPT_KEYS);
  const providers = await buildRepairProviders();
  const correlationId = randomUUID();
  const startedAt = Date.now();
  const repairs = [];

  for (const format of body.targetFormats) {
    const prompt = buildTruthPreservingRepairPrompt({
      format,
      campaignContext: body.campaignContext,
      layoutBrief: body.layoutBriefs[format],
    });
    const assembled = assembleImagePrompt({
      bundle,
      prompt,
      aspectRatio: format,
      stylePreset: "truth_preserving_real_estate_repair",
      referenceAssets: [sourceImageForModel],
    });
    const imageInput: ImageProviderRequest = {
      prompt: assembled.fullPrompt,
      negativePrompt: bundle["adstudio.image.negative_prompt"].body,
      referenceAssets: [sourceImageForModel],
      aspectRatio: format,
      stylePreset: "truth_preserving_real_estate_repair",
      requiresReferenceAssets: true,
    };

    try {
      const generation = await generateTruthPreservingRepair({ imageInput, providers });
      const stored = await persistRepairedImage({
        supabase: context.supabase,
        workspaceId: context.access.workspaceId,
        brandKitId: body.brandKitId,
        sourceImage: body.sourceImage,
        format,
        assetUrl: generation.result.assetUrl,
        model: generation.modelName,
        provider: generation.providerName,
        fileNameSeed: `${correlationId}-${format.replace(/[^0-9a-z]+/gi, "x")}`,
      });

      await recordAdStudioProviderRun({
        workspaceId: context.access.workspaceId,
        userId: context.access.userId,
        correlationId,
        taskType: "adstudio.image",
        modelProfile: "image_final",
        prompt: assembled,
        input: {
          sourceImage: body.sourceImage,
          targetFormat: format,
          campaignContext: body.campaignContext,
          layoutBrief: body.layoutBriefs[format],
        },
        attempts: generation.attempts,
        latencyMs: Date.now() - startedAt,
        providerName: generation.providerName,
        providerType: "image_generation",
        modelName: generation.modelName,
        output: generation.result,
        status: "completed",
      });

      repairs.push({
        format,
        image: stored,
        model: generation.modelName,
        provider: generation.providerName,
      });
    } catch (error) {
      await recordAdStudioProviderRun({
        workspaceId: context.access.workspaceId,
        userId: context.access.userId,
        correlationId,
        taskType: "adstudio.image",
        modelProfile: "image_final",
        prompt: assembled,
        input: {
          sourceImage: body.sourceImage,
          targetFormat: format,
          campaignContext: body.campaignContext,
          layoutBrief: body.layoutBriefs[format],
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
      return errorResponse(error, 502);
    }
  }

  return NextResponse.json({ repairs });
}

async function buildRepairProviders() {
  const profile = await resolveRuntimeModelProfile("image_final");
  return [
    ...modelCandidateAttempts(profile).map((candidate) => createImageProviderForCandidate(candidate)),
    createOpenRouterImageProvider(),
  ];
}

async function persistRepairedImage(input: {
  supabase: any;
  workspaceId: string;
  brandKitId: string;
  sourceImage: string;
  format: AdStudioFormat;
  assetUrl: string;
  model: string;
  provider: string;
  fileNameSeed: string;
}): Promise<string> {
  if (!input.assetUrl) throw new Error("Repaired image was empty.");

  let storedUrl = input.assetUrl;
  let storagePath: string | null = null;
  let contentType: string | null = null;

  if (input.assetUrl.startsWith("data:image/")) {
    const decoded = dataUrlToUploadBytes(input.assetUrl);
    contentType = decoded.contentType;
    storagePath = repairStoragePath({
      workspaceId: input.workspaceId,
      seed: input.fileNameSeed,
      format: input.format,
      extension: decoded.extension,
    });
    const { error } = await input.supabase.storage
      .from("workspace-artifacts")
      .upload(storagePath, decoded.bytes, { contentType: decoded.contentType, upsert: false });
    if (error) throw new Error("Repaired image could not be stored.");
    storedUrl = `/api/adstudio/media?path=${encodeURIComponent(storagePath)}`;
  }

  const { error } = await input.supabase.from("adstudio_brand_assets").insert({
    workspace_id: input.workspaceId,
    brand_kit_id: input.brandKitId,
    asset_type: "listing_image",
    source_url: storedUrl.startsWith("/api/adstudio/media?") ? undefined : storedUrl,
    storage_path: storagePath,
    metadata_json: repairAssetMetadata({
      sourceImage: input.sourceImage,
      targetFormat: input.format,
      model: input.model,
      provider: input.provider,
      contentType,
    }),
  });
  if (error) throw new Error(error.message);

  return storedUrl;
}

async function brandKitExists(supabase: any, workspaceId: string, brandKitId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("adstudio_brand_kits")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("id", brandKitId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Boolean(data);
}
