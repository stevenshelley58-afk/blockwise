// Shared final-quality clone generation + first-success provider cascade.
// Used for both the initial full-ad clone and later targeted in-place edits.

import { createImageProviderForCandidate } from "./ai-providers.ts";
import { dataUrlToUploadBytes } from "./generated-media.ts";
import type { ImageProviderAdapter, ImageProviderRequest, ImageProviderResponse } from "./providers.ts";
import {
  isRetryableProviderFailure,
  modelCandidateAttempts,
  resolveRuntimeModelProfile,
} from "../operator/prompts/model-profile-runtime.ts";
import {
  executeAdStudioProviderAttempt,
  ProviderRunPersistenceError,
  recordAdStudioProviderRun,
  type ProviderRunAttempt,
} from "../operator/prompts/redact-prompt-run.ts";

const CLONE_MODEL_PROFILE = "image_final" as const;

/** Ordered final-quality providers, each pinned to runtime profile pricing. */
export async function resolveCloneProviders(): Promise<ImageProviderAdapter[]> {
  const profile = await resolveRuntimeModelProfile(CLONE_MODEL_PROFILE);
  return modelCandidateAttempts(profile).map((candidate) => createImageProviderForCandidate(candidate));
}

export type CloneGenerationResult = {
  assetUrl: string;
  model: string;
  provider: string;
  providerAttemptCount: number;
};

export class CloneGenerationError extends Error {
  readonly providerAttemptCount: number;

  constructor(cause: unknown, providerAttemptCount: number) {
    super(cause instanceof Error ? cause.message : "Clone generation is not configured.");
    this.name = "CloneGenerationError";
    this.providerAttemptCount = providerAttemptCount;
    if (cause !== undefined) this.cause = cause;
  }
}

const EXACT_CLONE_SIZES: Record<string, { width: number; height: number }> = {
  "9:16": { width: 864, height: 1536 },
  "4:5": { width: 1024, height: 1280 },
  "1:1": { width: 1024, height: 1024 },
  "1.91:1": { width: 1200, height: 628 },
};

/**
 * Provider-native image canvases do not always match Meta placement ratios.
 * Crop the finished render centrally to the exact requested ratio before it
 * reaches QA, persistence, or the editor, so the ad is never stretched later.
 */
