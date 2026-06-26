import type { WorkforceDataClass } from "../workforce/permissions.ts";

export type ModelProvider = "openai" | "openrouter" | "azure";

export type ModelProfileKey =
  | "cheap_draft_text"
  | "high_quality_strategy"
  | "structured_json"
  | "vision_classification"
  | "image_draft"
  | "image_final"
  | "image_generative"
  | "compliance_review"
  | "disabled_profile";

export type ModelCandidate = {
  provider: ModelProvider;
  model: string;
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
  imageUsdPerUnit: number;
  supportsStructuredOutput: boolean;
  maxContextTokens: number;
  maxLatencyMs: number;
};

export type ModelProfile = {
  key: ModelProfileKey;
  label: string;
  task: string;
  enabled: boolean;
  requiresStructuredOutput: boolean;
  maxRunCostUsd: number;
  defaultTemperature: number;
  primary: ModelCandidate;
  fallbacks: ModelCandidate[];
};

export type UsageEstimate = {
  inputTokens: number;
  outputTokens: number;
  imageUnits?: number;
};

export type ResolvedModelProfile = {
  profile: ModelProfile;
  primary: ModelCandidate;
  fallbacks: ModelCandidate[];
};

export type PersistedModelProfileVersion = {
  profileKey: ModelProfileKey;
  provider: ModelProvider;
  model: string;
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
  imageUsdPerUnit: number;
  supportsStructuredOutput: boolean;
  maxContextTokens: number;
  maxLatencyMs: number;
};

const SENSITIVE_DATA_CLASSES: WorkforceDataClass[] = ["lead_pii", "provider_token"];

const PROVIDER_CLIENT_DATA_POLICY: Record<ModelProvider, "allowed" | "public_only"> = {
  openai: "allowed",
  openrouter: "allowed",
  azure: "allowed",
};

