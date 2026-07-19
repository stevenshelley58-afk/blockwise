import { resolveAdStudioGenerationMode } from "../adstudio/generation-mode.ts";
import type { ModelCandidate, ModelProfile, ModelProfileKey, ModelProvider } from "./model-registry.ts";
import {
  isModelProfileKey,
  listModelProfiles,
  normalizeModelSlug,
  resolveEffectiveModelProfiles,
} from "./model-registry.ts";

export type ModelCatalogOption = {
  provider: ModelProvider;
  model: string;
  label: string;
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
  imageUsdPerUnit: number;
  maxContextTokens: number;
  supportsStructuredOutput: boolean;
  supportsVisionInput: boolean;
  supportsImageOutput: boolean;
};

export type ProviderReadiness = {
  configured: boolean;
  missing: string[];
};

export type EnvLike = {
  OPENAI_API_KEY?: string;
  GOOGLE_AI_API_KEY?: string;
};

export type ModelProfileVersionInsert = {
  model_profile_id: string;
  provider: ModelProvider;
  model: string;
  input_usd_per_million_tokens: number;
  output_usd_per_million_tokens: number;
  image_usd_per_unit: number;
  supports_structured_output: boolean;
  max_context_tokens: number;
};

export type ModelControlProfileRow = {
  key: ModelProfileKey;
  label: string;
  task: string;
  enabled: boolean;
  requiresStructuredOutput: boolean;
  maxRunCostUsd: number;
  defaultTemperature: number;
  active: ModelCandidate;
  options: ModelCatalogOption[];
};

export type ModelControlSection = {
  key: string;
  label: string;
  description: string;
  profiles: ModelControlProfileRow[];
};

export type ModelControlGenerationMode = {
  key: "fast" | "high";
  label: string;
  copy: string;
  image: string;
  qa: string;
};

export type ModelControlViewData = {
  sections: ModelControlSection[];
  modelProfiles: ModelProfile[];
  generationModes: ModelControlGenerationMode[];
  readiness: {
    openai: ProviderReadiness;
    google: ProviderReadiness;
  };
};

type SelectionRequest = { provider?: unknown; model?: unknown };
type SelectionValidationResult =
  | { ok: true; option: ModelCatalogOption }
  | { ok: false; status: number; error: string };

const DEFAULT_MAX_LATENCY_MS = 12_000;

const OPENAI_GPT_41_MINI = option({
  provider: "openai",
  model: "gpt-4.1-mini",
  label: "OpenAI GPT-4.1 Mini",
  inputUsdPerMillionTokens: 0.4,
  outputUsdPerMillionTokens: 1.6,
  maxContextTokens: 128_000,
  supportsStructuredOutput: true,
  supportsVisionInput: true,
});
const OPENAI_GPT_55 = option({
  provider: "openai",
  model: "gpt-5.5",
  label: "OpenAI GPT-5.5",
  inputUsdPerMillionTokens: 5,
  outputUsdPerMillionTokens: 30,
  maxContextTokens: 1_050_000,
  supportsStructuredOutput: true,
  supportsVisionInput: true,
});
const GOOGLE_FLASH_LITE = option({
  provider: "google",
  model: "gemini-2.5-flash-lite",
  label: "Gemini 2.5 Flash-Lite",
  inputUsdPerMillionTokens: 0.1,
  outputUsdPerMillionTokens: 0.4,
  maxContextTokens: 1_048_576,
  supportsStructuredOutput: true,
  supportsVisionInput: true,
});
const GOOGLE_FLASH_IMAGE = option({
  provider: "google",
  model: "gemini-3.1-flash-image",
  label: "Gemini 3.1 Flash Image",
  inputUsdPerMillionTokens: 0.5,
  outputUsdPerMillionTokens: 3,
  imageUsdPerUnit: 0.04,
  maxContextTokens: 131_072,
  supportsVisionInput: true,
  supportsImageOutput: true,
});
const OPENAI_IMAGE_2 = option({
  provider: "openai",
  model: "gpt-image-2",
  label: "OpenAI GPT Image 2",
  inputUsdPerMillionTokens: 5,
  outputUsdPerMillionTokens: 30,
  imageUsdPerUnit: 0.211,
  maxContextTokens: 16_000,
  supportsVisionInput: true,
  supportsImageOutput: true,
});

