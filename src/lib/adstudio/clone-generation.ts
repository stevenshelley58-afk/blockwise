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