const MODEL_PROFILES: Record<ModelProfileKey, ModelProfile> = {
  cheap_draft_text: {
    key: "cheap_draft_text",
    label: "Cheap draft text",
    task: "Low-risk copy, summaries, and internal drafts",
    enabled: true,
    requiresStructuredOutput: false,
    maxRunCostUsd: 0.08,
    defaultTemperature: 0.7,
    primary: {
      provider: "openai",
      model: "gpt-4.1-mini",
      inputUsdPerMillionTokens: 0.4,
      outputUsdPerMillionTokens: 1.6,
      imageUsdPerUnit: 0,
      supportsStructuredOutput: true,
      maxContextTokens: 128_000,
      maxLatencyMs: 8_000,
    },
    fallbacks: [
      {
        provider: "openrouter",
        model: "google/gemini-2.0-flash-001",
        inputUsdPerMillionTokens: 0.1,
        outputUsdPerMillionTokens: 0.4,
        imageUsdPerUnit: 0,
        supportsStructuredOutput: true,
        maxContextTokens: 1_000_000,
        maxLatencyMs: 8_000,
      },
    ],
  },
  high_quality_strategy: {
    key: "high_quality_strategy",
    label: "High quality strategy",
    task: "Campaign strategy, offer development, and operator-reviewed recommendations",
    enabled: true,
    requiresStructuredOutput: false,
    maxRunCostUsd: 0.75,
    defaultTemperature: 0.5,
    primary: {
      provider: "openai",
      model: "gpt-5.5",
      inputUsdPerMillionTokens: 5,
      outputUsdPerMillionTokens: 30,
      imageUsdPerUnit: 0,
      supportsStructuredOutput: true,
      maxContextTokens: 1_000_000,
      maxLatencyMs: 12_000,
    },
    fallbacks: [
      {
        provider: "openrouter",
        model: "openai/gpt-5.5",
        inputUsdPerMillionTokens: 5,
        outputUsdPerMillionTokens: 30,
        imageUsdPerUnit: 0,
        supportsStructuredOutput: true,
        maxContextTokens: 1_000_000,
        maxLatencyMs: 16_000,
      },
    ],
  },
  structured_json: {
    key: "structured_json",
    label: "Structured JSON",
    task: "Schema-bound classifications, planning outputs, and internal objects",
    enabled: true,
    requiresStructuredOutput: true,
    // best now, cost-tune later — operator can dial internal stages back per-profile.
    maxRunCostUsd: 0.5,
    defaultTemperature: 0.2,
    primary: {
      provider: "openai",
      model: "gpt-5.5",
      inputUsdPerMillionTokens: 5,
      outputUsdPerMillionTokens: 30,
      imageUsdPerUnit: 0,
      supportsStructuredOutput: true,
      maxContextTokens: 1_000_000,
      maxLatencyMs: 12_000,
    },
    fallbacks: [
      {
        provider: "openai",
        model: "gpt-4.1",
        inputUsdPerMillionTokens: 2,
        outputUsdPerMillionTokens: 8,
        imageUsdPerUnit: 0,
        supportsStructuredOutput: true,
        maxContextTokens: 128_000,
        maxLatencyMs: 16_000,
      },
      {
        provider: "openrouter",
        model: "google/gemini-2.0-flash-001",
        inputUsdPerMillionTokens: 0.1,
        outputUsdPerMillionTokens: 0.4,
        imageUsdPerUnit: 0,
        supportsStructuredOutput: true,
        maxContextTokens: 1_000_000,
        maxLatencyMs: 8_000,
      },
    ],
  },
  vision_classification: {
    key: "vision_classification",
    label: "Vision classification",
    task: "Observed ad screenshots, landing page captures, and creative classification",
    enabled: true,
    requiresStructuredOutput: true,
    // best now, cost-tune later. gpt-5.5 is natively vision-capable.
    maxRunCostUsd: 0.6,
    defaultTemperature: 0.1,
    primary: {
      provider: "openai",
      model: "gpt-5.5",
      inputUsdPerMillionTokens: 5,
      outputUsdPerMillionTokens: 30,
      imageUsdPerUnit: 0.01,
      supportsStructuredOutput: true,
      maxContextTokens: 1_000_000,
      maxLatencyMs: 12_000,
    },
    fallbacks: [],
  },
  image_draft: {
    key: "image_draft",
    label: "Image draft",
    task: "Low-cost draft images, thumbnails, and internal creative exploration",
    enabled: true,
    requiresStructuredOutput: false,
    maxRunCostUsd: 0.8,
    defaultTemperature: 0.8,
    primary: {
      provider: "openai",
      model: "gpt-image-1-mini",
      inputUsdPerMillionTokens: 0,
      outputUsdPerMillionTokens: 0,
      imageUsdPerUnit: 0.04,
      supportsStructuredOutput: false,
      maxContextTokens: 16_000,
      maxLatencyMs: 30_000,
    },
    fallbacks: [],
  },
  image_final: {
    key: "image_final",
    label: "Image final",
    task: "Client-ready creative assets that require higher image quality",
    enabled: true,
    requiresStructuredOutput: false,
    maxRunCostUsd: 2,
    defaultTemperature: 0.65,
    primary: {
      provider: "openai",
      model: "gpt-image-2",
      inputUsdPerMillionTokens: 5,
      outputUsdPerMillionTokens: 30,
      imageUsdPerUnit: 0.211,
      supportsStructuredOutput: false,
      maxContextTokens: 16_000,
      maxLatencyMs: 60_000,
    },
    fallbacks: [
      {
        provider: "openai",
        model: "gpt-image-1.5",
        inputUsdPerMillionTokens: 5,
        outputUsdPerMillionTokens: 10,
        imageUsdPerUnit: 0.133,
        supportsStructuredOutput: false,
        maxContextTokens: 16_000,
        maxLatencyMs: 60_000,
      },
    ],
  },
  image_generative: {
    key: "image_generative",
    label: "Image generative",
    task: "Fully generative ad creatives (\"Create more options\") from a brief plus the user's photo",
    enabled: true,
    requiresStructuredOutput: false,
    maxRunCostUsd: 2.5,
    defaultTemperature: 0.85,
    primary: {
      provider: "openai",
      model: "gpt-image-2",
      inputUsdPerMillionTokens: 5,
      outputUsdPerMillionTokens: 30,
      imageUsdPerUnit: 0.211,
      supportsStructuredOutput: false,
      maxContextTokens: 16_000,
      maxLatencyMs: 60_000,
    },
    fallbacks: [
      {
        provider: "openai",
        model: "gpt-image-1.5",
        inputUsdPerMillionTokens: 5,
        outputUsdPerMillionTokens: 10,
        imageUsdPerUnit: 0.133,
        supportsStructuredOutput: false,
        maxContextTokens: 16_000,
        maxLatencyMs: 60_000,
      },
    ],
  },
  compliance_review: {
    key: "compliance_review",
    label: "Compliance review",
    task: "AU real-estate claim, housing targeting, urgency, and unsupported performance checks",
    enabled: true,
    requiresStructuredOutput: true,
    maxRunCostUsd: 0.4,
    defaultTemperature: 0.1,
    primary: {
      provider: "openai",
      model: "gpt-4.1-mini",
      inputUsdPerMillionTokens: 0.4,
      outputUsdPerMillionTokens: 1.6,
      imageUsdPerUnit: 0,
      supportsStructuredOutput: true,
      maxContextTokens: 128_000,
      maxLatencyMs: 8_000,
    },
    fallbacks: [
      {
        provider: "openai",
        model: "gpt-4.1",
        inputUsdPerMillionTokens: 2,
        outputUsdPerMillionTokens: 8,
        imageUsdPerUnit: 0,
        supportsStructuredOutput: true,
        maxContextTokens: 128_000,
        maxLatencyMs: 16_000,
      },
    ],
  },
  disabled_profile: {
    key: "disabled_profile",
    label: "Disabled profile",
    task: "Operator kill switch fixture",
    enabled: false,
    requiresStructuredOutput: false,
    maxRunCostUsd: 0.01,
    defaultTemperature: 0,
    primary: {
      provider: "openai",
      model: "disabled",
      inputUsdPerMillionTokens: 0,
      outputUsdPerMillionTokens: 0,
      imageUsdPerUnit: 0,
      supportsStructuredOutput: false,
      maxContextTokens: 0,
      maxLatencyMs: 0,
    },
    fallbacks: [],
  },
};

