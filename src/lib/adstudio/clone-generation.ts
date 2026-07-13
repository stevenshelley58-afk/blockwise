// Shared clone-generation plumbing: tiered provider resolution + first-success
// cascade with provider-run logging. Used by generate-clone (full clones) and
// the targeted in-place edit endpoint.

import { createImageProviderForCandidate } from "./ai-providers.ts";
import { dataUrlToUploadBytes } from "./generated-media.ts";
import type { ImageProviderAdapter, ImageProviderRequest, ImageProviderResponse } from "./providers.ts";
import { modelCandidateAttempts, resolveRuntimeModelProfile } from "../operator/prompts/model-profile-runtime.ts";
import {
  executeAdStudioProviderAttempt,
  recordAdStudioProviderRun,
  type ProviderRunAttempt,
} from "../operator/prompts/redact-prompt-run.ts";

export type CloneTier = "preview" | "final";

export function cloneTierProfile(tier: CloneTier): "image_draft" | "image_final" {
  return tier === "preview" ? "image_draft" : "image_final";
}

/** Ordered providers for the tier, each pinned to its runtime profile pricing. */
export async function resolveCloneProviders(tier: CloneTier): Promise<ImageProviderAdapter[]> {
  const profile = await resolveRuntimeModelProfile(cloneTierProfile(tier));
  return modelCandidateAttempts(profile).map((candidate) => createImageProviderForCandidate(candidate));
}

export type CloneGenerationResult = { assetUrl: string; model: string; provider: string };

export async function generateCloneWithCascade(input: {
  providers: ImageProviderAdapter[];
  request: ImageProviderRequest;
  workspaceId: string;
  userId: string;
  correlationId: string;
  tier: CloneTier;
  attempt: number;
  accounting?: {
    executeAttempt: typeof executeAdStudioProviderAttempt;
    recordRun: typeof recordAdStudioProviderRun;
  };
}): Promise<CloneGenerationResult> {
  const startedAt = Date.now();
  const mutationId = `${input.correlationId}:adstudio.clone:${input.tier}:${input.attempt}:${input.request.aspectRatio}`;
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
  const accounting = input.accounting ?? {
    executeAttempt: executeAdStudioProviderAttempt,
    recordRun: recordAdStudioProviderRun,
  };

  for (const [attemptIndex, provider] of input.providers.entries()) {
    let result: ImageProviderResponse | null = null;
    try {
      const execution = await accounting.executeAttempt<ImageProviderResponse>({
        workspaceId: input.workspaceId,
        mutationId,
        attemptIndex,
        modelProfile: cloneTierProfile(input.tier),
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
      modelProfile: cloneTierProfile(input.tier),
      mutationId,
      prompt,
      input: { tier: input.tier, attempt: input.attempt, aspectRatio: input.request.aspectRatio },
      attempts,
      latencyMs: Date.now() - startedAt,
      providerName: provider.providerName,
      providerType: "image_generation",
      modelName: result.model,
      output: result,
      status: "completed",
    });
    return { assetUrl: result.assetUrl, model: result.model, provider: provider.providerName };
  }

  await accounting.recordRun({
    workspaceId: input.workspaceId,
    userId: input.userId,
    correlationId: input.correlationId,
    taskType: "adstudio.clone",
    modelProfile: cloneTierProfile(input.tier),
    mutationId,
    prompt,
    input: { tier: input.tier, attempt: input.attempt, aspectRatio: input.request.aspectRatio },
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
