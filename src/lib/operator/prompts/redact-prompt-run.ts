import { createHash } from "node:crypto";

import type { ModelCandidate, ModelProfileKey } from "../../ai/model-registry.ts";
import { estimateRunCostUsd } from "../../ai/model-registry.ts";
import type { ImageProviderResponse, TextProviderResponse } from "../../adstudio/providers.ts";
import { createSupabaseServiceClient } from "../../supabase/service.ts";

import type { AssembledPrompt } from "./assemble-prompt.ts";

export type RedactedProviderRunInput = {
  taskType: "adstudio.copy" | "adstudio.image" | "adstudio.background";
  modelProfile: ModelProfileKey;
  prompt: AssembledPrompt;
  input: Record<string, unknown>;
  attempts?: Array<{ provider: string; model: string; status: "attempted" | "failed" | "completed"; error?: string }>;
  latencyMs?: number;
};

export type ProviderRunLogInput = RedactedProviderRunInput & {
  workspaceId: string;
  providerName: string;
  providerType: "text_generation" | "image_generation";
  modelName: string;
  output: TextProviderResponse | ImageProviderResponse | null;
  status: "completed" | "failed";
  error?: unknown;
};

type ProviderRunRow = {
  workspace_id: string;
  provider_name: string;
  provider_type: string;
  model_name: string;
  prompt_version_id: string | null;
  input_json: Record<string, unknown>;
  output_json: Record<string, unknown>;
  usage_json: Record<string, unknown>;
  cost_estimate: number;
  status: string;
  error_json?: Record<string, unknown> | null;
};

export function buildRedactedProviderRunInput(input: RedactedProviderRunInput): Record<string, unknown> {
  return {
    task_type: input.taskType,
    prompt_versions: input.prompt.promptVersions.map((version) => ({
      key: version.key,
      version: version.version,
      id: version.id,
      source: version.source,
    })),
    model_profile: input.modelProfile,
    redacted_inputs: redactRecord(input.input),
    fallback_prompt_used: input.prompt.fallbackPromptUsed,
    prompt_warnings: input.prompt.warnings,
    attempts: input.attempts ?? [],
    latency_ms: input.latencyMs ?? null,
  };
}

export async function recordAdStudioProviderRun(input: ProviderRunLogInput): Promise<void> {
  let serviceSupabase: ReturnType<typeof createSupabaseServiceClient>;

  try {
    serviceSupabase = createSupabaseServiceClient();
  } catch {
    return;
  }

  const usage = usageFromOutput(input.output);
  const row: ProviderRunRow = {
    workspace_id: input.workspaceId,
    provider_name: input.providerName,
    provider_type: input.providerType,
    model_name: input.modelName,
    prompt_version_id: input.prompt.promptVersions.find((version) => version.id)?.id ?? null,
    input_json: buildRedactedProviderRunInput(input),
    output_json: summarizeOutput(input.output),
    usage_json: usage,
    cost_estimate: estimateCost(input.output, input.modelName, usage),
    status: input.status,
    error_json: input.error ? { summary: errorSummary(input.error) } : null,
  };

  const { error } = await serviceSupabase.from("adstudio_provider_runs").insert(row);

  if (error) {
    console.error("Failed to record Ad Studio provider run", error.message);
  }
}

export function redactRecord(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, redactValue(key, value)]));
}

export function redactText(value: string): {
  length: number;
  hash: string;
  excerpt: string;
  unsafeIntentFlags: string[];
} {
  const stripped = stripSensitiveText(value);
  return {
    length: value.length,
    hash: hashValue(value),
    excerpt: stripped.slice(0, 120),
    unsafeIntentFlags: detectUnsafeIntent(value),
  };
}

function redactValue(key: string, value: unknown): unknown {
  if (typeof value === "string") {
    if (value.startsWith("data:image/")) {
      return redactImageDataUrl(value);
    }
    if (/brief|prompt|copy|text|description|headline|cta/i.test(key)) {
      return redactText(value);
    }
    if (/url|asset|image/i.test(key)) {
      return redactReference(value);
    }
    return stripSensitiveText(value);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 12).map((item, index) => redactValue(`${key}_${index}`, item));
  }

  if (value && typeof value === "object") {
    return redactRecord(value as Record<string, unknown>);
  }

  return value;
}

function redactImageDataUrl(value: string): Record<string, unknown> {
  const mediaType = value.match(/^data:([^;,]+)/)?.[1] ?? "image";
  return {
    kind: "data_url",
    mediaType,
    byteEstimate: Math.round(value.length * 0.75),
    hash: hashValue(value),
  };
}

function redactReference(value: string): Record<string, unknown> | string {
  if (value.startsWith("data:image/")) {
    return redactImageDataUrl(value);
  }

  try {
    const url = new URL(value);
    return {
      host: url.host,
      pathHash: hashValue(url.pathname),
    };
  } catch {
    return stripSensitiveText(value);
  }
}

function stripSensitiveText(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]")
    .replace(/\s+/g, " ")
    .trim();
}

function detectUnsafeIntent(value: string): string[] {
  const flags = new Set<string>();
  const lower = value.toLowerCase();

  if (/(young families|families only|downsizers|retirees|students|singles)/.test(lower)) flags.add("demographic_targeting");
  if (/(guarantee|guaranteed|promise|will sell|highest price|above market)/.test(lower)) flags.add("unsupported_claim");
  if (/(last chance|must act|urgent|limited time)/.test(lower)) flags.add("pressure_language");
  if (/(exclude|avoid|no renters|no children)/.test(lower)) flags.add("exclusionary_language");

  return [...flags];
}

function summarizeOutput(output: TextProviderResponse | ImageProviderResponse | null): Record<string, unknown> {
  if (!output) return {};
  if ("assetUrl" in output) {
    return {
      summary: output.assetUrl.startsWith("data:image/") ? redactImageDataUrl(output.assetUrl) : redactReference(output.assetUrl),
      seed: output.seed,
      model: output.model,
    };
  }

  return {
    summary: typeof output.rawText === "string" ? redactText(output.rawText) : null,
    providerMetadata: output.providerMetadata,
  };
}

function usageFromOutput(output: TextProviderResponse | ImageProviderResponse | null): Record<string, number> {
  if (!output) return {};
  if ("usage" in output) return output.usage as Record<string, number>;

  return {
    imageUnits: output.assetUrl ? 1 : 0,
    inputTokens: Number(output.providerMetadata.inputTokens ?? 0),
    outputTokens: Number(output.providerMetadata.outputTokens ?? 0),
  };
}

function estimateCost(
  output: TextProviderResponse | ImageProviderResponse | null,
  modelName: string,
  usage: Record<string, number>,
): number {
  if (!output) return 0;
  const candidate: ModelCandidate = {
    provider: String(output.providerMetadata.provider ?? "").includes("openrouter") ? "openrouter" : "openai",
    model: modelName,
    inputUsdPerMillionTokens: 0,
    outputUsdPerMillionTokens: 0,
    imageUsdPerUnit: "assetUrl" in output ? 0 : 0,
    supportsStructuredOutput: false,
    maxContextTokens: 0,
    maxLatencyMs: 0,
  };

  return estimateRunCostUsd(candidate, {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    imageUnits: usage.imageUnits ?? ("assetUrl" in output ? 1 : 0),
  });
}

function errorSummary(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
