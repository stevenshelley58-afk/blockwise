import { createHash, randomUUID } from "node:crypto";

import type { ModelCandidate } from "../ai/model-registry.ts";
import { assemblePhotoPrepPrompt } from "../operator/prompts/assemble-prompt.ts";
import { modelCandidateAttempts, resolveRuntimeModelProfile } from "../operator/prompts/model-profile-runtime.ts";
import { getActivePromptBundle, type PromptKey } from "../operator/prompts/prompt-registry.ts";
import { recordAdStudioProviderRun } from "../operator/prompts/redact-prompt-run.ts";
import { createSupabaseServiceClient } from "../supabase/service.ts";

import { createImageProviderForCandidate, createOpenRouterImageProvider } from "./ai-providers.ts";
import { mediaUrlForStoragePath } from "./assets.ts";
import { dataUrlToUploadBytes } from "./generated-media.ts";
import {
  buildPhotoPrepCacheKey,
  buildTemplateRenderFrame,
  type PhotoPrepContext,
  type PreparedPhotoAsset,
} from "./photo-prep.ts";
import type { ImageProviderAdapter, ImageProviderRequest, ImageProviderResponse } from "./providers.ts";
import type { AdStudioTemplate } from "./templates.ts";
import type { AdStudioBrandKit, AdStudioFormat, AdStudioGoal } from "./types.ts";

const PHOTO_PREP_PROMPT_KEYS: PromptKey[] = [
  "adstudio.image.system",
  "adstudio.image.prepare_template_frame.v1",
  "adstudio.image.brand_rules",
  "adstudio.image.negative_prompt",
];

type SupabaseLike = {
  from(table: string): any;
  storage: {
    from(bucket: string): any;
  };
};

type ImageGenerationResult = {
  result: ImageProviderResponse;
  providerName: string;
  modelName: string;
  attempts: Array<{ provider: string; model: string; status: "attempted" | "failed" | "completed"; error?: string }>;
};

type PhotoPrepAssetRow = {
  source_url?: string | null;
  storage_path?: string | null;
  width_px?: number | null;
  height_px?: number | null;
  method?: PreparedPhotoAsset["method"] | null;
  template_key?: string | null;
  template_version?: number | null;
  frame_id?: string | null;
  format?: AdStudioFormat | null;
  qa_status?: PreparedPhotoAsset["qaStatus"] | null;
  prompt_version_id?: string | null;
  model_profile_key?: string | null;
  model_name?: string | null;
  provider_name?: string | null;
};

export type PreparedPhotoAssetsByFormat = Partial<Record<AdStudioFormat, PreparedPhotoAsset>>;

export async function preparePhotoAssetsForTemplate(input: {
  workspaceId: string;
  userId: string | null;
  brandKit: AdStudioBrandKit;
  template: AdStudioTemplate;
  formats: AdStudioFormat[];
  sourceImageRef: string;
  sourceImageForModel: string;
  campaign: {
    goal?: AdStudioGoal | string;
    offerId?: string;
    market?: { suburb?: string; city?: string; state?: string };
    propertyType?: string;
  };
  brief?: string;
  supabase?: SupabaseLike;
  providers?: ImageProviderAdapter[];
}): Promise<PreparedPhotoAssetsByFormat> {
  if (!input.sourceImageForModel) {
    throw new Error("Source image could not be read for template photo preparation.");
  }

  const supabase = input.supabase ?? createSupabaseServiceClient();
  const bundle = await getActivePromptBundle(PHOTO_PREP_PROMPT_KEYS);
  const promptVersion = bundle["adstudio.image.prepare_template_frame.v1"]?.version;
  const promptVersionId = bundle["adstudio.image.prepare_template_frame.v1"]?.id ?? null;
  const sourceImageHash = hashSourceImage(input.sourceImageForModel);
  const formats = Array.from(new Set(input.formats));
  const prepared = await Promise.all(
    formats.map(async (format) => {
      const context: PhotoPrepContext = {
        workspaceId: input.workspaceId,
        imageHash: sourceImageHash,
        sourceImageRef: input.sourceImageRef,
        template: {
          key: input.template.templateKey ?? input.template.id,
          version: input.template.creativeSkeleton?.version ?? 1,
          name: input.template.name,
          archetype: input.template.creativeSkeleton?.archetype,
        },
        frame: buildTemplateRenderFrame({ template: input.template, format }),
        imageSlotId: "primary_photo",
        campaign: input.campaign,
        brand: {
          palette: [
            input.brandKit.colours.primary,
            input.brandKit.colours.secondary,
            input.brandKit.colours.accent,
            input.brandKit.colours.background,
            input.brandKit.colours.text,
          ].filter(Boolean),
          imageTreatment: input.brandKit.visualStyle.imageTreatment,
          voice: input.brandKit.tone.voice,
        },
        brief: input.brief,
        promptVersion,
      };

      const asset = await prepareOnePhotoAsset({
        supabase,
        context,
        sourceImageForModel: input.sourceImageForModel,
        userId: input.userId,
        brandKitId: input.brandKit.brandKitId,
        bundle,
        promptVersionId,
        providers: input.providers,
      });

      return [format, asset] as const;
    }),
  );

  return Object.fromEntries(prepared);
}

