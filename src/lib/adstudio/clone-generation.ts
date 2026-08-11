// Shared final-quality clone generation + first-success provider cascade.
// Used for both the initial full-ad clone and later targeted in-place edits.

import {
  createImageProviderForCandidate,
  type ProviderEnvironment,
} from "./ai-providers.ts";
import { dataUrlToUploadBytes } from "./generated-media.ts";
import type { ImageProviderAdapter, ImageProviderRequest, ImageProviderResponse } from "./providers.ts";
import {
  isProviderFallbackEligible,
  modelCandidateAttempts,
  resolveRuntimeModelProfile,
} from "../operator/prompts/model-profile-runtime.ts";
import {
  executeAdStudioProviderAttempt,
  ProviderRunPersistenceError,
  recordAdStudioProviderRun,
  type ProviderRunAttempt,
} from "../operator/prompts/redact-prompt-run.ts";
import { emitModelFallbackAlert } from "../alerts/model-fallback-alert.ts";

export type AdGenerationQuality = "fast" | "high";

const CLONE_MODEL_PROFILE_BY_QUALITY = {
  fast: "image_draft",
  high: "image_final",
} as const;
type CloneModelProfile = (typeof CLONE_MODEL_PROFILE_BY_QUALITY)[AdGenerationQuality];

export function cloneModelProfileForQuality(quality: AdGenerationQuality): CloneModelProfile {
  return CLONE_MODEL_PROFILE_BY_QUALITY[quality];
}

/** Ordered providers for the customer's quality choice, pinned to runtime pricing. */
export async function resolveCloneProviders(
  quality: AdGenerationQuality = "high",
  providerEnv?: ProviderEnvironment,
): Promise<ImageProviderAdapter[]> {
  const profile = await resolveRuntimeModelProfile(cloneModelProfileForQuality(quality));
  return modelCandidateAttempts(profile, 3).map((candidate) => createImageProviderForCandidate(candidate, { env: providerEnv }));
}

export type CloneGenerationResult = {
  assetUrl: string;
  model: string;
  provider: string;
  providerAttemptCount: number;
  attemptReceipts?: ProviderRunAttempt[];
};

export class CloneGenerationError extends Error {
  readonly providerAttemptCount: number;
  readonly attemptReceipts: ProviderRunAttempt[];

