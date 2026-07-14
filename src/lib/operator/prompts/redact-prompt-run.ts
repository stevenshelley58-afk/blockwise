import { createHash, randomUUID } from "node:crypto";

import type { ModelProfileKey } from "../../ai/model-registry.ts";
import { estimateRunCostUsd } from "../../ai/model-registry.ts";
import { ProviderRequestError } from "../../adstudio/providers.ts";
import type {
  ImageProviderAdapter,
  ImageProviderResponse,
  ProviderPricingSnapshot,
  ProviderUsage,
  TextProviderAdapter,
  TextProviderResponse,
} from "../../adstudio/providers.ts";
import { recordAuditLog as writeAuditLog } from "../../supabase/audit.ts";
import { createSupabaseServiceClient } from "../../supabase/service.ts";

import type { AssembledPrompt } from "./assemble-prompt.ts";

export type RedactedProviderRunInput = {
  taskType:
    | "adstudio.copy"
    | "adstudio.template_copy"
    | "adstudio.image"
    | "adstudio.clone"
    | "adstudio.clone_qa"
    | "adstudio.background"
    | "adstudio.scoring";
  modelProfile: ModelProfileKey;
  correlationId?: string;
  userId?: string | null;
  prompt: AssembledPrompt;
  input: Record<string, unknown>;
  mutationId?: string;
  attempts?: ProviderRunAttempt[];
  latencyMs?: number;
};

export type ProviderRunBillingStatus = "actual" | "estimated" | "unbilled" | "unreconciled";

export type ProviderRunAttempt = {
  attemptIndex: number;
  provider: string;
  providerType: "text_generation" | "image_generation";
  model: string;
  modelProfile: ModelProfileKey;
  modelProfileVersionId: string | null;
  pricingSnapshotId: string | null;
  status: "failed" | "completed";
  requestSubmitted: boolean;
  billingStatus: ProviderRunBillingStatus;
  providerRequestId: string | null;
  usage: Required<Pick<ProviderUsage, "inputTokens" | "outputTokens" | "imageUnits" | "complete">>;
  pricing: ProviderPricingSnapshot;
  estimatedCostUsd: number;
  actualCostUsd: number | null;
  error?: string;
};

export type ProviderRunAccounting = {
  usage: { inputTokens: number; outputTokens: number; imageUnits: number };
  estimatedCostUsd: number;
  actualCostUsd: number | null;
  preferredCostUsd: number;
  billingStatus: ProviderRunBillingStatus;
};

export type ProviderAttemptExecution<T extends TextProviderResponse | ImageProviderResponse> =
  | { ok: true; output: T; attempt: ProviderRunAttempt }
  | { ok: false; error: unknown; attempt: ProviderRunAttempt };

export class ProviderRunPersistenceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProviderRunPersistenceError";
  }
}

