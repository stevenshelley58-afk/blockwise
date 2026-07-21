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
export async function resolveCloneProviders(quality: AdGenerationQuality = "high"): Promise<ImageProviderAdapter[]> {
  const profile = await resolveRuntimeModelProfile(cloneModelProfileForQuality(quality));
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
    super(cause instanceof Error ? cause.message : "Ad generation is not configured.");
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

export type CloneEditRegionBox = { x: number; y: number; width: number; height: number };

// Give text antialiasing and image edges a small amount of breathing room.
const EDIT_REGION_PADDING = 0.02;

function usableBoxes(boxes: Array<CloneEditRegionBox | undefined>): CloneEditRegionBox[] {
  return boxes.filter((box): box is CloneEditRegionBox => Boolean(box && box.width > 0 && box.height > 0));
}

function pixelRect(
  box: CloneEditRegionBox,
  imageWidth: number,
  imageHeight: number,
): { left: number; top: number; width: number; height: number } {
  const left = Math.max(0, Math.floor((box.x - EDIT_REGION_PADDING) * imageWidth));
  const top = Math.max(0, Math.floor((box.y - EDIT_REGION_PADDING) * imageHeight));
  const right = Math.min(imageWidth, Math.ceil((box.x + box.width + EDIT_REGION_PADDING) * imageWidth));
  const bottom = Math.min(imageHeight, Math.ceil((box.y + box.height + EDIT_REGION_PADDING) * imageHeight));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/**
 * Build a same-size inpainting mask for one or more QA-detected edit regions.
 * Transparent pixels are repaintable; every opaque pixel must be preserved.
 */
export async function createCloneRegionsEditMask(
  assetUrl: string,
  boxes: Array<CloneEditRegionBox | undefined>,
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  const targets = usableBoxes(boxes);
  if (targets.length === 0) return undefined;

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

  const rects = targets
    .map((box) => pixelRect(box, metadata.width!, metadata.height!))
    .map((rect) => `<rect x="${rect.left}" y="${rect.top}" width="${rect.width}" height="${rect.height}" fill="black"/>`)
    .join("");
  const svg = Buffer.from(
    `<svg width="${metadata.width}" height="${metadata.height}" xmlns="http://www.w3.org/2000/svg">`
      + '<defs><mask id="edit-region">'
      + '<rect width="100%" height="100%" fill="white"/>'
      + rects
      + "</mask></defs>"
      + '<rect width="100%" height="100%" fill="white" mask="url(#edit-region)"/>'
      + "</svg>",
  );
  const png = await sharp(svg).ensureAlpha().png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

/**
 * Build a same-size inpainting mask for one QA-detected edit region.
 * Transparent pixels are repaintable; every opaque pixel must be preserved.
 */
export async function createCloneRegionEditMask(
  assetUrl: string,
  box?: CloneEditRegionBox,
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  return createCloneRegionsEditMask(assetUrl, [box], fetchImpl);
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
export async function compositeCloneRegionsEdit(
  originalAssetUrl: string,
  editedAssetUrl: string,
  boxes: Array<CloneEditRegionBox | undefined>,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const targets = usableBoxes(boxes);
  if (targets.length === 0) return editedAssetUrl;
  const [originalBytes, editedBytes] = await Promise.all([
    cloneImageBytes(originalAssetUrl, fetchImpl),
    cloneImageBytes(editedAssetUrl, fetchImpl),
  ]);
  const { default: sharp } = await import("sharp");
  const metadata = await sharp(originalBytes).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Creative image dimensions could not be read for editing.");

  const editedFull = await sharp(editedBytes)
    .resize(metadata.width, metadata.height, { fit: "fill" })
    .png()
    .toBuffer();
  const patches = await Promise.all(
    targets.map(async (box) => {
      const rect = pixelRect(box, metadata.width!, metadata.height!);
      const input = await sharp(editedFull)
        .extract({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
        .png()
        .toBuffer();
      return { input, left: rect.left, top: rect.top };
    }),
  );
  const composited = await sharp(originalBytes)
    .composite(patches)
    .png()
    .toBuffer();
  return `data:image/png;base64,${composited.toString("base64")}`;
}

export async function compositeCloneRegionEdit(
  originalAssetUrl: string,
  editedAssetUrl: string,
  box?: CloneEditRegionBox,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  return compositeCloneRegionsEdit(originalAssetUrl, editedAssetUrl, [box], fetchImpl);
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapExactText(value: string, maxCharacters: number): string[] {
  const words = value.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && candidate.length > maxCharacters) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Text generation can occasionally omit a word even after a guided retry.
 * Once the image model has supplied the visual treatment, this finalizer
 * clears only the selected text region and typesets the customer's exact copy
 * into it. The clone remains a flat finished ad; no edit layers exist before
 * generation and no pixels outside the selected post-clone region can change.
 */
export async function renderExactCloneTextEdit(
  editedAssetUrl: string,
  value: string,
  box?: { x: number; y: number; width: number; height: number },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const exactValue = value.trim();
  if (!exactValue || !box || box.width <= 0 || box.height <= 0) return editedAssetUrl;

  const bytes = await cloneImageBytes(editedAssetUrl, fetchImpl);
  const { default: sharp } = await import("sharp");
  const source = sharp(bytes);
  const metadata = await source.metadata();
  if (!metadata.width || !metadata.height) throw new Error("Creative image dimensions could not be read for text editing.");

  const left = Math.max(0, Math.floor(box.x * metadata.width));
  const top = Math.max(0, Math.floor(box.y * metadata.height));
  const right = Math.min(metadata.width, Math.ceil((box.x + box.width) * metadata.width));
  const bottom = Math.min(metadata.height, Math.ceil((box.y + box.height) * metadata.height));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const region = await sharp(bytes).extract({ left, top, width, height }).ensureAlpha().png().toBuffer();
  const stats = await sharp(region).stats();
  const red = Math.round(stats.channels[0]?.mean ?? 127);
  const green = Math.round(stats.channels[1]?.mean ?? 127);
  const blue = Math.round(stats.channels[2]?.mean ?? 127);
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  const foreground = luminance < 145 ? "#ffffff" : "#111827";
  const shadow = luminance < 145 ? "#000000" : "#ffffff";
  const innerWidth = Math.max(1, width * 0.88);
  const innerHeight = Math.max(1, height * 0.78);

  let fontSize = Math.min(96, Math.max(12, Math.floor(height * 0.58)));
  let lines: string[] = [];
  for (; fontSize >= 12; fontSize -= 1) {
    const maxCharacters = Math.max(1, Math.floor(innerWidth / (fontSize * 0.62)));
    const candidateLines = wrapExactText(exactValue, maxCharacters);
    const widest = Math.max(...candidateLines.map((line) => line.length), 1) * fontSize * 0.62;
    if (widest <= innerWidth && candidateLines.length * fontSize * 1.16 <= innerHeight) {
      lines = candidateLines;
      break;
    }
  }
  if (lines.length === 0) {
    fontSize = 12;
    lines = wrapExactText(exactValue, Math.max(1, Math.floor(innerWidth / (fontSize * 0.62))));
  }

  const lineHeight = fontSize * 1.16;
  const firstBaseline = height / 2 - ((lines.length - 1) * lineHeight) / 2 + fontSize * 0.34;
  const tspans = lines
    .map((line, index) => `<tspan x="${width / 2}" y="${firstBaseline + index * lineHeight}">${escapeSvgText(line)}</tspan>`)
    .join("");
  const svg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`
      + `<rect width="100%" height="100%" fill="rgb(${red},${green},${blue})" fill-opacity="0.82"/>`
      + `<text text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" fill="${foreground}" stroke="${shadow}" stroke-opacity="0.18" stroke-width="1" paint-order="stroke" letter-spacing="0">${tspans}</text>`
      + "</svg>",
  );
  const softened = await sharp(region)
    .blur(Math.max(2, Math.min(12, Math.floor(Math.min(width, height) / 18))))
    .composite([{ input: svg }])
    .png()
    .toBuffer();
  const output = await sharp(bytes)
    .composite([{ input: softened, left, top }])
    .png()
    .toBuffer();
  return `data:image/png;base64,${output.toString("base64")}`;
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
  const modelProfile = input.modelProfile ?? "image_final";

  for (const [attemptIndex, provider] of input.providers.slice(0, 2).entries()) {
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
    };
  }

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
  throw new CloneGenerationError(lastError, providerAttemptCount);
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
  if (!input.assetUrl) throw new Error("Generated image could not be stored.");
  let decoded: ReturnType<typeof dataUrlToUploadBytes>;
  if (input.assetUrl.startsWith("data:image/")) {
    decoded = dataUrlToUploadBytes(input.assetUrl);
  } else {
    const response = await (input.fetchImpl ?? fetch)(input.assetUrl);
    if (!response.ok) throw new Error("Generated image could not be stored.");
    const source = new Uint8Array(await response.arrayBuffer());
    const { default: sharp } = await import("sharp");
    const png = await sharp(source).png().toBuffer();
    decoded = {
      bytes: new Uint8Array(png),
      contentType: "image/png",
      extension: "png",
    };
  }
  const storagePath = `${input.workspaceId}/adstudio/clones/${input.fileNameSeed}.${decoded.extension}`;
  const { error } = await input.supabase.storage
    .from("workspace-artifacts")
    .upload(storagePath, decoded.bytes, { contentType: decoded.contentType, upsert: false });
  if (error) throw new Error("Generated image could not be stored.");
  return `/api/adstudio/media?path=${encodeURIComponent(storagePath)}`;
}