  constructor(cause: unknown, providerAttemptCount: number, attemptReceipts: ProviderRunAttempt[] = []) {
    super(cause instanceof Error ? cause.message : "Ad generation is not configured.");
    this.name = "CloneGenerationError";
    this.providerAttemptCount = providerAttemptCount;
    this.attemptReceipts = attemptReceipts;
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

  // Always return owned image bytes. Providers may return a temporary hosted
  // URL even when its dimensions are already exact; passing that URL through
  // would make the finished ad display today but leave nothing authoritative
  // in workspace storage for reload/export later.
  const png = metadata.width === target.width && metadata.height === target.height
    ? await image.png().toBuffer()
    : await image
      .resize(target.width, target.height, { fit: "cover", position: "centre" })
      .png()
      .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

/**
 * Build a same-size inpainting mask for one or more edit regions on a canvas
 * of known dimensions — no image decode needed. Transparent pixels are
 * repaintable; every opaque pixel must be preserved.
 */
export async function createRegionEditMaskForDimensions(
  dimensions: { width: number; height: number },
  boxes: Array<{ x: number; y: number; width: number; height: number }>,
): Promise<string | undefined> {
  const usable = boxes.filter((box) => box.width > 0 && box.height > 0);
  if (usable.length === 0) return undefined;

  // Give text antialiasing and image edges a small amount of breathing room.
  const paddingX = 0.02;
  const paddingY = 0.02;
  const cutouts = usable.map((box) => {
    const x = Math.max(0, Math.floor((box.x - paddingX) * dimensions.width));
    const y = Math.max(0, Math.floor((box.y - paddingY) * dimensions.height));
    const right = Math.min(dimensions.width, Math.ceil((box.x + box.width + paddingX) * dimensions.width));
    const bottom = Math.min(dimensions.height, Math.ceil((box.y + box.height + paddingY) * dimensions.height));
    const width = Math.max(1, right - x);
    const height = Math.max(1, bottom - y);
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="black"/>`;
  }).join("");
  const svg = Buffer.from(
    `<svg width="${dimensions.width}" height="${dimensions.height}" xmlns="http://www.w3.org/2000/svg">`
      + '<defs><mask id="edit-region">'
      + '<rect width="100%" height="100%" fill="white"/>'
      + cutouts
      + "</mask></defs>"
      + '<rect width="100%" height="100%" fill="white" mask="url(#edit-region)"/>'
      + "</svg>",
  );
  const { default: sharp } = await import("sharp");
  const png = await sharp(svg).ensureAlpha().png({ compressionLevel: 1 }).toBuffer();
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
  return createRegionEditMaskForDimensions({ width: metadata.width, height: metadata.height }, [box]);
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
    .png({ compressionLevel: 1 })
    .toBuffer();
  const composited = await sharp(originalBytes)
    .composite([{ input: editedRegion, left, top }])
    .png({ compressionLevel: 1 })
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
  modelProfile?: CloneModelProfile;
  accounting?: {
    executeAttempt: typeof executeAdStudioProviderAttempt;
    recordRun: typeof recordAdStudioProviderRun;
  };
  fallbackAlert?: typeof emitModelFallbackAlert;
  onAttemptReceipts?: (attempts: readonly ProviderRunAttempt[]) => void;
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
  let fallbackAlertTask: Promise<unknown> | null = null;
  const accounting = input.accounting ?? {
    executeAttempt: executeAdStudioProviderAttempt,
    recordRun: recordAdStudioProviderRun,
  };
  const modelProfile = input.modelProfile ?? "image_final";

  for (const [attemptIndex, provider] of input.providers.slice(0, 3).entries()) {
    providerAttemptCount += 1;
    let result: ImageProviderResponse | null = null;
    try {
      const execution = await accounting.executeAttempt<ImageProviderResponse>({
        workspaceId: input.workspaceId,
        mutationId,
        attemptIndex,
        modelProfile,
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
        if (!isProviderFallbackEligible(execution.error)) break;
        const fallback = input.providers[attemptIndex + 1];
        if (fallback) {
          // Start email before OpenAI so delivery overlaps the fallback render.
          // The promise is joined before returning, preventing a Vercel
          // shutdown from dropping the user's per-fallback notification.
          fallbackAlertTask = (input.fallbackAlert ?? emitModelFallbackAlert)({
            eventId: `${mutationId}:provider:${attemptIndex}`,
            stage: `adstudio.image.${input.request.aspectRatio}`,
            fromModel: provider.accounting?.model ?? provider.providerName,
            toModel: fallback.accounting?.model ?? fallback.providerName,
            reason: fallbackReason(execution.error),
          });
        }
        continue;
      }
      result = execution.output;
    } catch (error) {
      lastError = error;
      break;
    }
    if (!result) continue;
    if (fallbackAlertTask) await fallbackAlertTask;
    // A durable finalization failure is not a provider failure and must never
    // enter the fallback loop or be retried with a different payload.
    input.onAttemptReceipts?.(attempts);
    await accounting.recordRun({
      workspaceId: input.workspaceId,
      userId: input.userId,
      correlationId: input.correlationId,
      taskType: "adstudio.clone",
      modelProfile,
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
      attemptReceipts: attempts,
    };
  }

  if (fallbackAlertTask) await fallbackAlertTask;
  input.onAttemptReceipts?.(attempts);
  await accounting.recordRun({
    workspaceId: input.workspaceId,
    userId: input.userId,
    correlationId: input.correlationId,
    taskType: "adstudio.clone",
    modelProfile,
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
  throw new CloneGenerationError(lastError, providerAttemptCount, attempts);
}

function fallbackReason(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Primary image provider failed.";
}

/** Persist every generated render to workspace storage, including provider-hosted URLs. */
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
  fetchImpl?: typeof fetch;
}): Promise<string> {
  if (!input.assetUrl) throw new Error("Generated image could not be stored (provider returned no asset URL).");
  let decoded: ReturnType<typeof dataUrlToUploadBytes>;
  if (input.assetUrl.startsWith("data:image/")) {
    decoded = dataUrlToUploadBytes(input.assetUrl);
  } else {
    const response = await (input.fetchImpl ?? fetch)(input.assetUrl);
    if (!response.ok) throw new Error(`Generated image could not be stored (fetch failed: HTTP ${response.status}).`);
    const source = new Uint8Array(await response.arrayBuffer());
    const { default: sharp } = await import("sharp");
    const png = await sharp(source).png({ compressionLevel: 1 }).toBuffer();
    decoded = {
      bytes: new Uint8Array(png),
      contentType: "image/png",
      extension: "png",
    };
  }
  const storagePath = `${input.workspaceId}/adstudio/clones/${input.fileNameSeed}.${decoded.extension}`;
  // The upload is the step most exposed to transient infrastructure blips
  // (a ~2MB PUT over the active compute network). A single failed PUT
  // used to kill the whole ad with a swallowed error; retry it a few times and
  // surface the real Supabase message so the next failure is diagnosable.
  const maxUploadAttempts = 3;
  let uploadError: { message: string; statusCode?: string } | null = null;
  for (let attempt = 1; attempt <= maxUploadAttempts; attempt += 1) {
    const { error } = await input.supabase.storage
      .from("workspace-artifacts")
      .upload(storagePath, decoded.bytes, { contentType: decoded.contentType, upsert: false });
    if (!error) {
      return `/api/adstudio/media?path=${encodeURIComponent(storagePath)}`;
    }
    uploadError = error;
    // A duplicate-object error means a previous attempt actually landed; treat
    // it as success rather than burning the remaining retries.
    const duplicate = /already exists|duplicate|23505/i.test(error.message ?? "");
    if (duplicate) {
      return `/api/adstudio/media?path=${encodeURIComponent(storagePath)}`;
    }
    console.error(
      `persistCloneRender upload attempt ${attempt}/${maxUploadAttempts} failed`,
      { storagePath, bytes: decoded.bytes.byteLength, error },
    );
    if (attempt < maxUploadAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw new Error(
    `Generated image could not be stored (${uploadError?.message ?? "unknown storage error"}).`,
  );
}
