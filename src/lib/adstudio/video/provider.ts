import { createTextProviderForCandidate } from "../ai-providers.ts";
import { hasConfiguredAdStudioTextProvider } from "../copy-generation.ts";
import { modelCandidateAttempts, resolveRuntimeModelProfile } from "../../operator/prompts/model-profile-runtime.ts";
import type { TextProviderAdapter } from "../providers.ts";
import { videoScriptPlanSchema, type VideoProjectInput, type VideoScriptPlan } from "./types.ts";

export class VideoProviderError extends Error {
  readonly code = "video_script_provider_failed";
  constructor(message = "Script generation is temporarily unavailable.", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "VideoProviderError";
  }
}

export type VideoProviderOptions = {
  provider?: TextProviderAdapter;
  providerEnv?: Partial<Record<string, string>>;
  signal?: AbortSignal;
};

/**
 * Uses the existing structured text provider lane when configured. The
 * provider is deliberately asked for a plain JSON object and validated by the
 * video domain instead of exposing provider-specific details to callers.
 */
export async function generateProviderVideoScript(
  input: VideoProjectInput,
  options: VideoProviderOptions = {},
): Promise<VideoScriptPlan | null> {
  if (!options.provider && !hasConfiguredAdStudioTextProvider(options.providerEnv ?? process.env)) return null;

  try {
    const provider = options.provider ?? await resolveProvider(options.providerEnv);
    const response = await provider.generate({
      system: "You write concise, compliant Australian real-estate lead-generation video scripts. Return JSON only. Never invent proof, numbers, guarantees, valuations, buyer counts, or listing-sale copy.",
      messages: [{
        role: "user",
        content: JSON.stringify({
          task: "Create exactly three hook variants and one fixed body for a video script.",
          project: input,
          requirements: {
            words: input.durationSeconds === 15 ? "30-40 spoken words including CTA" : "60-75 spoken words including CTA",
            overlays: "Each overlay must be seven words or fewer",
            scenes: "Exactly four scenes, local intent first",
            hooks: ["question", "proof", "offer"],
          },
          output: "{version:1,durationSeconds,hookVariants:[{id,style,text}],selectedHookId,body,cta,scenes:[{index,beat,narration,overlay,assetIds}],wordCount,promise,source:'provider'}",
        }),
      }],
      schemaName: "metaLeadAdPack",
      signal: options.signal,
    });
    const json = response.json && typeof response.json === "object" && !Array.isArray(response.json)
      ? response.json as Record<string, unknown>
      : {};
    const parsed = videoScriptPlanSchema.safeParse({ ...json, source: "provider" });
    return parsed.success ? parsed.data : null;
  } catch (cause) {
    // Generation has a deterministic domain fallback. Do not leak model names,
    // API errors, or accounting/provider jargon to a customer route.
    if (options.provider) throw new VideoProviderError(undefined, { cause });
    return null;
  }
}

async function resolveProvider(providerEnv?: Partial<Record<string, string>>): Promise<TextProviderAdapter> {
  const profile = await resolveRuntimeModelProfile("structured_json");
  const candidates = modelCandidateAttempts(profile, 2);
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return createTextProviderForCandidate(candidate, { env: providerEnv });
    } catch (error) {
      lastError = error;
    }
  }
  throw new VideoProviderError(undefined, { cause: lastError });
}
