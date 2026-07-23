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

export function getCuratedModelOptionsForProfile(_profileKey: ModelProfileKey): ModelCatalogOption[] {
  // No curated third-party catalog options remain.
  return [];
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

const SAVED_PROVIDERS: ModelProvider[] = ["openai", "azure", "google"];

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

  // Validate against the profile's own configured candidates (primary + fallbacks).
  const profile = listModelProfiles().find((candidate) => candidate.key === profileKeyValue);
  const candidates = profile ? [profile.primary, ...profile.fallbacks] : [];
  const matched = candidates.find(
    (candidate) =>
      candidate.provider === provider && normalizeModelSlug(candidate.provider, candidate.model) === normalizedModel,
  );

  if (!matched) {
    return {
      ok: false,
      status: 400,
      error: `${normalizedModel} is not approved for ${profile?.label ?? profileKeyValue}.`,
    };
  }

  return {
    ok: true,
    option: modelCandidateToOption(matched, "Approved"),
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
