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

export type OpenRouterReadiness = {
  configured: boolean;
  missing: string[];
  appUrl: string;
};

export type EnvLike = {
  NEXT_PUBLIC_APP_URL?: string;
  OPENROUTER_API_KEY?: string;
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
  fallbacks: ModelCandidate[];
  options: ModelCatalogOption[];
};

export type ModelControlSection = {
  key: string;
  label: string;
  description: string;
  profiles: ModelControlProfileRow[];
};

export type ModelControlViewData = {
  sections: ModelControlSection[];
  modelProfiles: ModelProfile[];
  readiness: {
    openrouter: OpenRouterReadiness;
  };
};

type SelectionRequest = {
  provider?: unknown;
  model?: unknown;
};

type SelectionValidationResult =
  | {
      ok: true;
      option: ModelCatalogOption;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

const DEFAULT_APP_URL = "http://localhost:3000";
const DEFAULT_MAX_LATENCY_MS = 12_000;

const CURATED_OPENROUTER_OPTIONS: Record<ModelProfileKey, ModelCatalogOption[]> = {
  cheap_draft_text: [
    createOpenRouterOption({
      model: "google/gemini-2.0-flash-001",
      label: "Google Gemini 2.0 Flash",
      inputUsdPerMillionTokens: 0.1,
      outputUsdPerMillionTokens: 0.4,
      maxContextTokens: 1_000_000,
      supportsStructuredOutput: true,
      supportsVisionInput: true,
    }),
    createOpenRouterOption({
      model: "google/gemini-2.0-flash-lite-001",
      label: "Google Gemini 2.0 Flash Lite",
      inputUsdPerMillionTokens: 0.075,
      outputUsdPerMillionTokens: 0.3,
      maxContextTokens: 1_048_576,
      supportsStructuredOutput: true,
      supportsVisionInput: true,
    }),
    createOpenRouterOption({
      model: "qwen/qwen3.5-flash-02-23",
      label: "Qwen Qwen3.5 Flash",
      inputUsdPerMillionTokens: 0.065,
      outputUsdPerMillionTokens: 0.26,
      maxContextTokens: 1_000_000,
      supportsStructuredOutput: true,
      supportsVisionInput: true,
    }),
  ],
  high_quality_strategy: [
    createOpenRouterOption({
      model: "anthropic/claude-sonnet-4.6",
      label: "Anthropic Claude Sonnet 4.6",
      inputUsdPerMillionTokens: 3,
      outputUsdPerMillionTokens: 15,
      maxContextTokens: 1_000_000,
      supportsStructuredOutput: true,
    }),
    createOpenRouterOption({
      model: "openai/gpt-5.4",
      label: "OpenAI GPT-5.4",
      inputUsdPerMillionTokens: 2.5,
      outputUsdPerMillionTokens: 15,
      maxContextTokens: 1_050_000,
      supportsStructuredOutput: true,
      supportsVisionInput: true,
    }),
    createOpenRouterOption({
      model: "google/gemini-3.1-pro-preview",
      label: "Google Gemini 3.1 Pro Preview",
      inputUsdPerMillionTokens: 2,
      outputUsdPerMillionTokens: 12,
      maxContextTokens: 1_048_576,
      supportsStructuredOutput: true,
      supportsVisionInput: true,
    }),
  ],
  structured_json: [
    createOpenRouterOption({
      model: "google/gemini-2.0-flash-001",
      label: "Google Gemini 2.0 Flash",
      inputUsdPerMillionTokens: 0.1,
      outputUsdPerMillionTokens: 0.4,
      maxContextTokens: 1_000_000,
      supportsStructuredOutput: true,
      supportsVisionInput: true,
    }),
    createOpenRouterOption({
      model: "openai/gpt-4.1-mini",
      label: "OpenAI GPT-4.1 Mini",
      inputUsdPerMillionTokens: 0.4,
      outputUsdPerMillionTokens: 1.6,
      maxContextTokens: 1_047_576,
      supportsStructuredOutput: true,
      supportsVisionInput: true,
    }),
    createOpenRouterOption({
      model: "google/gemini-2.5-flash-lite",
      label: "Google Gemini 2.5 Flash Lite",
      inputUsdPerMillionTokens: 0.1,
      outputUsdPerMillionTokens: 0.4,
      maxContextTokens: 1_048_576,
      supportsStructuredOutput: true,
      supportsVisionInput: true,
    }),
  ],
  vision_classification: [
    createOpenRouterOption({
      model: "google/gemini-2.0-flash-001",
      label: "Google Gemini 2.0 Flash",
      inputUsdPerMillionTokens: 0.1,
      outputUsdPerMillionTokens: 0.4,
      imageUsdPerUnit: 0,
      maxContextTokens: 1_000_000,
      supportsStructuredOutput: true,
      supportsVisionInput: true,
    }),
    createOpenRouterOption({
      model: "openai/gpt-4.1-mini",
      label: "OpenAI GPT-4.1 Mini",
      inputUsdPerMillionTokens: 0.4,
      outputUsdPerMillionTokens: 1.6,
      imageUsdPerUnit: 0.01,
      maxContextTokens: 1_047_576,
      supportsStructuredOutput: true,
      supportsVisionInput: true,
    }),
    createOpenRouterOption({
      model: "qwen/qwen3-vl-32b-instruct",
      label: "Qwen Qwen3 VL 32B Instruct",
      inputUsdPerMillionTokens: 0.104,
      outputUsdPerMillionTokens: 0.416,
      maxContextTokens: 262_144,
      supportsStructuredOutput: true,
      supportsVisionInput: true,
    }),
  ],
  image_draft: [
    createOpenRouterOption({
      model: "google/gemini-2.5-flash-image",
      label: "Google Gemini 2.5 Flash Image",
      inputUsdPerMillionTokens: 0.3,
      outputUsdPerMillionTokens: 0,
      imageUsdPerUnit: 0.3,
      maxContextTokens: 32_768,
      supportsStructuredOutput: true,
      supportsVisionInput: true,
      supportsImageOutput: true,
    }),
    createOpenRouterOption({
      model: "x-ai/grok-imagine-image-quality",
      label: "xAI Grok Imagine Image Quality",
      inputUsdPerMillionTokens: 0,
      outputUsdPerMillionTokens: 0,
      imageUsdPerUnit: 0.01,
      maxContextTokens: 65_536,
      supportsStructuredOutput: true,
      supportsVisionInput: false,
      supportsImageOutput: true,
    }),
    createOpenRouterOption({
      model: "black-forest-labs/flux.2-flex",
      label: "Black Forest Labs FLUX.2 Flex",
      inputUsdPerMillionTokens: 0,
      outputUsdPerMillionTokens: 0,
      imageUsdPerUnit: 0,
      maxContextTokens: 67_344,
      supportsImageOutput: true,
    }),
  ],
  image_final: [
    createOpenRouterOption({
      model: "openai/gpt-5-image",
      label: "OpenAI GPT-5 Image",
      inputUsdPerMillionTokens: 10,
      outputUsdPerMillionTokens: 0,
      imageUsdPerUnit: 0,
      maxContextTokens: 400_000,
      supportsStructuredOutput: true,
      supportsVisionInput: true,
      supportsImageOutput: true,
    }),
    createOpenRouterOption({
      model: "google/gemini-3-pro-image-preview",
      label: "Google Gemini 3 Pro Image Preview",
      inputUsdPerMillionTokens: 2,
      outputUsdPerMillionTokens: 0,
      imageUsdPerUnit: 2,
      maxContextTokens: 65_536,
      supportsStructuredOutput: true,
      supportsVisionInput: true,
      supportsImageOutput: true,
    }),
    createOpenRouterOption({
      model: "black-forest-labs/flux.2-pro",
      label: "Black Forest Labs FLUX.2 Pro",
      inputUsdPerMillionTokens: 0,
      outputUsdPerMillionTokens: 0,
      imageUsdPerUnit: 0,
      maxContextTokens: 46_864,
      supportsImageOutput: true,
    }),
  ],
  compliance_review: [
    createOpenRouterOption({
      model: "google/gemini-2.0-flash-001",
      label: "Google Gemini 2.0 Flash",
      inputUsdPerMillionTokens: 0.1,
      outputUsdPerMillionTokens: 0.4,
      maxContextTokens: 1_000_000,
      supportsStructuredOutput: true,
      supportsVisionInput: true,
    }),
    createOpenRouterOption({
      model: "anthropic/claude-sonnet-4.6",
      label: "Anthropic Claude Sonnet 4.6",
      inputUsdPerMillionTokens: 3,
      outputUsdPerMillionTokens: 15,
      maxContextTokens: 1_000_000,
      supportsStructuredOutput: true,
    }),
    createOpenRouterOption({
      model: "openai/gpt-4.1-mini",
      label: "OpenAI GPT-4.1 Mini",
      inputUsdPerMillionTokens: 0.4,
      outputUsdPerMillionTokens: 1.6,
      maxContextTokens: 1_047_576,
      supportsStructuredOutput: true,
      supportsVisionInput: true,
    }),
  ],
  disabled_profile: [],
};

const PROFILE_SECTION_MAP: Array<{
  key: string;
  label: string;
  description: string;
  profileKeys: ModelProfileKey[];
}> = [
  {
    key: "research",
    label: "Research",
    description: "Competitor research, pattern classification, and public evidence processing.",
    profileKeys: ["cheap_draft_text", "vision_classification", "structured_json"],
  },
  {
    key: "campaigns",
    label: "Campaigns",
    description: "Campaign strategy, hooks, recommendations, and structured campaign objects.",
    profileKeys: ["high_quality_strategy", "structured_json"],
  },
  {
    key: "creative",
    label: "Creative",
    description: "Draft and client-ready image generation profiles.",
    profileKeys: ["image_draft", "image_final"],
  },
  {
    key: "compliance",
    label: "Compliance",
    description: "Real-estate claim, housing targeting, and policy review outputs.",
    profileKeys: ["compliance_review"],
  },
  {
    key: "agents",
    label: "Agent Workforce",
    description: "Agent planning and internal operational outputs.",
    profileKeys: ["cheap_draft_text", "structured_json", "high_quality_strategy"],
  },
  {
    key: "reporting",
    label: "Reporting",
    description: "Performance summaries and cost-aware internal reporting.",
    profileKeys: ["cheap_draft_text", "structured_json"],
  },
];

function createOpenRouterOption(
  option: Omit<ModelCatalogOption, "provider" | "imageUsdPerUnit" | "supportsStructuredOutput" | "supportsVisionInput" | "supportsImageOutput"> &
    Partial<Pick<ModelCatalogOption, "imageUsdPerUnit" | "supportsStructuredOutput" | "supportsVisionInput" | "supportsImageOutput">>,
): ModelCatalogOption {
  return {
    provider: "openrouter",
    imageUsdPerUnit: 0,
    supportsStructuredOutput: false,
    supportsVisionInput: false,
    supportsImageOutput: false,
    ...option,
    model: normalizeModelSlug("openrouter", option.model),
  };
}

export function getOpenRouterReadiness(env: EnvLike = process.env as EnvLike): OpenRouterReadiness {
  const missing = env.OPENROUTER_API_KEY ? [] : ["OPENROUTER_API_KEY"];

  return {
    configured: missing.length === 0,
    missing,
    appUrl: env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL,
  };
}

export function getCuratedModelOptionsForProfile(profileKey: ModelProfileKey): ModelCatalogOption[] {
  return CURATED_OPENROUTER_OPTIONS[profileKey].map((option) => ({ ...option }));
}

export function getCuratedModelOptionsWithCatalog(
  profileKey: ModelProfileKey,
  catalogOptions: ModelCatalogOption[] = [],
): ModelCatalogOption[] {
  const catalogByModel = new Map(catalogOptions.map((option) => [option.model, option]));

  return getCuratedModelOptionsForProfile(profileKey).map((option) => ({
    ...option,
    ...catalogByModel.get(option.model),
  }));
}

export function validateModelProfileSelection(
  profileKeyValue: string,
  request: SelectionRequest,
): SelectionValidationResult {
  if (!isModelProfileKey(profileKeyValue)) {
    return {
      ok: false,
      status: 404,
      error: `Unknown model profile: ${profileKeyValue}`,
    };
  }

  if (request.provider !== "openrouter") {
    return {
      ok: false,
      status: 400,
      error: "Only OpenRouter model selections can be saved from Model Control.",
    };
  }

  if (typeof request.model !== "string" || request.model.trim().length === 0) {
    return {
      ok: false,
      status: 400,
      error: "A model id is required.",
    };
  }

  const normalizedModel = normalizeModelSlug("openrouter", request.model.trim());
  const option = getCuratedModelOptionsForProfile(profileKeyValue).find(
    (candidate) => candidate.provider === request.provider && candidate.model === normalizedModel,
  );

  if (!option) {
    const profile = listModelProfiles().find((candidate) => candidate.key === profileKeyValue);

    return {
      ok: false,
      status: 400,
      error: `${normalizedModel} is not approved for ${profile?.label ?? profileKeyValue}.`,
    };
  }

  return {
    ok: true,
    option,
  };
}

export function buildModelProfileVersionInsert(
  modelProfileId: string,
  option: ModelCatalogOption,
): ModelProfileVersionInsert {
  return {
    model_profile_id: modelProfileId,
    provider: option.provider,
    model: normalizeModelSlug(option.provider, option.model),
    input_usd_per_million_tokens: option.inputUsdPerMillionTokens,
    output_usd_per_million_tokens: option.outputUsdPerMillionTokens,
    image_usd_per_unit: option.imageUsdPerUnit,
    supports_structured_output: option.supportsStructuredOutput,
    max_context_tokens: option.maxContextTokens,
  };
}

export function buildModelControlViewData(
  args: {
    profiles?: ModelProfile[];
    env?: EnvLike;
    catalogOptions?: ModelCatalogOption[];
  } = {},
): ModelControlViewData {
  const modelProfiles = args.profiles ?? resolveEffectiveModelProfiles();
  const profileMap = new Map(modelProfiles.map((profile) => [profile.key, profile]));

  const sections = PROFILE_SECTION_MAP.map((section) => {
    const rows = section.profileKeys.flatMap((profileKey) => {
      const profile = profileMap.get(profileKey);

      if (!profile) {
        return [];
      }

      return [buildModelControlProfileRow(profile, args.catalogOptions)];
    });

    return {
      key: section.key,
      label: section.label,
      description: section.description,
      profiles: rows,
    };
  }).filter((section) => section.profiles.length > 0);

  return {
    sections,
    modelProfiles,
    readiness: {
      openrouter: getOpenRouterReadiness(args.env),
    },
  };
}

function buildModelControlProfileRow(
  profile: ModelProfile,
  catalogOptions: ModelCatalogOption[] = [],
): ModelControlProfileRow {
  return {
    key: profile.key,
    label: profile.label,
    task: profile.task,
    enabled: profile.enabled,
    requiresStructuredOutput: profile.requiresStructuredOutput,
    maxRunCostUsd: profile.maxRunCostUsd,
    defaultTemperature: profile.defaultTemperature,
    active: {
      ...profile.primary,
      model: normalizeModelSlug(profile.primary.provider, profile.primary.model),
    },
    fallbacks: profile.fallbacks.map((fallback) => ({
      ...fallback,
      model: normalizeModelSlug(fallback.provider, fallback.model),
    })),
    options: getOptionsWithActiveCandidate(profile, catalogOptions),
  };
}

function getOptionsWithActiveCandidate(
  profile: ModelProfile,
  catalogOptions: ModelCatalogOption[],
): ModelCatalogOption[] {
  const curated = getCuratedModelOptionsWithCatalog(profile.key, catalogOptions);
  const activeOption = modelCandidateToOption(profile.primary, "Current primary");
  const hasActiveOption = curated.some(
    (option) => option.provider === activeOption.provider && option.model === activeOption.model,
  );

  return hasActiveOption ? curated : [activeOption, ...curated];
}

function modelCandidateToOption(candidate: ModelCandidate, labelSuffix: string): ModelCatalogOption {
  return {
    provider: candidate.provider,
    model: normalizeModelSlug(candidate.provider, candidate.model),
    label: `${candidate.model} (${labelSuffix})`,
    inputUsdPerMillionTokens: candidate.inputUsdPerMillionTokens,
    outputUsdPerMillionTokens: candidate.outputUsdPerMillionTokens,
    imageUsdPerUnit: candidate.imageUsdPerUnit,
    maxContextTokens: candidate.maxContextTokens,
    supportsStructuredOutput: candidate.supportsStructuredOutput,
    supportsVisionInput: candidate.imageUsdPerUnit > 0 || candidate.maxContextTokens >= 128_000,
    supportsImageOutput: candidate.imageUsdPerUnit > 0 && candidate.inputUsdPerMillionTokens === 0,
  };
}

export function optionToCandidate(option: ModelCatalogOption): ModelCandidate {
  return {
    provider: option.provider,
    model: normalizeModelSlug(option.provider, option.model),
    inputUsdPerMillionTokens: option.inputUsdPerMillionTokens,
    outputUsdPerMillionTokens: option.outputUsdPerMillionTokens,
    imageUsdPerUnit: option.imageUsdPerUnit,
    supportsStructuredOutput: option.supportsStructuredOutput,
    maxContextTokens: option.maxContextTokens,
    maxLatencyMs: DEFAULT_MAX_LATENCY_MS,
  };
}
