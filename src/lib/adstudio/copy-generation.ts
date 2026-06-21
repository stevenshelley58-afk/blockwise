import { randomUUID } from "node:crypto";

import {
  createAzureOpenAiTextProvider,
  createOpenAiTextProvider,
  createOpenRouterTextProvider,
  createTextProviderForCandidate,
} from "./ai-providers.ts";
import type { TextProviderAdapter, TextProviderResponse } from "./providers.ts";
import { emitModelFallbackAlert } from "../alerts/model-fallback-alert.ts";
import { assembleMetaCopyPrompt } from "../operator/prompts/assemble-prompt.ts";
import { modelCandidateAttempts, resolveRuntimeModelProfile } from "../operator/prompts/model-profile-runtime.ts";
import { getActivePromptBundle, type PromptKey } from "../operator/prompts/prompt-registry.ts";
import { recordAdStudioProviderRun } from "../operator/prompts/redact-prompt-run.ts";

export type AdStudioCopyFields = {
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
};

export type AdStudioCopyRequestBody = {
  mode?: "generate" | "brief" | "assist";
  brief?: string;
  assistAction?: string;
  copy?: Partial<AdStudioCopyFields>;
  /**
   * Image the copy should be grounded in, already resolved to a model-consumable
   * reference (`data:` URL or absolute http(s) URL). See resolveAdStudioImageForModel.
   */
  sourceImageUrl?: string;
  context?: {
    goal?: string;
    offer?: string;
    market?: string;
    propertyType?: string;
    businessName?: string;
    templateName?: string;
    templateHint?: string;
    /** Brand kit voice - dominates wording style. */
    voice?: string;
    preferredPhrases?: string[];
    neverSay?: string[];
  };
};

export type AdStudioCopyGenerationInput = AdStudioCopyRequestBody & {
  workspaceId: string;
  userId: string;
  correlationId?: string;
};

export type AdStudioCopyGenerationResponse = {
  copy: AdStudioCopyFields;
  alternates: {
    headline: string[];
    primaryText: string[];
  };
  source: "ai";
};

type CopyGenerationResult = {
  output: TextProviderResponse;
  provider: TextProviderAdapter;
  modelName: string;
  attempts: Array<{ provider: string; model: string; status: "attempted" | "failed" | "completed"; error?: string }>;
};

const IMAGE_GROUNDING_INSTRUCTION =
  "An image of the advertised property is attached. Ground the copy in what is actually visible in it — the property's style, setting, and standout features — and do not invent details that contradict the image.";

const COPY_PROMPT_KEYS: PromptKey[] = [
  "adstudio.copy.system",
  "adstudio.copy.input_template",
  "adstudio.copy.output_schema",
  "adstudio.copy.compliance_rules",
];

export const ADSTUDIO_COPY_LIMITS: Record<keyof AdStudioCopyFields, number> = {
  primaryText: 125,
  headline: 40,
  description: 90,
  cta: 24,
};

export async function generateAdStudioCopy(
  input: AdStudioCopyGenerationInput,
): Promise<AdStudioCopyGenerationResponse> {
  const startedAt = Date.now();
  const correlationId = input.correlationId ?? randomUUID();
  const bundle = await getActivePromptBundle(COPY_PROMPT_KEYS);
  const assembled = assembleMetaCopyPrompt({
    bundle,
    mode: input.mode ?? "generate",
    context: input.context ?? {},
    brief: input.brief,
    currentCopy: input.copy,
    assistAction: input.assistAction,
  });
  const imageUrl = usableModelImage(input.sourceImageUrl);
  const userPrompt = imageUrl ? `${assembled.user}\n\n${IMAGE_GROUNDING_INSTRUCTION}` : assembled.user;
  let generation: CopyGenerationResult | null = null;

  try {
    generation = await generateCopyWithProfile(assembled.system, userPrompt, imageUrl);
    const output = generation.output;
    const json = (output.json ?? {}) as Record<string, unknown>;
    const current = input.copy ?? {};

    await recordAdStudioProviderRun({
      workspaceId: input.workspaceId,
      userId: input.userId,
      correlationId,
      taskType: "adstudio.copy",
      modelProfile: "structured_json",
      prompt: assembled,
      input: generationLogInput(input),
      attempts: generation.attempts,
      latencyMs: Date.now() - startedAt,
      providerName: generation.provider.providerName,
      providerType: generation.provider.providerType,
      modelName: generation.modelName,
      output,
      status: "completed",
    });

    return {
      copy: {
        headline: clamp(json.headline, ADSTUDIO_COPY_LIMITS.headline, current.headline ?? ""),
        primaryText: clamp(json.primaryText, ADSTUDIO_COPY_LIMITS.primaryText, current.primaryText ?? ""),
        description: clamp(json.description, ADSTUDIO_COPY_LIMITS.description, current.description ?? ""),
        cta: clamp(json.cta, ADSTUDIO_COPY_LIMITS.cta, current.cta ?? "Learn more"),
      },
      alternates: {
        headline: clampList(json.altHeadlines, ADSTUDIO_COPY_LIMITS.headline),
        primaryText: clampList(json.altPrimaryTexts, ADSTUDIO_COPY_LIMITS.primaryText),
      },
      source: "ai",
    };
  } catch (error) {
    await recordAdStudioProviderRun({
      workspaceId: input.workspaceId,
      userId: input.userId,
      correlationId,
      taskType: "adstudio.copy",
      modelProfile: "structured_json",
      prompt: assembled,
      input: generationLogInput(input),
      attempts: generation?.attempts ?? [],
      latencyMs: Date.now() - startedAt,
      providerName: generation?.provider.providerName ?? "unavailable",
      providerType: "text_generation",
      modelName: generation?.modelName ?? "unavailable",
      output: null,
      status: "failed",
      error,
    });
    throw error;
  }
}

