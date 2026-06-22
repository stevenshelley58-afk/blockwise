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
import { imageDimensionsFromDataUrl } from "./image-dimensions.ts";
import {
  buildPhotoPrepCacheKey,
  buildTemplateRenderFrame,
  deterministicPreparedPhotoAsset,
  selectPhotoPrepMethod,
  type PhotoPrepContext,
  type PhotoPrepDecisionMethod,
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
const DEFAULT_PHOTO_PREP_TIMEOUT_MS = 25_000;

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

export type PreparedPhotoAssetsByFormat = Partial<Record<AdStudioFormat, Record<string, PreparedPhotoAsset>>>;

export type TemplatePhotoPrepSourceImage = {
  sourceImageRef: string;
  sourceImageForModel: string;
};

export type TemplatePhotoPrepInput = {
  workspaceId: string;
  userId: string | null;
  brandKit: AdStudioBrandKit;
  template: AdStudioTemplate;
  formats: AdStudioFormat[];
  sourceImageRef: string;
  sourceImageForModel: string;
  sourceImagesBySlot?: Record<string, TemplatePhotoPrepSourceImage>;
  campaign: {
    goal?: AdStudioGoal | string;
    offerId?: string;
    market?: { suburb?: string; city?: string; state?: string };
    propertyType?: string;
  };
  brief?: string;
  supabase?: SupabaseLike;
  providers?: ImageProviderAdapter[];
  timeoutMs?: number;
};

type PhotoPrepWork = {
  supabase: SupabaseLike;
  bundle: Awaited<ReturnType<typeof getActivePromptBundle>>;
  promptVersionId: string | null;
  entries: Array<{ format: AdStudioFormat; slotId: string; context: PhotoPrepContext; sourceImageForModel: string }>;
};

export async function preparePhotoAssetsForTemplate(input: TemplatePhotoPrepInput): Promise<PreparedPhotoAssetsByFormat> {
  if (!input.sourceImageForModel) {
    throw new Error("Source image could not be read for template photo preparation.");
  }

  const work = await buildPhotoPrepWork(input);
  const prepared = await Promise.all(
    work.entries.map(async ({ format, slotId, context, sourceImageForModel }) => {
      const asset = await prepareOnePhotoAsset({
        supabase: work.supabase,
        context,
        sourceImageForModel,
        userId: input.userId,
        brandKitId: input.brandKit.brandKitId,
        bundle: work.bundle,
        promptVersionId: work.promptVersionId,
        providers: input.providers,
        timeoutMs: input.timeoutMs ?? DEFAULT_PHOTO_PREP_TIMEOUT_MS,
      });

      return { format, slotId, asset };
    }),
  );

  return groupPreparedPhotoAssets(prepared);
}

export async function loadCachedPhotoAssetsForTemplate(input: TemplatePhotoPrepInput): Promise<PreparedPhotoAssetsByFormat> {
  if (!input.sourceImageForModel) return {};

  const work = await buildPhotoPrepWork(input);
  const cached = await Promise.all(
    work.entries.map(async ({ format, slotId, context }) => {
      const cacheKey = buildPhotoPrepCacheKey(context);
      const asset = await loadCachedPhotoPrepAsset(work.supabase, context.workspaceId, cacheKey);
      return { format, slotId, asset };
    }),
  );

  return groupPreparedPhotoAssets(cached.filter((entry): entry is { format: AdStudioFormat; slotId: string; asset: PreparedPhotoAsset } => Boolean(entry.asset)));
}

export function fallbackPhotoAssetsForTemplate(input: TemplatePhotoPrepInput): PreparedPhotoAssetsByFormat {
  if (!input.sourceImageForModel) return {};

  return groupPreparedPhotoAssets(
    buildPhotoPrepContextEntries(input).map(({ format, slotId, context, sourceImageForModel }) => ({
      format,
      slotId,
      asset: deterministicPreparedPhotoAsset({
        context,
        assetUrl: sourceImageForModel,
        method: "fallback_smart_crop",
      }),
    })),
  );
}

export function preparedPhotoUrlsByFormat(assets: PreparedPhotoAssetsByFormat): Partial<Record<AdStudioFormat, string>> {
  return Object.fromEntries(
    Object.entries(assets)
      .map(([format, slotAssets]) => [format, primaryPreparedPhotoAsset(slotAssets)?.assetUrl])
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  ) as Partial<Record<AdStudioFormat, string>>;
}

export function preparedPhotoUrlsByFormatAndSlot(
  assets: PreparedPhotoAssetsByFormat,
): Partial<Record<AdStudioFormat, Record<string, string>>> {
  return Object.fromEntries(
    Object.entries(assets)
      .map(([format, slotAssets]) => [
        format,
        Object.fromEntries(Object.entries(slotAssets ?? {}).map(([slotId, asset]) => [slotId, asset.assetUrl])),
      ])
      .filter((entry): entry is [AdStudioFormat, Record<string, string>] => Object.keys(entry[1]).length > 0),
  ) as Partial<Record<AdStudioFormat, Record<string, string>>>;
}

function groupPreparedPhotoAssets(
  entries: Array<{ format: AdStudioFormat; slotId: string; asset: PreparedPhotoAsset }>,
): PreparedPhotoAssetsByFormat {
  const grouped: PreparedPhotoAssetsByFormat = {};
  for (const entry of entries) {
    grouped[entry.format] = {
      ...(grouped[entry.format] ?? {}),
      [entry.slotId]: entry.asset,
    };
  }
  return grouped;
}

function primaryPreparedPhotoAsset(slotAssets: Record<string, PreparedPhotoAsset> | undefined): PreparedPhotoAsset | undefined {
  if (!slotAssets) return undefined;
  return slotAssets.primary_photo ?? slotAssets.primary ?? Object.values(slotAssets)[0];
}

function sourceImageForSlot(
  input: TemplatePhotoPrepInput,
  slotId: string,
  role: string,
): TemplatePhotoPrepSourceImage | null {
  const slotSource = input.sourceImagesBySlot?.[slotId] ?? input.sourceImagesBySlot?.[role];
  if (slotSource?.sourceImageForModel) return slotSource;

  if (role === "agent_headshot") {
    const headshot = input.brandKit.assets.headshots[0];
    if (headshot) return { sourceImageRef: headshot, sourceImageForModel: headshot };
  }

  if (!input.sourceImageForModel) return null;
  return {
    sourceImageRef: input.sourceImageRef,
    sourceImageForModel: input.sourceImageForModel,
  };
}

async function buildPhotoPrepWork(input: TemplatePhotoPrepInput): Promise<PhotoPrepWork> {
  const supabase = input.supabase ?? createSupabaseServiceClient();
  const bundle = await getActivePromptBundle(PHOTO_PREP_PROMPT_KEYS);
  const promptVersion = bundle["adstudio.image.prepare_template_frame.v1"]?.version;
  return {
    supabase,
    bundle,
    promptVersionId: bundle["adstudio.image.prepare_template_frame.v1"]?.id ?? null,
    entries: buildPhotoPrepContextEntries(input, promptVersion),
  };
}

function buildPhotoPrepContextEntries(
  input: TemplatePhotoPrepInput,
  promptVersion?: number,
): Array<{ format: AdStudioFormat; slotId: string; context: PhotoPrepContext; sourceImageForModel: string }> {
  const formats = Array.from(new Set(input.formats));

  return formats.flatMap((format) => {
    const frame = buildTemplateRenderFrame({ template: input.template, format });
    return frame.imageSlots.flatMap((slot) => {
      const source = sourceImageForSlot(input, slot.id, slot.role);
      if (!source?.sourceImageForModel) return [];
      const sourceDimensions = imageDimensionsFromDataUrl(source.sourceImageForModel);

      return [{
        format,
        slotId: slot.id,
        sourceImageForModel: source.sourceImageForModel,
        context: {
          workspaceId: input.workspaceId,
          imageHash: hashSourceImage(source.sourceImageForModel),
          sourceImageRef: source.sourceImageRef,
          sourceImage: sourceDimensions
            ? { naturalWidth: sourceDimensions.width, naturalHeight: sourceDimensions.height }
            : undefined,
          template: {
            key: input.template.templateKey ?? input.template.id,
            version: input.template.creativeSkeleton?.version ?? 1,
            name: input.template.name,
            archetype: input.template.creativeSkeleton?.archetype,
          },
          frame,
          imageSlotId: slot.id,
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
        },
      }];
    });
  });
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
  timeoutMs: number;
}): Promise<PreparedPhotoAsset> {
  const cacheKey = buildPhotoPrepCacheKey(input.context);
  const cached = await loadCachedPhotoPrepAsset(input.supabase, input.context.workspaceId, cacheKey);
  if (cached) return cached;

  // The chokepoint decides the method. When the source already fits the slot a
  // deterministic slice-crop is faithful and free, so skip the paid model call.
  const method = selectPhotoPrepMethod(input.context);
  if (method === "deterministic_smart_crop") {
    return deterministicPreparedPhotoAsset({
      context: input.context,
      assetUrl: input.sourceImageForModel,
      method: "deterministic_smart_crop",
    });
  }

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
  const abortController = new AbortController();
  const timedImageInput: ImageProviderRequest = {
    ...imageInput,
    signal: abortController.signal,
  };

  try {
    const generation = await withPhotoPrepTimeout(
      generatePhotoPrepImage(timedImageInput, input.providers),
      input.timeoutMs,
      abortController,
    );
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
      method,
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
    const fallback = deterministicPreparedPhotoAsset({
      context: input.context,
      assetUrl: input.sourceImageForModel,
      method: "fallback_smart_crop",
    });
    console.warn(JSON.stringify({
      level: "warning",
      msg: "adstudio_photo_prep_fallback",
      workspaceId: input.context.workspaceId,
      templateKey: input.context.template.key,
      format: input.context.frame.format,
      timeoutMs: input.timeoutMs,
      error: error instanceof Error ? error.message : String(error),
    }));
    return fallback;
  }
}

async function withPhotoPrepTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  abortController: AbortController,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`Template photo preparation exceeded ${timeoutMs}ms.`);
          abortController.abort(error);
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
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
  method: PhotoPrepDecisionMethod;
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
    method: input.method,
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
    method: input.method,
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