export type ProviderRunLogInput = RedactedProviderRunInput & {
  workspaceId: string;
  providerName: string;
  providerType: "text_generation" | "image_generation";
  modelName: string;
  output: TextProviderResponse | ImageProviderResponse | null;
  status: "completed" | "failed";
  error?: unknown;
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

export function buildProviderRunAttempt(input: {
  attemptIndex: number;
  provider: TextProviderAdapter | ImageProviderAdapter;
  modelProfile: ModelProfileKey;
  status: "failed" | "completed";
  output?: TextProviderResponse | ImageProviderResponse | null;
  error?: unknown;
}): ProviderRunAttempt {
  const providerError = input.error instanceof ProviderRequestError ? input.error : null;
  const outputUsage = input.output?.usage;
  const usageSource = outputUsage ?? providerError?.usage;
  const successfulImage = input.status === "completed" && input.provider.providerType === "image_generation";
  const usage = {
    inputTokens: finiteNonNegative(usageSource?.inputTokens),
    outputTokens: finiteNonNegative(usageSource?.outputTokens),
    imageUnits: Math.max(finiteNonNegative(usageSource?.imageUnits), successfulImage ? 1 : 0),
    // Completion is provider evidence, not something success status may infer.
    // A successful image without returned usage is still at least one image,
    // but its bill is deliberately unreconciled rather than silently estimated.
    complete: usageSource?.complete === true,
  };
  const pricing = input.provider.accounting?.pricing ?? zeroPricingSnapshot();
  const requestSubmitted = providerError?.requestSubmitted ?? (input.status === "completed" || Boolean(input.error));
  const actualCostUsd = finiteMoney(usageSource?.actualCostUsd);
  const hasExactPricing = Boolean(input.provider.accounting);
  const estimatedCostUsd = requestSubmitted && usage.complete && hasExactPricing
    ? estimateRunCostUsd(
        {
          provider: "openai",
          model: input.provider.accounting?.model ?? input.provider.providerName,
          ...pricing,
          supportsStructuredOutput: false,
          maxContextTokens: 0,
          maxLatencyMs: 0,
        },
        usage,
      )
    : 0;
  const billingStatus: ProviderRunBillingStatus = !requestSubmitted
    ? "unbilled"
    : actualCostUsd !== null
      ? "actual"
      : usage.complete && hasExactPricing
        ? "estimated"
        : "unreconciled";

  return {
    attemptIndex: input.attemptIndex,
    provider: input.provider.providerName,
    providerType: input.provider.providerType,
    model: input.provider.accounting?.model ?? modelFromOutput(input.output) ?? input.provider.providerName,
    modelProfile: input.modelProfile,
    modelProfileVersionId: input.provider.accounting?.modelProfileVersionId ?? null,
    pricingSnapshotId: input.provider.accounting?.pricingSnapshotId ?? null,
    status: input.status,
    requestSubmitted,
    billingStatus,
    providerRequestId: usageSource?.providerRequestId ?? providerError?.providerRequestId ?? null,
    usage,
    pricing,
    estimatedCostUsd,
    actualCostUsd,
    ...(input.error ? { error: errorSummary(input.error) } : {}),
  };
}

export async function reserveAdStudioProviderAttempt(input: {
  workspaceId: string;
  mutationId: string;
  attemptIndex: number;
  modelProfile: ModelProfileKey;
  provider: TextProviderAdapter | ImageProviderAdapter;
}): Promise<void> {
  const accounting = input.provider.accounting;
  if (!accounting) {
    throw new ProviderRunPersistenceError(
      `Provider ${input.provider.providerName} is missing its dispatched pricing snapshot; request was not sent.`,
    );
  }

  let serviceSupabase: ReturnType<typeof createSupabaseServiceClient>;
  try {
    serviceSupabase = createSupabaseServiceClient();
  } catch (error) {
    throw new ProviderRunPersistenceError("Provider accounting storage is unavailable; request was not sent.", {
      cause: error,
    });
  }

  const reservation = {
    provider: input.provider.providerName,
    provider_type: input.provider.providerType,
    model: accounting.model,
    model_profile: input.modelProfile,
    model_profile_version_id: accounting.modelProfileVersionId ?? null,
    pricing_snapshot_id: accounting.pricingSnapshotId ?? null,
    pricing: accounting.pricing,
  };
  let data: unknown;
  let error: { message: string } | null;
  try {
    const response = await serviceSupabase.rpc("adstudio_reserve_provider_attempt", {
      p_workspace_id: input.workspaceId,
      p_mutation_id: input.mutationId,
      p_attempt_index: input.attemptIndex,
      p_payload_hash: hashPayload(reservation),
      p_reservation: reservation,
    });
    data = response.data;
    error = response.error;
  } catch (cause) {
    throw new ProviderRunPersistenceError("Provider attempt reservation failed; request was not sent.", { cause });
  }

  if (error) {
    throw new ProviderRunPersistenceError(`Provider attempt could not be reserved: ${error.message}`);
  }
  const acquired = data && typeof data === "object" && !Array.isArray(data)
    ? (data as { acquired?: unknown }).acquired
    : false;
  if (acquired !== true) {
    throw new ProviderRunPersistenceError(
      "Provider attempt reservation was already claimed; duplicate request was not sent.",
    );
  }
}

export async function markAdStudioProviderAttemptSubmitted(input: {
  workspaceId: string;
  mutationId: string;
  attemptIndex: number;
}): Promise<void> {
  await updateProviderAttemptOutbox({
    rpc: "adstudio_mark_provider_attempt_submitted",
    failureMessage: "Provider attempt submission marker failed; request was not sent.",
    input,
  });
}

export async function cancelAdStudioProviderAttempt(input: {
  workspaceId: string;
  mutationId: string;
  attemptIndex: number;
  reason: string;
}): Promise<void> {
  await updateProviderAttemptOutbox({
    rpc: "adstudio_cancel_provider_attempt",
    failureMessage: "Provider attempt cancellation failed.",
    input,
  });
}

/**
 * Owns one external-call lifecycle. Persistence failures throw before another
 * provider can be tried; provider failures return a normalized attempt so the
 * caller may choose an explicitly priced fallback.
 */
export async function executeAdStudioProviderAttempt<T extends TextProviderResponse | ImageProviderResponse>(input: {
  workspaceId: string;
  mutationId: string;
  attemptIndex: number;
  modelProfile: ModelProfileKey;
  provider: TextProviderAdapter | ImageProviderAdapter;
  execute(): Promise<T>;
}): Promise<ProviderAttemptExecution<T>> {
  await reserveAdStudioProviderAttempt(input);

  try {
    await markAdStudioProviderAttemptSubmitted(input);
  } catch (error) {
    // The request has not been invoked. Close the durable claim when possible;
    // the finalizer can also synthesize an unbilled recovery attempt if this
    // cancellation write itself is unavailable.
    try {
      await cancelAdStudioProviderAttempt({ ...input, reason: errorSummary(error) });
    } catch (cancelError) {
      throw new ProviderRunPersistenceError(
        `Provider dispatch was blocked and its reservation could not be closed: ${errorSummary(cancelError)}`,
        { cause: error },
      );
    }
    throw error;
  }

  let output: T | null = null;
  try {
    output = await input.execute();
    return {
      ok: true,
      output,
      attempt: buildProviderRunAttempt({
        attemptIndex: input.attemptIndex,
        provider: input.provider,
        modelProfile: input.modelProfile,
        status: "completed",
        output,
      }),
    };
  } catch (error) {
    if (error instanceof ProviderRequestError && !error.requestSubmitted) {
      await cancelAdStudioProviderAttempt({
        ...input,
        reason: errorSummary(error),
      });
    }
    return {
      ok: false,
      error,
      attempt: buildProviderRunAttempt({
        attemptIndex: input.attemptIndex,
        provider: input.provider,
        modelProfile: input.modelProfile,
        status: "failed",
        output,
        error,
      }),
    };
  }
}

export function buildProviderRunAccounting(
  attempts: Array<Pick<ProviderRunAttempt, "billingStatus" | "estimatedCostUsd" | "actualCostUsd" | "usage">>,
): ProviderRunAccounting {
  const estimatedCostUsd = attempts.reduce((sum, attempt) => sum + finiteNonNegative(attempt.estimatedCostUsd), 0);
  const hasIncompleteActualCost = attempts.some(
    (attempt) => attempt.billingStatus === "estimated" || attempt.billingStatus === "unreconciled",
  );
  const actualAttempts = attempts.filter((attempt) => attempt.billingStatus === "actual");
  const actualCostUsd = hasIncompleteActualCost || actualAttempts.length === 0
    ? null
    : actualAttempts.reduce((sum, attempt) => sum + (finiteMoney(attempt.actualCostUsd) ?? 0), 0);
  const preferredCostUsd = attempts.reduce((sum, attempt) => {
    if (attempt.billingStatus === "actual") return sum + (finiteMoney(attempt.actualCostUsd) ?? 0);
    if (attempt.billingStatus === "estimated") return sum + finiteNonNegative(attempt.estimatedCostUsd);
    return sum;
  }, 0);
  const billingStatus: ProviderRunBillingStatus = attempts.some((attempt) => attempt.billingStatus === "unreconciled")
    ? "unreconciled"
    : attempts.some((attempt) => attempt.billingStatus === "estimated")
      ? "estimated"
      : actualAttempts.length > 0
        ? "actual"
        : "unbilled";

  return {
    usage: {
      inputTokens: attempts.reduce((sum, attempt) => sum + finiteNonNegative(attempt.usage.inputTokens), 0),
      outputTokens: attempts.reduce((sum, attempt) => sum + finiteNonNegative(attempt.usage.outputTokens), 0),
      imageUnits: attempts.reduce((sum, attempt) => sum + finiteNonNegative(attempt.usage.imageUnits), 0),
    },
    estimatedCostUsd,
    actualCostUsd,
    preferredCostUsd,
    billingStatus,
  };
}

export async function recordAdStudioProviderRun(input: ProviderRunLogInput): Promise<void> {
  let serviceSupabase: ReturnType<typeof createSupabaseServiceClient>;
  try {
    serviceSupabase = createSupabaseServiceClient();
  } catch (error) {
    throw new ProviderRunPersistenceError("Provider accounting storage is unavailable.", { cause: error });
  }

  const attempts = input.attempts ?? [];
  const accounting = buildProviderRunAccounting(attempts);
  const redactedInput = buildRedactedProviderRunInput(input);
  const outputSummary = summarizeOutput(input.output);
  const mutationId = input.mutationId ?? defaultMutationId(input, redactedInput);
  const identity = deriveProviderRunIdentity(input, attempts);
  const run = {
    user_id: input.userId ?? null,
    correlation_id: input.correlationId ?? null,
    prompt_version_id: input.prompt.promptVersions.find((version) => version.id)?.id ?? null,
    task_type: input.taskType,
    model_profile: identity.modelProfile,
    model_profile_version_id: identity.modelProfileVersionId,
    pricing_snapshot_id: identity.pricingSnapshotId,
    provider_name: identity.providerName,
    provider_type: identity.providerType,
    model_name: identity.modelName,
    input_json: redactedInput,
    output_json: outputSummary,
    usage_json: accounting.usage,
    estimated_cost_usd: accounting.estimatedCostUsd,
    actual_cost_usd: accounting.actualCostUsd,
    preferred_cost_usd: accounting.preferredCostUsd,
    billing_status: accounting.billingStatus,
    status: input.status,
    error_json: input.error ? { summary: errorSummary(input.error) } : null,
    result_summary: input.output ? summarizeRunResult(input.output) : null,
    completed_at: new Date().toISOString(),
  };
  // completed_at is operational metadata, not semantic request content. Exclude
  // it so a retry with the same mutation id has the same idempotency hash.
  const payloadHash = buildProviderRunPayloadHash(run, attempts);
  let data: unknown;
  let error: { message: string } | null;
  try {
    const response = await serviceSupabase.rpc("adstudio_record_provider_run", {
      p_workspace_id: input.workspaceId,
      p_mutation_id: mutationId,
      p_payload_hash: payloadHash,
      p_run: run,
      p_attempts: attempts,
    });
    data = response.data;
    error = response.error;
  } catch (cause) {
    throw new ProviderRunPersistenceError("Failed to record Ad Studio provider run.", { cause });
  }

  if (error) {
    throw new ProviderRunPersistenceError(`Failed to record Ad Studio provider run: ${error.message}`);
  }

  const ids = data && typeof data === "object" && !Array.isArray(data)
    ? data as { provider_run_id?: unknown; ai_run_id?: unknown; ai_usage_ledger_id?: unknown }
    : {};

  await runAuditAfterDurableAccounting(() =>
    recordAuditLog({
      serviceSupabase,
      input,
      providerRunId: typeof ids.provider_run_id === "string" ? ids.provider_run_id : null,
      aiRunId: typeof ids.ai_run_id === "string" ? ids.ai_run_id : null,
      ledgerId: typeof ids.ai_usage_ledger_id === "string" ? ids.ai_usage_ledger_id : null,
      accounting,
    }),
  );
}

export async function runAuditAfterDurableAccounting(writeAudit: () => Promise<void>): Promise<void> {
  try {
    await writeAudit();
  } catch (error) {
    console.error("Failed to record Ad Studio provider run audit", errorSummary(error));
  }
}

async function recordAuditLog(input: {
  serviceSupabase: ReturnType<typeof createSupabaseServiceClient>;
  input: ProviderRunLogInput;
  providerRunId: string | null;
  aiRunId: string | null;
  ledgerId: string | null;
  accounting: ProviderRunAccounting;
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
      estimated_cost_usd: input.accounting.estimatedCostUsd,
      actual_cost_usd: input.accounting.actualCostUsd,
      preferred_cost_usd: input.accounting.preferredCostUsd,
      billing_status: input.accounting.billingStatus,
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

export function estimateAdStudioProviderRunCostUsd(input: ProviderRunLogInput): number {
  return buildProviderRunAccounting(input.attempts ?? []).preferredCostUsd;
}

function errorSummary(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function buildProviderRunPayloadHash(
  run: Record<string, unknown>,
  attempts: Array<Record<string, unknown>> | ProviderRunAttempt[],
): string {
  return hashPayload({ run: { ...run, completed_at: null }, attempts });
}

function defaultMutationId(input: ProviderRunLogInput, redactedInput: Record<string, unknown>): string {
  const operation = input.correlationId ?? randomUUID();
  return `${operation}:${input.taskType}:${hashValue(JSON.stringify(redactedInput))}`;
}

async function updateProviderAttemptOutbox(input: {
  rpc: "adstudio_mark_provider_attempt_submitted" | "adstudio_cancel_provider_attempt";
  failureMessage: string;
  input: { workspaceId: string; mutationId: string; attemptIndex: number; reason?: string };
}): Promise<void> {
  let serviceSupabase: ReturnType<typeof createSupabaseServiceClient>;
  try {
    serviceSupabase = createSupabaseServiceClient();
  } catch (error) {
    throw new ProviderRunPersistenceError(input.failureMessage, { cause: error });
  }

  try {
    const args = {
      p_workspace_id: input.input.workspaceId,
      p_mutation_id: input.input.mutationId,
      p_attempt_index: input.input.attemptIndex,
      ...(input.rpc === "adstudio_cancel_provider_attempt"
        ? { p_reason: input.input.reason ?? "pre-dispatch cancellation" }
        : {}),
    };
    const response = await serviceSupabase.rpc(input.rpc, args);
    if (response.error) {
      throw new Error(response.error.message);
    }
    const updated = response.data && typeof response.data === "object" && !Array.isArray(response.data)
      ? (response.data as { updated?: unknown }).updated
      : false;
    if (updated !== true) {
      throw new Error("provider attempt lifecycle transition was rejected");
    }
  } catch (error) {
    throw new ProviderRunPersistenceError(`${input.failureMessage} ${errorSummary(error)}`, { cause: error });
  }
}

function finiteNonNegative(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function finiteMoney(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function zeroPricingSnapshot(): ProviderPricingSnapshot {
  return {
    inputUsdPerMillionTokens: 0,
    outputUsdPerMillionTokens: 0,
    imageUsdPerUnit: 0,
  };
}

function modelFromOutput(output: TextProviderResponse | ImageProviderResponse | null | undefined): string | null {
  if (!output) return null;
  if ("model" in output) return output.model;
  return typeof output.providerMetadata.model === "string" ? output.providerMetadata.model : null;
}

function lastAttempt(attempts: ProviderRunAttempt[]): ProviderRunAttempt | null {
  return attempts.length > 0 ? attempts[attempts.length - 1] : null;
}

export function deriveProviderRunIdentity(
  input: Pick<ProviderRunLogInput, "providerName" | "providerType" | "modelName" | "modelProfile">,
  attempts: ProviderRunAttempt[],
): {
  providerName: string;
  providerType: ProviderRunLogInput["providerType"];
  modelName: string;
  modelProfile: ModelProfileKey;
  modelProfileVersionId: string | null;
  pricingSnapshotId: string | null;
} {
  const ordered = [...attempts].sort((left, right) => left.attemptIndex - right.attemptIndex);
  const representative = [...ordered].reverse().find((attempt) => attempt.status === "completed") ?? lastAttempt(ordered);
  if (!representative) {
    return {
      providerName: input.providerName,
      providerType: input.providerType,
      modelName: input.modelName,
      modelProfile: input.modelProfile,
      modelProfileVersionId: null,
      pricingSnapshotId: null,
    };
  }
  return {
    providerName: representative.provider,
    providerType: representative.providerType,
    modelName: representative.model,
    modelProfile: representative.modelProfile,
    modelProfileVersionId: representative.modelProfileVersionId,
    pricingSnapshotId: representative.pricingSnapshotId,
  };
}