function generationLogInput(input: AdStudioCopyGenerationInput) {
  return {
    mode: input.mode ?? "generate",
    context: input.context ?? {},
    brief: input.brief,
    copy: input.copy,
    assistAction: input.assistAction,
  };
}

function pickProvider(): TextProviderAdapter | null {
  if (hasAzureOpenAiEnv(process.env)) return createAzureOpenAiTextProvider();
  if (process.env.OPENAI_API_KEY) return createOpenAiTextProvider();
  if (process.env.OPENROUTER_API_KEY) return createOpenRouterTextProvider();
  return null;
}

function hasAzureOpenAiEnv(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env.AZURE_OPENAI_API_KEY &&
      (env.AZURE_OPENAI_CHAT_COMPLETIONS_URL ||
        (env.AZURE_OPENAI_ENDPOINT &&
          (env.AZURE_OPENAI_DEPLOYMENT ||
            env.AZURE_OPENAI_CHAT_DEPLOYMENT ||
            env.AZURE_OPENAI_TEXT_DEPLOYMENT ||
            env.BLOCKWISE_AZURE_OPENAI_TEXT_DEPLOYMENT))),
  );
}

function clamp(value: unknown, limit: number, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return fallback;
  return text.length > limit ? text.slice(0, limit).trimEnd() : text;
}

function clampList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, 2)
    .map((item) => (item.length > limit ? item.slice(0, limit).trimEnd() : item.trim()));
}

// Only forward references a vision model can actually read.
function usableModelImage(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  return ref.startsWith("data:image/") || /^https?:\/\//i.test(ref) ? ref : undefined;
}

async function generateCopyWithProfile(
  system: string,
  user: string,
  imageUrl?: string,
): Promise<CopyGenerationResult> {
  const profile = await resolveRuntimeModelProfile("structured_json");
  const candidates = modelCandidateAttempts(profile);
  const legacyProvider = pickProvider();
  const attempts: CopyGenerationResult["attempts"] = [];
  let lastError: unknown = null;

  for (const [index, candidate] of candidates.entries()) {
    const provider = createTextProviderForCandidate(candidate);
    attempts.push({ provider: provider.providerName, model: candidate.model, status: "attempted" });

    try {
      const output = await provider.generate({
        system,
        schemaName: "metaLeadAdPack",
        messages: [{ role: "user", content: user }],
        imageUrl,
      });
      attempts[attempts.length - 1] = { provider: provider.providerName, model: candidate.model, status: "completed" };
      return {
        output,
        provider,
        modelName: String(output.providerMetadata.model ?? candidate.model),
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

      // A configured model just failed — tell the owner their chosen model is down.
      // De-duped by stage+toModel, so a burst of requests sends one alert.
      const toModel = candidates[index + 1]?.model ?? (legacyProvider ? "env_default" : undefined);
      if (toModel) {
        void emitModelFallbackAlert({
          stage: "adstudio.copy",
          fromModel: candidate.model,
          toModel,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  if (legacyProvider) {
    attempts.push({ provider: legacyProvider.providerName, model: "env_default", status: "attempted" });
    try {
      const output = await legacyProvider.generate({
        system,
        schemaName: "metaLeadAdPack",
        messages: [{ role: "user", content: user }],
        imageUrl,
      });
      attempts[attempts.length - 1] = { provider: legacyProvider.providerName, model: "env_default", status: "completed" };
      return {
        output,
        provider: legacyProvider,
        modelName: String(output.providerMetadata.model ?? "env_default"),
        attempts,
      };
    } catch (error) {
      lastError = error;
      attempts[attempts.length - 1] = {
        provider: legacyProvider.providerName,
        model: "env_default",
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error("Copy generation is not configured. Add AZURE_OPENAI_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY to enable it.");
}