export function listModelProfiles(): ModelProfile[] {
  return Object.values(MODEL_PROFILES);
}

export function isModelProfileKey(value: string): value is ModelProfileKey {
  return Object.prototype.hasOwnProperty.call(MODEL_PROFILES, value);
}

export function normalizeModelSlug(provider: ModelProvider, model: string): string {
  if (provider === "openrouter" && model.startsWith("openrouter/")) {
    return model.replace(/^openrouter\//, "");
  }
  if (provider === "azure" && model.startsWith("azure/")) {
    return model.replace(/^azure\//, "");
  }

  return model;
}

export function resolveModelProfile(profileKey: ModelProfileKey): ResolvedModelProfile {
  const profile = MODEL_PROFILES[profileKey];

  if (!profile) {
    throw new Error(`Unknown model profile: ${profileKey}`);
  }

  return {
    profile,
    primary: profile.primary,
    fallbacks: profile.fallbacks,
  };
}

export function resolveEffectiveModelProfile(
  profileKey: ModelProfileKey,
  versions: PersistedModelProfileVersion[] = [],
): ResolvedModelProfile {
  const resolved = resolveModelProfile(profileKey);
  const override = versions.find((version) => version.profileKey === profileKey);

  if (!override) {
    return resolved;
  }

  const primary: ModelCandidate = {
    provider: override.provider,
    model: normalizeModelSlug(override.provider, override.model),
    inputUsdPerMillionTokens: override.inputUsdPerMillionTokens,
    outputUsdPerMillionTokens: override.outputUsdPerMillionTokens,
    imageUsdPerUnit: override.imageUsdPerUnit,
    supportsStructuredOutput: override.supportsStructuredOutput,
    maxContextTokens: override.maxContextTokens,
    maxLatencyMs: override.maxLatencyMs,
  };

  return {
    profile: {
      ...resolved.profile,
      primary,
    },
    primary,
    fallbacks: resolved.fallbacks,
  };
}

export function resolveEffectiveModelProfiles(
  versions: PersistedModelProfileVersion[] = [],
): ModelProfile[] {
  return listModelProfiles().map((profile) => resolveEffectiveModelProfile(profile.key, versions).profile);
}

export function resolveModelProfileForData(
  profileKey: ModelProfileKey,
  request: { dataClasses: WorkforceDataClass[] },
): ResolvedModelProfile {
  const resolved = resolveModelProfile(profileKey);

  if (!resolved.profile.enabled) {
    throw new Error(`Model profile ${resolved.profile.key} is disabled by operator kill switch.`);
  }

  const containsSensitiveClientData = request.dataClasses.some((dataClass) =>
    SENSITIVE_DATA_CLASSES.includes(dataClass),
  );

  if (!containsSensitiveClientData) {
    return resolved;
  }

  if (!canCandidateHandleSensitiveClientData(resolved.primary)) {
    throw new Error(`Primary model provider ${resolved.primary.provider} is not approved for sensitive client data.`);
  }

  return {
    ...resolved,
    fallbacks: resolved.fallbacks.filter(canCandidateHandleSensitiveClientData),
  };
}

export function estimateRunCostUsd(candidate: ModelCandidate, usage: UsageEstimate): number {
  const inputCost = (usage.inputTokens / 1_000_000) * candidate.inputUsdPerMillionTokens;
  const outputCost = (usage.outputTokens / 1_000_000) * candidate.outputUsdPerMillionTokens;
  const imageCost = (usage.imageUnits ?? 0) * candidate.imageUsdPerUnit;

  return Math.round((inputCost + outputCost + imageCost + Number.EPSILON) * 100) / 100;
}

export function shouldBlockForCostPolicy(
  profileKey: ModelProfileKey,
  request: { estimatedCostUsd: number },
): { blocked: boolean; reason?: string } {
  const { profile } = resolveModelProfile(profileKey);

  if (!profile.enabled) {
    return {
      blocked: true,
      reason: `Model profile ${profile.key} is disabled by operator kill switch.`,
    };
  }

  if (request.estimatedCostUsd > profile.maxRunCostUsd) {
    return {
      blocked: true,
      reason: `Estimated run cost $${request.estimatedCostUsd.toFixed(2)} exceeds ${profile.key} max run cost $${profile.maxRunCostUsd.toFixed(2)}.`,
    };
  }

  return { blocked: false };
}

function canCandidateHandleSensitiveClientData(candidate: ModelCandidate): boolean {
  return PROVIDER_CLIENT_DATA_POLICY[candidate.provider] === "allowed";
}
