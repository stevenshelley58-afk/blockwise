import type { ModelCandidate } from "../ai/model-registry.ts";

export type AdGenerationQuality = "fast" | "high";

export type AdStudioGenerationMode = {
  quality: AdGenerationQuality;
  label: "Fast" | "High quality";
  copy: ModelCandidate;
  image: ModelCandidate;
  qa: ModelCandidate;
};

const GEMINI_FAST_TEXT: ModelCandidate = {
  provider: "google",
  model: "gemini-2.5-flash-lite",
  inputUsdPerMillionTokens: 0.1,
  outputUsdPerMillionTokens: 0.4,
  imageUsdPerUnit: 0,
  supportsStructuredOutput: true,
  maxContextTokens: 1_048_576,
  maxLatencyMs: 12_000,
};

const GEMINI_FAST_IMAGE: ModelCandidate = {
  provider: "google",
  model: "gemini-3.1-flash-image",
  inputUsdPerMillionTokens: 0.5,
  outputUsdPerMillionTokens: 3,
  imageUsdPerUnit: 0.04,
  supportsStructuredOutput: false,
  maxContextTokens: 131_072,
  maxLatencyMs: 30_000,
};

const OPENAI_HIGH_TEXT: ModelCandidate = {
  provider: "openai",
  model: "gpt-5.5",
  inputUsdPerMillionTokens: 5,
  outputUsdPerMillionTokens: 30,
  imageUsdPerUnit: 0.01,
  supportsStructuredOutput: true,
  maxContextTokens: 1_050_000,
  maxLatencyMs: 30_000,
};

const OPENAI_HIGH_IMAGE: ModelCandidate = {
  provider: "openai",
  model: "gpt-image-2",
  inputUsdPerMillionTokens: 5,
  outputUsdPerMillionTokens: 30,
  imageUsdPerUnit: 0.211,
  supportsStructuredOutput: false,
  maxContextTokens: 16_000,
  maxLatencyMs: 60_000,
};

const ADSTUDIO_GENERATION_MODES: Record<AdGenerationQuality, AdStudioGenerationMode> = {
  fast: {
    quality: "fast",
    label: "Fast",
    copy: GEMINI_FAST_TEXT,
    image: GEMINI_FAST_IMAGE,
    qa: GEMINI_FAST_TEXT,
  },
  high: {
    quality: "high",
    label: "High quality",
    copy: OPENAI_HIGH_TEXT,
    image: OPENAI_HIGH_IMAGE,
    qa: OPENAI_HIGH_TEXT,
  },
};

export function resolveAdStudioGenerationMode(
  quality: AdGenerationQuality = "fast",
): AdStudioGenerationMode {
  return ADSTUDIO_GENERATION_MODES[quality];
}

export function adStudioGenerationFailureMessage(quality: AdGenerationQuality): string {
  const alternate = quality === "fast" ? "High quality" : "Fast";
  return `${ADSTUDIO_GENERATION_MODES[quality].label} generation is unavailable right now. Nothing was saved. Try again, or choose ${alternate}.`;
}