const CURATED_DIRECT_OPTIONS: Record<ModelProfileKey, ModelCatalogOption[]> = {
  cheap_draft_text: [OPENAI_GPT_41_MINI, GOOGLE_FLASH_LITE],
  high_quality_strategy: [OPENAI_GPT_55, GOOGLE_FLASH_LITE],
  structured_json: [OPENAI_GPT_55, GOOGLE_FLASH_LITE],
  vision_classification: [OPENAI_GPT_55, GOOGLE_FLASH_LITE],
  image_draft: [GOOGLE_FLASH_IMAGE, OPENAI_IMAGE_2],
  image_final: [OPENAI_IMAGE_2, GOOGLE_FLASH_IMAGE],
  compliance_review: [OPENAI_GPT_41_MINI, GOOGLE_FLASH_LITE],
  disabled_profile: [],
};

const PROFILE_SECTION_MAP: Array<{
  key: string;
  label: string;
  description: string;
  profileKeys: ModelProfileKey[];
}> = [
  { key: "research", label: "Research", description: "Research and evidence classification.", profileKeys: ["cheap_draft_text", "vision_classification"] },
  { key: "campaigns", label: "Campaigns", description: "Strategy and structured campaign outputs.", profileKeys: ["high_quality_strategy", "structured_json"] },
  { key: "creative", label: "Creative", description: "Direct image generation profiles.", profileKeys: ["image_draft", "image_final"] },
  { key: "compliance", label: "Compliance", description: "Real-estate claim and policy review.", profileKeys: ["compliance_review"] },
];

function option(
  value: Pick<ModelCatalogOption, "provider" | "model" | "label" | "inputUsdPerMillionTokens" | "outputUsdPerMillionTokens" | "maxContextTokens">
    & Partial<Pick<ModelCatalogOption, "imageUsdPerUnit" | "supportsStructuredOutput" | "supportsVisionInput" | "supportsImageOutput">>,
): ModelCatalogOption {
  return {
    imageUsdPerUnit: 0,
    supportsStructuredOutput: false,
    supportsVisionInput: false,
    supportsImageOutput: false,
    ...value,
  };
}

export function getDirectProviderReadiness(env: EnvLike = process.env as EnvLike) {
  return {
    openai: readiness(env.OPENAI_API_KEY, "OPENAI_API_KEY"),
    google: readiness(env.GOOGLE_AI_API_KEY, "GOOGLE_AI_API_KEY"),
  };
}

function readiness(value: string | undefined, key: string): ProviderReadiness {
  return { configured: Boolean(value), missing: value ? [] : [key] };
}

export function getCuratedModelOptionsForProfile(profileKey: ModelProfileKey): ModelCatalogOption[] {
  return CURATED_DIRECT_OPTIONS[profileKey].map((candidate) => ({ ...candidate }));
}

export function getCuratedModelOptionsWithCatalog(profileKey: ModelProfileKey): ModelCatalogOption[] {
  return getCuratedModelOptionsForProfile(profileKey);
}

export function validateModelProfileSelection(
  profileKeyValue: string,
  request: SelectionRequest,
): SelectionValidationResult {
  if (!isModelProfileKey(profileKeyValue)) {
    return { ok: false, status: 404, error: `Unknown model profile: ${profileKeyValue}` };
  }
  if (request.provider !== "openai" && request.provider !== "google") {
    return { ok: false, status: 400, error: "Only direct OpenAI or Gemini models can be saved." };
  }
  if (typeof request.model !== "string" || !request.model.trim()) {
    return { ok: false, status: 400, error: "A model id is required." };
  }
  const model = normalizeModelSlug(request.provider, request.model.trim());
  const approved = getCuratedModelOptionsForProfile(profileKeyValue).find(
    (candidate) => candidate.provider === request.provider && candidate.model === model,
  );
  if (!approved) {
    const profile = listModelProfiles().find((candidate) => candidate.key === profileKeyValue);
    return { ok: false, status: 400, error: `${model} is not approved for ${profile?.label ?? profileKeyValue}.` };
  }
  return { ok: true, option: approved };
}

