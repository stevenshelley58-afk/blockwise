import { createHash } from "node:crypto";

import type { ModelCandidate, ModelProfileKey, ModelProvider } from "../../ai/model-registry.ts";
import { estimateRunCostUsd, normalizeModelSlug, resolveModelProfile } from "../../ai/model-registry.ts";
import type { ImageProviderResponse, TextProviderResponse } from "../../adstudio/providers.ts";
import { recordAuditLog as writeAuditLog } from "../../supabase/audit.ts";
import { createSupabaseServiceClient } from "../../supabase/service.ts";

import type { AssembledPrompt } from "./assemble-prompt.ts";

export type RedactedProviderRunInput = {
  taskType: "adstudio.copy" | "adstudio.template_copy" | "adstudio.image" | "adstudio.background" | "adstudio.scoring";
  modelProfile: ModelProfileKey;
  correlationId?: string;
  userId?: string | null;
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
  user_id?: string | null;
  correlation_id?: string | null;
  ai_run_id?: string | null;
  task_type?: string;
  model_profile?: string;
  ai_usage_ledger_id?: string | null;
};

export function buildRedactedProviderRunInput(input: RedactedProviderRunInput): Record<string, unknown> {
  return {
    correlation_id: input.correlationId ?? null,
    user_id: input.userId ?? null,
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

  const usage = usageFromOutput(input);
  const costEstimate = estimateAdStudioProviderRunCostUsd(input, usage);
  const aiRunId = await recordAiRun({
    serviceSupabase,
    input,
    usage,
    costEstimate,
  });
  const ledgerId = await recordAiUsageLedger({
    serviceSupabase,
    input,
    usage,
    costEstimate,
    aiRunId,
  });
  const row: ProviderRunRow = {
    workspace_id: input.workspaceId,
    user_id: input.userId ?? null,
    correlation_id: input.correlationId ?? null,
    ai_run_id: aiRunId,
    task_type: input.taskType,
    model_profile: input.modelProfile,
    ai_usage_ledger_id: ledgerId,
    provider_name: input.providerName,
    provider_type: input.providerType,
    model_name: input.modelName,
    prompt_version_id: input.prompt.promptVersions.find((version) => version.id)?.id ?? null,
    input_json: buildRedactedProviderRunInput(input),
    output_json: summarizeOutput(input.output),
    usage_json: usage,
    cost_estimate: costEstimate,
    status: input.status,
    error_json: input.error ? { summary: errorSummary(input.error) } : null,
  };

  const { data, error } = await serviceSupabase.from("adstudio_provider_runs").insert(row).select("id").maybeSingle();

  if (error) {
    console.error("Failed to record Ad Studio provider run", error.message);
    return;
  }

  await recordAuditLog({
    serviceSupabase,
    input,
    providerRunId: typeof data?.id === "string" ? data.id : null,
    aiRunId,
    ledgerId,
    costEstimate,
  });
}

async function recordAiRun(input: {
  serviceSupabase: ReturnType<typeof createSupabaseServiceClient>;
  input: ProviderRunLogInput;
  usage: Record<string, number>;
  costEstimate: number;
}): Promise<string | null> {
  const { data, error } = await input.serviceSupabase
    .from("ai_runs")
    .insert({
      workspace_id: input.input.workspaceId,
      user_id: input.input.userId ?? null,
      prompt_version_id: input.input.prompt.promptVersions.find((version) => version.id)?.id ?? null,
      provider: input.input.providerName,
      model: input.input.modelName,
      task: input.input.taskType,
      output_type: input.input.providerType === "image_generation" ? "image" : "json",
      status: input.input.status === "completed" ? "completed" : "failed",
      input_tokens: input.usage.inputTokens ?? 0,
      output_tokens: input.usage.outputTokens ?? 0,
      image_units: input.usage.imageUnits ?? 0,
      estimated_cost_cents: Math.round(input.costEstimate * 100),
      result_summary: input.input.output ? summarizeRunResult(input.input.output) : null,
      error_message: input.input.error ? errorSummary(input.input.error) : null,
      completed_at: new Date().toISOString(),
      correlation_id: input.input.correlationId ?? null,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Failed to record model run", error.message);
    return null;
  }

  return typeof data?.id === "string" ? data.id : null;
}

async function recordAiUsageLedger(input: {
  serviceSupabase: ReturnType<typeof createSupabaseServiceClient>;
  input: ProviderRunLogInput;
  usage: Record<string, number>;
  costEstimate: number;
  aiRunId: string | null;
}): Promise<string | null> {
  const { data, error } = await input.serviceSupabase
    .from("ai_usage_ledger")
    .insert({
      workspace_id: input.input.workspaceId,
      ai_run_id: input.aiRunId,
      user_id: input.input.userId ?? null,
      provider: input.input.providerName,
      model: input.input.modelName,
      task: input.input.taskType,
      output_type: input.input.providerType === "image_generation" ? "image" : "json",
      input_tokens: input.usage.inputTokens ?? 0,
      output_tokens: input.usage.outputTokens ?? 0,
      image_units: input.usage.imageUnits ?? 0,
      estimated_cost_cents: Math.round(input.costEstimate * 100),
      result: input.input.status === "completed" ? "completed" : "failed",
      correlation_id: input.input.correlationId ?? null,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Failed to record usage ledger row", error.message);
    return null;
  }

  return typeof data?.id === "string" ? data.id : null;
}

async function recordAuditLog(input: {
  serviceSupabase: ReturnType<typeof createSupabaseServiceClient>;
  input: ProviderRunLogInput;
  providerRunId: string | null;
  aiRunId: string | null;
  ledgerId: string | null;
  costEstimate: number;
}): Promise<void> {
  if (!input.providerRunId) {
    return;
  }

  await writeAuditLog(input.serviceSupabase, {
    workspaceId: input.input.workspaceId,
    actorProfileId: input.input.userId ?? null,
    action: "adstudio.ai_run",
    targetType: "adstudio_provider_run",
    targetId: input.providerRunId,
    correlationId: input.input.correlationId ?? null,
    metadata: {
      ai_run_id: input.aiRunId,
      ai_usage_ledger_id: input.ledgerId,
      task_type: input.input.taskType,
      model_profile: input.input.modelProfile,
      provider_name: input.input.providerName,
      model_name: input.input.modelName,
      status: input.input.status,
      cost_estimate_usd: input.costEstimate,
    },
  });
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

function summarizeRunResult(output: TextProviderResponse | ImageProviderResponse): string {
  if ("assetUrl" in output) {
    return output.assetUrl ? "image_generated" : "image_missing";
  }

  return typeof output.rawText === "string" ? `json:${output.rawText.length}` : "json";
}

function usageFromOutput(input: ProviderRunLogInput): Record<string, number> {
  const output = input.output;
  if (!output) return {};
  if ("usage" in output) return output.usage as Record<string, number>;

  const completedImageUnits = input.attempts?.filter((attempt) => attempt.status === "completed").length ?? 0;
  return {
    imageUnits: Math.max(output.assetUrl ? 1 : 0, completedImageUnits),
    inputTokens: Number(output.providerMetadata.inputTokens ?? 0),
    outputTokens: Number(output.providerMetadata.outputTokens ?? 0),
  };
}

export function estimateAdStudioProviderRunCostUsd(
  input: ProviderRunLogInput,
  usage: Record<string, number> = usageFromOutput(input),
): number {
  if (!input.output) return 0;
  const candidate = findCostCandidate(input.modelProfile, input.providerName, input.modelName);

  return estimateRunCostUsd(candidate, {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    imageUnits: usage.imageUnits ?? ("assetUrl" in input.output ? 1 : 0),
  });
}

function findCostCandidate(profileKey: ModelProfileKey, providerName: string, modelName: string): ModelCandidate {
  const resolved = resolveModelProfile(profileKey);
  const candidates = [resolved.primary, ...resolved.fallbacks];
  const provider = normalizeProviderName(providerName);
  const normalizedModel = provider ? normalizeModelSlug(provider, modelName) : modelName;

  return (
    candidates.find(
      (candidate) =>
        (!provider || candidate.provider === provider) &&
        normalizeModelSlug(candidate.provider, candidate.model) === normalizedModel,
    ) ??
    candidates.find((candidate) => candidate.model === modelName || normalizeModelSlug(candidate.provider, candidate.model) === normalizedModel) ??
    resolved.primary
  );
}

function normalizeProviderName(providerName: string): ModelProvider | null {
  if (providerName === "openai") return "openai";
  if (providerName === "openrouter") return "openrouter";
  if (providerName === "azure") return "azure";
  return null;
}

function errorSummary(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