export async function normalizeCloneRenderAspect(
  assetUrl: string,
  aspectRatio: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const target = EXACT_CLONE_SIZES[aspectRatio];
  if (!target) return assetUrl;

  let bytes: Uint8Array;
  if (assetUrl.startsWith("data:image/")) {
    bytes = dataUrlToUploadBytes(assetUrl).bytes;
  } else {
    const response = await fetchImpl(assetUrl);
    if (!response.ok) throw new Error(`Generated image could not be prepared (${response.status}).`);
    bytes = new Uint8Array(await response.arrayBuffer());
  }

  const { default: sharp } = await import("sharp");
  const image = sharp(bytes);
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) throw new Error("Generated image dimensions could not be read.");

  const sourceRatio = metadata.width / metadata.height;
  const targetRatio = target.width / target.height;
  if (Math.abs(sourceRatio - targetRatio) < 0.001) return assetUrl;

  const png = await image
    .resize(target.width, target.height, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

/**
 * Build a same-size inpainting mask for one QA-detected edit region.
 * Transparent pixels are repaintable; every opaque pixel must be preserved.
 */
export async function createCloneRegionEditMask(
  assetUrl: string,
  box?: { x: number; y: number; width: number; height: number },
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  if (!box || box.width <= 0 || box.height <= 0) return undefined;

  let bytes: Uint8Array;
  if (assetUrl.startsWith("data:image/")) {
    bytes = dataUrlToUploadBytes(assetUrl).bytes;
  } else {
    const response = await fetchImpl(assetUrl);
    if (!response.ok) throw new Error(`Creative image could not be prepared for editing (${response.status}).`);
    bytes = new Uint8Array(await response.arrayBuffer());
  }

  const { default: sharp } = await import("sharp");
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Creative image dimensions could not be read for editing.");

  // Give text antialiasing and image edges a small amount of breathing room.
  const paddingX = 0.02;
  const paddingY = 0.02;
  const x = Math.max(0, Math.floor((box.x - paddingX) * metadata.width));
  const y = Math.max(0, Math.floor((box.y - paddingY) * metadata.height));
  const right = Math.min(metadata.width, Math.ceil((box.x + box.width + paddingX) * metadata.width));
  const bottom = Math.min(metadata.height, Math.ceil((box.y + box.height + paddingY) * metadata.height));
  const width = Math.max(1, right - x);
  const height = Math.max(1, bottom - y);
  const svg = Buffer.from(
    `<svg width="${metadata.width}" height="${metadata.height}" xmlns="http://www.w3.org/2000/svg">`
      + '<defs><mask id="edit-region">'
      + '<rect width="100%" height="100%" fill="white"/>'
      + `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="black"/>`
      + "</mask></defs>"
      + '<rect width="100%" height="100%" fill="white" mask="url(#edit-region)"/>'
      + "</svg>",
  );
  const png = await sharp(svg).ensureAlpha().png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

async function cloneImageBytes(assetUrl: string, fetchImpl: typeof fetch): Promise<Uint8Array> {
  if (assetUrl.startsWith("data:image/")) return dataUrlToUploadBytes(assetUrl).bytes;
  const response = await fetchImpl(assetUrl);
  if (!response.ok) throw new Error(`Creative image could not be prepared (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Keep the model's output only inside the selected QA region. This makes
 * Stitch-style edits deterministic: pixels outside the clicked element come
 * from the original finished ad even if the image model tries to redraw them.
 */
export async function compositeCloneRegionEdit(
  originalAssetUrl: string,
  editedAssetUrl: string,
  box?: { x: number; y: number; width: number; height: number },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!box || box.width <= 0 || box.height <= 0) return editedAssetUrl;
  const [originalBytes, editedBytes] = await Promise.all([
    cloneImageBytes(originalAssetUrl, fetchImpl),
    cloneImageBytes(editedAssetUrl, fetchImpl),
  ]);
  const { default: sharp } = await import("sharp");
  const metadata = await sharp(originalBytes).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Creative image dimensions could not be read for editing.");

  const paddingX = 0.02;
  const paddingY = 0.02;
  const left = Math.max(0, Math.floor((box.x - paddingX) * metadata.width));
  const top = Math.max(0, Math.floor((box.y - paddingY) * metadata.height));
  const right = Math.min(metadata.width, Math.ceil((box.x + box.width + paddingX) * metadata.width));
  const bottom = Math.min(metadata.height, Math.ceil((box.y + box.height + paddingY) * metadata.height));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const editedRegion = await sharp(editedBytes)
    .resize(metadata.width, metadata.height, { fit: "fill" })
    .extract({ left, top, width, height })
    .png()
    .toBuffer();
  const composited = await sharp(originalBytes)
    .composite([{ input: editedRegion, left, top }])
    .png()
    .toBuffer();
  return `data:image/png;base64,${composited.toString("base64")}`;
}

export async function generateCloneWithCascade(input: {
  providers: ImageProviderAdapter[];
  request: ImageProviderRequest;
  workspaceId: string;
  userId: string;
  correlationId: string;
  attempt: number;
  accounting?: {
    executeAttempt: typeof executeAdStudioProviderAttempt;
    recordRun: typeof recordAdStudioProviderRun;
  };
}): Promise<CloneGenerationResult> {
  const startedAt = Date.now();
  const mutationId = `${input.correlationId}:adstudio.clone:${input.attempt}:${input.request.aspectRatio}`;
  const attempts: ProviderRunAttempt[] = [];
  const prompt = {
    system: "",
    user: input.request.prompt,
    fullPrompt: input.request.prompt,
    promptVersions: [],
    fallbackPromptUsed: false,
    warnings: [],
  };
  let lastError: unknown = null;
  let providerAttemptCount = 0;
  const accounting = input.accounting ?? {
    executeAttempt: executeAdStudioProviderAttempt,
    recordRun: recordAdStudioProviderRun,
  };

  for (const [attemptIndex, provider] of input.providers.slice(0, 2).entries()) {
    providerAttemptCount += 1;
    let result: ImageProviderResponse | null = null;
    try {
      const execution = await accounting.executeAttempt<ImageProviderResponse>({
        workspaceId: input.workspaceId,
        mutationId,
        attemptIndex,
        modelProfile: CLONE_MODEL_PROFILE,
        provider,
        execute: async () => {
          const result = await provider.generate(input.request);
          if (!result.assetUrl) throw new Error("Provider returned no image.");
          return result;
        },
      });
      attempts.push(execution.attempt);
      if (!execution.ok) {
        lastError = execution.error;
        if (!isRetryableProviderFailure(execution.error)) break;
        continue;
      }
      result = execution.output;
    } catch (error) {
      lastError = error;
      break;
    }
    if (!result) continue;
    // A durable finalization failure is not a provider failure and must never
    // enter the fallback loop or be retried with a different payload.
    await accounting.recordRun({
      workspaceId: input.workspaceId,
      userId: input.userId,
      correlationId: input.correlationId,
      taskType: "adstudio.clone",
      modelProfile: CLONE_MODEL_PROFILE,
      mutationId,
      prompt,
      input: { attempt: input.attempt, aspectRatio: input.request.aspectRatio },
      attempts,
      latencyMs: Date.now() - startedAt,
      providerName: provider.providerName,
      providerType: "image_generation",
      modelName: result.model,
      output: result,
      status: "completed",
    });
    return {
      assetUrl: result.assetUrl,
      model: result.model,
      provider: provider.providerName,
      providerAttemptCount,
    };
  }

  await accounting.recordRun({
    workspaceId: input.workspaceId,
    userId: input.userId,
    correlationId: input.correlationId,
    taskType: "adstudio.clone",
    modelProfile: CLONE_MODEL_PROFILE,
    mutationId,
    prompt,
    input: { attempt: input.attempt, aspectRatio: input.request.aspectRatio },
    attempts,
    latencyMs: Date.now() - startedAt,
    providerName: "unavailable",
    providerType: "image_generation",
    modelName: "unavailable",
    output: null,
    status: "failed",
    error: lastError,
  });
  if (lastError instanceof ProviderRunPersistenceError) throw lastError;
  throw new CloneGenerationError(lastError, providerAttemptCount);
}

/** Persist a data: URL render to workspace storage; passthrough for other refs. */
export async function persistCloneRender(input: {
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
  if (error) throw new Error("Generated image could not be stored.");
  return `/api/adstudio/media?path=${encodeURIComponent(storagePath)}`;
}