export function buildModelProfileVersionInsert(
  modelProfileId: string,
  selected: ModelCatalogOption,
): ModelProfileVersionInsert {
  return {
    model_profile_id: modelProfileId,
    provider: selected.provider,
    model: selected.model,
    input_usd_per_million_tokens: selected.inputUsdPerMillionTokens,
    output_usd_per_million_tokens: selected.outputUsdPerMillionTokens,
    image_usd_per_unit: selected.imageUsdPerUnit,
    supports_structured_output: selected.supportsStructuredOutput,
    max_context_tokens: selected.maxContextTokens,
  };
}

export function buildModelControlViewData(
  args: { profiles?: ModelProfile[]; env?: EnvLike } = {},
): ModelControlViewData {
  const modelProfiles = args.profiles ?? resolveEffectiveModelProfiles();
  const profileMap = new Map(modelProfiles.map((profile) => [profile.key, profile]));
  const sections = PROFILE_SECTION_MAP.map((section) => ({
    ...section,
    profiles: section.profileKeys.flatMap((key) => {
      const profile = profileMap.get(key);
      return profile ? [buildModelControlProfileRow(profile)] : [];
    }),
  })).filter((section) => section.profiles.length > 0);

  const fast = resolveAdStudioGenerationMode("fast");
  const high = resolveAdStudioGenerationMode("high");
  return {
    sections,
    modelProfiles,
    generationModes: [fast, high].map((mode) => ({
      key: mode.quality,
      label: mode.label,
      copy: `${mode.copy.provider} / ${mode.copy.model}`,
      image: `${mode.image.provider} / ${mode.image.model}`,
      qa: `${mode.qa.provider} / ${mode.qa.model}`,
    })),
    readiness: getDirectProviderReadiness(args.env),
  };
}

function buildModelControlProfileRow(profile: ModelProfile): ModelControlProfileRow {
  const active = { ...profile.primary, model: normalizeModelSlug(profile.primary.provider, profile.primary.model) };
  const curated = getCuratedModelOptionsForProfile(profile.key);
  const options = curated.some((candidate) => candidate.provider === active.provider && candidate.model === active.model)
    ? curated
    : [modelCandidateToOption(active, "Current"), ...curated];
  return {
    key: profile.key,
    label: profile.label,
    task: profile.task,
    enabled: profile.enabled,
    requiresStructuredOutput: profile.requiresStructuredOutput,
    maxRunCostUsd: profile.maxRunCostUsd,
    defaultTemperature: profile.defaultTemperature,
    active,
    options,
  };
}

function modelCandidateToOption(candidate: ModelCandidate, suffix: string): ModelCatalogOption {
  return {
    provider: candidate.provider,
    model: candidate.model,
    label: `${candidate.model} (${suffix})`,
    inputUsdPerMillionTokens: candidate.inputUsdPerMillionTokens,
    outputUsdPerMillionTokens: candidate.outputUsdPerMillionTokens,
    imageUsdPerUnit: candidate.imageUsdPerUnit,
    maxContextTokens: candidate.maxContextTokens,
    supportsStructuredOutput: candidate.supportsStructuredOutput,
    supportsVisionInput: candidate.imageUsdPerUnit > 0 || candidate.maxContextTokens >= 128_000,
    supportsImageOutput: candidate.imageUsdPerUnit > 0,
  };
}

export function optionToCandidate(selected: ModelCatalogOption): ModelCandidate {
  return {
    provider: selected.provider,
    model: selected.model,
    inputUsdPerMillionTokens: selected.inputUsdPerMillionTokens,
    outputUsdPerMillionTokens: selected.outputUsdPerMillionTokens,
    imageUsdPerUnit: selected.imageUsdPerUnit,
    supportsStructuredOutput: selected.supportsStructuredOutput,
    maxContextTokens: selected.maxContextTokens,
    maxLatencyMs: DEFAULT_MAX_LATENCY_MS,
  };
}