export function preparedPhotoUrlsByFormat(assets: PreparedPhotoAssetsByFormat): Partial<Record<AdStudioFormat, string>> {
  return Object.fromEntries(
    Object.entries(assets).map(([format, asset]) => [format, asset?.assetUrl]).filter((entry): entry is [string, string] => Boolean(entry[1])),
  ) as Partial<Record<AdStudioFormat, string>>;
}

async function prepareOnePhotoAsset(input: {
  supabase: SupabaseLike;
  context: PhotoPrepContext;
  sourceImageForModel: string;
  userId: string | null;
  brandKitId: string;
  bundle: Awaited<ReturnType<typeof getActivePromptBundle>>;
  promptVersionId: string | null;
  providers?: ImageProviderAdapter[];
}): Promise<PreparedPhotoAsset> {
  const cacheKey = buildPhotoPrepCacheKey(input.context);
  const cached = await loadCachedPhotoPrepAsset(input.supabase, input.context.workspaceId, cacheKey);
  if (cached) return cached;

  const assembled = assemblePhotoPrepPrompt({ bundle: input.bundle, context: input.context });
  const imageInput: ImageProviderRequest = {
    prompt: assembled.fullPrompt,
    negativePrompt: input.bundle["adstudio.image.negative_prompt"]?.body,
    referenceAssets: [input.sourceImageForModel],
    aspectRatio: input.context.frame.format,
    stylePreset: "locked_template_photo_prep",
    requiresReferenceAssets: true,
  };
  const correlationId = randomUUID();
  const startedAt = Date.now();

  try {
    const generation = await generatePhotoPrepImage(imageInput, input.providers);
    if (!generation.result.assetUrl) {
      throw new Error("Template photo preparation returned an empty image.");
    }

    const stored = await persistPreparedPhotoAsset({
      supabase: input.supabase,
      context: input.context,
      cacheKey,
      brandKitId: input.brandKitId,
      sourceImageHash: input.context.imageHash,
      sourceImageRef: input.context.sourceImageRef,
      assetUrl: generation.result.assetUrl,
      promptVersionId: input.promptVersionId,
      providerName: generation.providerName,
      modelName: generation.modelName,
      metadata: {
        providerMetadata: generation.result.providerMetadata,
        promptWarnings: assembled.warnings,
      },
    });

    await recordAdStudioProviderRun({
      workspaceId: input.context.workspaceId,
      userId: input.userId,
      correlationId,
      taskType: "adstudio.image",
      modelProfile: "image_final",
      prompt: assembled,
      input: {
        sourceImage: input.context.sourceImageRef,
        templateKey: input.context.template.key,
        templateVersion: input.context.template.version,
        frameId: input.context.imageSlotId,
        format: input.context.frame.format,
        campaign: input.context.campaign,
      },
      attempts: generation.attempts,
      latencyMs: Date.now() - startedAt,
      providerName: generation.providerName,
      providerType: "image_generation",
      modelName: generation.modelName,
      output: generation.result,
      status: "completed",
    });

    return stored;
  } catch (error) {
    await recordAdStudioProviderRun({
      workspaceId: input.context.workspaceId,
      userId: input.userId,
      correlationId,
      taskType: "adstudio.image",
      modelProfile: "image_final",
      prompt: assembled,
      input: {
        sourceImage: input.context.sourceImageRef,
        templateKey: input.context.template.key,
        templateVersion: input.context.template.version,
        frameId: input.context.imageSlotId,
        format: input.context.frame.format,
        campaign: input.context.campaign,
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
    throw error;
  }
}

async function loadCachedPhotoPrepAsset(
  supabase: SupabaseLike,
  workspaceId: string,
  cacheKey: string,
): Promise<PreparedPhotoAsset | null> {
  const { data, error } = await supabase
    .from("adstudio_photo_prep_assets")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("cache_key", cacheKey)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as PhotoPrepAssetRow;
  const assetUrl = row.source_url ?? mediaUrlForStoragePath(workspaceId, row.storage_path);
  if (!assetUrl || !row.template_key || !row.template_version || !row.frame_id || !row.format) return null;

  return {
    assetUrl,
    widthPx: row.width_px ?? 0,
    heightPx: row.height_px ?? 0,
    method: row.method ?? "model_reframe",
    templateKey: row.template_key,
    templateVersion: row.template_version,
    frameId: row.frame_id,
    format: row.format,
    qaStatus: row.qa_status ?? "pending",
  };
}

async function persistPreparedPhotoAsset(input: {
  supabase: SupabaseLike;
  context: PhotoPrepContext;
  cacheKey: string;
  brandKitId: string;
  sourceImageHash: string;
  sourceImageRef: string;
  assetUrl: string;
  promptVersionId: string | null;
  providerName: string;
  modelName: string;
  metadata: Record<string, unknown>;
}): Promise<PreparedPhotoAsset> {
  const stored = await storePreparedImage(input.supabase, input.context.workspaceId, input.cacheKey, input.assetUrl);
  const row = {
    workspace_id: input.context.workspaceId,
    brand_kit_id: input.brandKitId,
    source_image_hash: input.sourceImageHash,
    source_image_ref: input.sourceImageRef,
    template_key: input.context.template.key,
    template_version: input.context.template.version,
    frame_id: input.context.imageSlotId,
    format: input.context.frame.format,
    cache_key: input.cacheKey,
    method: "model_reframe",
    storage_path: stored.storagePath,
    source_url: stored.sourceUrl,
    width_px: input.context.frame.canvas.widthPx,
    height_px: input.context.frame.canvas.heightPx,
    prompt_version_id: input.promptVersionId,
    model_profile_key: "image_final",
    model_name: input.modelName,
    provider_name: input.providerName,
    qa_status: "pending",
    metadata_json: input.metadata,
  };
  const { error } = await input.supabase
    .from("adstudio_photo_prep_assets")
    .upsert(row, { onConflict: "workspace_id,cache_key" });

  if (error) throw new Error(error.message);

  return {
    assetUrl: stored.publicUrl,
    widthPx: input.context.frame.canvas.widthPx,
    heightPx: input.context.frame.canvas.heightPx,
    method: "model_reframe",
    templateKey: input.context.template.key,
    templateVersion: input.context.template.version,
    frameId: input.context.imageSlotId,
    format: input.context.frame.format,
    promptVersion: input.context.promptVersion,
    modelProfileVersion: input.context.modelProfileVersion,
    qaStatus: "pending",
  };
}

async function storePreparedImage(
  supabase: SupabaseLike,
  workspaceId: string,
  cacheKey: string,
  assetUrl: string,
): Promise<{ publicUrl: string; storagePath: string | null; sourceUrl: string | null }> {
  if (!assetUrl.startsWith("data:image/")) {
    return {
      publicUrl: assetUrl,
      storagePath: assetUrl.startsWith("/api/adstudio/media?") ? mediaProxyPath(assetUrl) : null,
      sourceUrl: assetUrl.startsWith("/api/adstudio/media?") ? null : assetUrl,
    };
  }

  const decoded = dataUrlToUploadBytes(assetUrl);
  const storagePath = `${workspaceId}/adstudio/photo-prep/${hashShort(cacheKey)}.${decoded.extension}`;
  const { error } = await supabase.storage
    .from("workspace-artifacts")
    .upload(storagePath, decoded.bytes, { contentType: decoded.contentType, upsert: true });
  if (error) throw new Error("Prepared template photo could not be stored.");

  const publicUrl = mediaUrlForStoragePath(workspaceId, storagePath);
  if (!publicUrl) throw new Error("Prepared template photo storage path was invalid.");

  return { publicUrl, storagePath, sourceUrl: null };
}

async function generatePhotoPrepImage(
  input: ImageProviderRequest,
  injectedProviders?: ImageProviderAdapter[],
): Promise<ImageGenerationResult> {
  const providers = injectedProviders ?? await buildPhotoPrepProviders();
  const attempts: ImageGenerationResult["attempts"] = [];
  let lastError: unknown = null;

  for (const provider of providers) {
    const model = providerModelName(provider);
    attempts.push({ provider: provider.providerName, model, status: "attempted" });

    try {
      const result = await provider.generate(input);
      attempts[attempts.length - 1] = { provider: provider.providerName, model: result.model || model, status: "completed" };
      return {
        result,
        providerName: provider.providerName,
        modelName: result.model || model,
        attempts,
      };
    } catch (error) {
      lastError = error;
      attempts[attempts.length - 1] = {
        provider: provider.providerName,
        model,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error("No image provider was available for template photo preparation.");
}

async function buildPhotoPrepProviders(): Promise<ImageProviderAdapter[]> {
  const profile = await resolveRuntimeModelProfile("image_final");
  return [
    ...orderReferenceCandidates(modelCandidateAttempts(profile)).map((candidate) => createImageProviderForCandidate(candidate)),
    createOpenRouterImageProvider(),
  ];
}

function orderReferenceCandidates(candidates: ModelCandidate[]): ModelCandidate[] {
  const rank = (provider: string) => (provider === "openrouter" ? 0 : 1);
  return [...candidates].sort((a, b) => rank(a.provider) - rank(b.provider));
}

function providerModelName(provider: ImageProviderAdapter): string {
  return provider.providerName === "openrouter" ? "profile_openrouter" : "profile_openai";
}

function mediaProxyPath(ref: string): string | null {
  if (!ref.startsWith("/api/adstudio/media?")) return null;
  const query = ref.split("?")[1] ?? "";
  return new URLSearchParams(query).get("path")?.trim() || null;
}

function hashSourceImage(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function hashShort(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}
