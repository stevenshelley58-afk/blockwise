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

export type EnvLike = {
  NEXT_PUBLIC_APP_URL?: string;
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
  readiness: Record<string, never>;
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

const DEFAULT_MAX_LATENCY_MS = 12_000;

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
    description: "Draft and client-ready image generation profiles for cloning and targeted edits.",
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

// Curated catalog of known-good models the operator can switch any compatible
// profile to. Pricing is pre-filled from provider list prices so the per-run
// cost caps stay accurate. Capability flags drive which profiles each model is
// offered for (see getCuratedModelOptionsForProfile) and gate custom entries.
const MODEL_CATALOG: ModelCatalogOption[] = [
  {
    provider: "deepseek",
    model: "deepseek-chat",
    label: "deepseek-chat · cheapest text (no client PII)",
    inputUsdPerMillionTokens: 0.27,
    outputUsdPerMillionTokens: 1.1,
    imageUsdPerUnit: 0,
    maxContextTokens: 128_000,
    supportsStructuredOutput: true,
    supportsVisionInput: false,
    supportsImageOutput: false,
  },
  {
    provider: "google",
    model: "gemini-3.1-flash-lite",
    label: "gemini-3.1-flash-lite · budget all-rounder",
    inputUsdPerMillionTokens: 0.25,
    outputUsdPerMillionTokens: 1.5,
    imageUsdPerUnit: 0,
    maxContextTokens: 1_000_000,
    supportsStructuredOutput: true,
    supportsVisionInput: true,
    supportsImageOutput: false,
  },
  {
    provider: "google",
    model: "gemini-3.6-flash",
    label: "gemini-3.6-flash · strongest Flash vision",
    inputUsdPerMillionTokens: 1.5,
    outputUsdPerMillionTokens: 7.5,
    imageUsdPerUnit: 0,
    maxContextTokens: 1_000_000,
    supportsStructuredOutput: true,
    supportsVisionInput: true,
    supportsImageOutput: false,
  },
  {
    provider: "openai",
    model: "gpt-4.1",
    label: "gpt-4.1 · reliable structured output",
    inputUsdPerMillionTokens: 2,
    outputUsdPerMillionTokens: 8,
    imageUsdPerUnit: 0,
    maxContextTokens: 128_000,
    supportsStructuredOutput: true,
    supportsVisionInput: true,
    supportsImageOutput: false,
  },
  {
    provider: "openai",
    model: "gpt-5.5",
    label: "gpt-5.5 · flagship reasoning",
    inputUsdPerMillionTokens: 5,
    outputUsdPerMillionTokens: 30,
    imageUsdPerUnit: 0,
    maxContextTokens: 1_000_000,
    supportsStructuredOutput: true,
    supportsVisionInput: true,
    supportsImageOutput: false,
  },
  {
    provider: "google",
    model: "gemini-3.1-flash-image",
    label: "gemini-3.1-flash-image · draft images",
    inputUsdPerMillionTokens: 0.5,
    outputUsdPerMillionTokens: 3,
    imageUsdPerUnit: 0.04,
    maxContextTokens: 131_072,
    supportsStructuredOutput: false,
    supportsVisionInput: true,
    supportsImageOutput: true,
  },
  {
    provider: "openai",
    model: "gpt-image-2",
    label: "gpt-image-2 · client-ready images",
    inputUsdPerMillionTokens: 5,
    outputUsdPerMillionTokens: 30,
    imageUsdPerUnit: 0.211,
    maxContextTokens: 16_000,
    supportsStructuredOutput: false,
    supportsVisionInput: true,
    supportsImageOutput: true,
  },
  {
    provider: "openai",
    model: "gpt-image-1.5",
    label: "gpt-image-1.5 · cheaper final images",
    inputUsdPerMillionTokens: 5,
    outputUsdPerMillionTokens: 10,
    imageUsdPerUnit: 0.133,
    maxContextTokens: 16_000,
    supportsStructuredOutput: false,
    supportsVisionInput: true,
    supportsImageOutput: true,
  },
];

const IMAGE_PROFILE_KEYS: ModelProfileKey[] = ["image_draft", "image_final"];

function isImageProfileKey(profileKey: ModelProfileKey): boolean {
  return IMAGE_PROFILE_KEYS.includes(profileKey);
}

export function getCuratedModelOptionsForProfile(profileKey: ModelProfileKey): ModelCatalogOption[] {
  const imageProfile = isImageProfileKey(profileKey);
  const visionProfile = profileKey === "vision_classification";
  const requiresStructured = listModelProfiles().find((profile) => profile.key === profileKey)?.requiresStructuredOutput ?? false;

  return MODEL_CATALOG.filter((option) => {
    if (imageProfile) return option.supportsImageOutput;
    // Text profiles never surface image-only generators.
    if (option.supportsImageOutput) return false;
    if (requiresStructured && !option.supportsStructuredOutput) return false;
    if (visionProfile && !option.supportsVisionInput) return false;
    return true;
  });
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

const SAVED_PROVIDERS: ModelProvider[] = ["openai", "azure", "google", "deepseek"];

// A custom model the operator types in by hand carries no persisted pricing, so
// we assume provider list prices are roughly right and let the per-run cost cap
// do the guarding. These defaults are intentionally conservative.
const CUSTOM_MODEL_DEFAULTS = {
  inputUsdPerMillionTokens: 3,
  outputUsdPerMillionTokens: 15,
  imageUsdPerUnit: 0.05,
  maxContextTokens: 128_000,
};

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

  if (typeof request.provider !== "string" || !SAVED_PROVIDERS.includes(request.provider as ModelProvider)) {
    return {
      ok: false,
      status: 400,
      error: "That provider cannot be saved from Model Control.",
    };
  }

  if (typeof request.model !== "string" || request.model.trim().length === 0) {
    return {
      ok: false,
      status: 400,
      error: "A model id is required.",
    };
  }

  const provider = request.provider as ModelProvider;
  const normalizedModel = normalizeModelSlug(provider, request.model.trim());
  const profile = listModelProfiles().find((candidate) => candidate.key === profileKeyValue);
  const profileKey = profileKeyValue as ModelProfileKey;

  // 1) Curated catalog (or an already-configured primary/fallback) wins so the
  //    saved row carries real pricing and capability flags.
  const catalogMatch = [
    ...getCuratedModelOptionsForProfile(profileKey),
    ...(profile ? [profile.primary, ...profile.fallbacks].map((candidate) => modelCandidateToOption(candidate, "Approved")) : []),
  ].find((option) => option.provider === provider && normalizeModelSlug(option.provider, option.model) === normalizedModel);

  if (catalogMatch) {
    return { ok: true, option: catalogMatch };
  }

  // 2) Custom escape hatch: the operator explicitly typed a model id that is not
  //    in the catalog. Guard only on the profile's hard capability requirements;
  //    a free-text model id is otherwise trusted to exist at the provider.
  const capabilityViolation = capabilityViolationForProfile(profileKey, provider);
  if (capabilityViolation) {
    return {
      ok: false,
      status: 400,
      error: `${provider} cannot serve ${profile?.label ?? profileKey}: ${capabilityViolation}.`,
    };
  }

  return {
    ok: true,
    option: {
      provider,
      model: normalizedModel,
      label: `${normalizedModel} (custom)`,
      inputUsdPerMillionTokens: CUSTOM_MODEL_DEFAULTS.inputUsdPerMillionTokens,
      outputUsdPerMillionTokens: CUSTOM_MODEL_DEFAULTS.outputUsdPerMillionTokens,
      imageUsdPerUnit: isImageProfileKey(profileKey) ? CUSTOM_MODEL_DEFAULTS.imageUsdPerUnit : 0,
      maxContextTokens: CUSTOM_MODEL_DEFAULTS.maxContextTokens,
      supportsStructuredOutput: !isImageProfileKey(profileKey),
      supportsVisionInput: !isImageProfileKey(profileKey),
      supportsImageOutput: isImageProfileKey(profileKey),
    },
  };
}

// Hard capability gates that a custom model must clear for a profile. Returning
// a human-readable reason (or null) keeps the API error actionable.
function capabilityViolationForProfile(profileKey: ModelProfileKey, provider: ModelProvider): string | null {
  if (profileKey === "vision_classification" && provider === "deepseek") {
    return "deepseek has no vision input";
  }

  if (isImageProfileKey(profileKey) && !(provider === "openai" || provider === "google")) {
    return "only openai and google generate images";
  }

  return null;
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
    readiness: {},
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
