// Shared clone-generation plumbing: tiered provider resolution + first-success
// cascade with provider-run logging. Used by generate-clone (full clones) and
// the targeted in-place edit endpoint.

import { createImageProviderForCandidate, createOpenAiImageProvider } from "./ai-providers.ts";
import { dataUrlToUploadBytes } from "./generated-media.ts";
import type { ImageProviderAdapter, ImageProviderRequest } from "./providers.ts";
import { modelCandidateAttempts, resolveRuntimeModelProfile } from "../operator/prompts/model-profile-runtime.ts";
import { recordAdStudioProviderRun } from "../operator/prompts/redact-prompt-run.ts";

export type CloneTier = "preview" | "final";

export function cloneTierProfile(tier: CloneTier): "image_draft" | "image_final" {
  return tier === "preview" ? "image_draft" : "image_final";
}

/** Ordered providers for the tier: profile candidates, then a direct-OpenAI last resort. */
export async function resolveCloneProviders(tier: CloneTier): Promise<ImageProviderAdapter[]> {
  const profile = await resolveRuntimeModelProfile(cloneTierProfile(tier));
  const providers = modelCandidateAttempts(profile).map((candidate) => createImageProviderForCandidate(candidate));
  providers.push(createOpenAiImageProvider());
  return providers;
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
}): Promise<CloneGenerationResult> {
  const startedAt = Date.now();
  const attempts: Array<{ provider: string; model: string; status: "attempted" | "failed" | "completed"; error?: string }> = [];
  const prompt = {
    system: "",
    user: input.request.prompt,
    fullPrompt: input.request.prompt,
    promptVersions: [],
    fallbackPromptUsed: false,
    warnings: [],
  };
  let lastError: unknown = null;

  for (const provider of input.providers) {
    attempts.push({ provider: provider.providerName, model: "unknown", status: "attempted" });
    try {
      const result = await provider.generate(input.request);
      if (!result.assetUrl) throw new Error("Provider returned no image.");
      attempts[attempts.length - 1] = { provider: provider.providerName, model: result.model, status: "completed" };
      await recordAdStudioProviderRun({
        workspaceId: input.workspaceId,
        userId: input.userId,
        correlationId: input.correlationId,
        taskType: "adstudio.clone",
        modelProfile: cloneTierProfile(input.tier),
        prompt,
        input: { tier: input.tier, attempt: input.attempt },
        attempts,
        latencyMs: Date.now() - startedAt,
        providerName: provider.providerName,
        providerType: "image_generation",
        modelName: result.model,
        output: null,
        status: "completed",
      });
      return { assetUrl: result.assetUrl, model: result.model, provider: provider.providerName };
    } catch (error) {
      lastError = error;
      attempts[attempts.length - 1] = {
        provider: provider.providerName,
        model: "unavailable",
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  await recordAdStudioProviderRun({
    workspaceId: input.workspaceId,
    userId: input.userId,
    correlationId: input.correlationId,
    taskType: "adstudio.clone",
    modelProfile: cloneTierProfile(input.tier),
    prompt,
    input: { tier: input.tier, attempt: input.attempt },
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
