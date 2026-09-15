import { randomUUID } from "node:crypto";

import {
  createTextProviderForCandidate,
  type ProviderEnvironment,
} from "./ai-providers.ts";
import type { TextProviderAdapter, TextProviderResponse } from "./providers.ts";
import { assembleMetaCopyPrompt } from "../operator/prompts/assemble-prompt.ts";
import {
  isProviderFallbackEligible,
  modelCandidateAttempts,
  resolveRuntimeModelProfile,
} from "../operator/prompts/model-profile-runtime.ts";
import { getActivePromptBundle, type PromptKey } from "../operator/prompts/prompt-registry.ts";
import {
  executeAdBuilderProviderAttempt,
  ProviderRunPersistenceError,
  recordAdBuilderProviderRun,
  type ProviderRunAttempt,
} from "../operator/prompts/redact-prompt-run.ts";
import {
  META_COPY_CTA_VALUES,
  META_COPY_CONSTRAINTS,
  truncateAtWordBoundary,
  type AdBuilderMetaCopy,
} from "./meta-copy-contract.ts";
import { toMetaCta } from "./meta-cta.ts";

export type AdBuilderCopyFields = AdBuilderMetaCopy;

export type AdBuilderAiWritingGuidance = {
  summary: string;
  fields: Record<string, string>;
};

export type AdBuilderCopyRequestBody = {
  mode?: "generate" | "brief" | "assist";
  brief?: string;
  assistAction?: string;
  copy?: Partial<AdBuilderCopyFields>;
  /**
   * Image the copy should be grounded in, already resolved to a model-consumable
   * reference (`data:` URL or absolute http(s) URL). See resolveAdBuilderImageForModel.
   */
  sourceImageUrl?: string;
  context?: {
    goal?: string;
    offer?: string;
    market?: string;
    propertyType?: string;
    businessName?: string;
    templateName?: string;
    templateHint?: string;
    /** Brand kit voice - dominates wording style. */
    voice?: string;
    preferredPhrases?: string[];
    neverSay?: string[];
    aiWritingGuidance?: AdBuilderAiWritingGuidance;
  };
};

export type AdBuilderCopyGenerationInput = AdBuilderCopyRequestBody & {
  workspaceId: string;
  userId: string;
  correlationId?: string;
  /** Explicit service-runtime credentials; web requests use process.env. */
  providerEnv?: ProviderEnvironment;
  signal?: AbortSignal;
};

export type AdBuilderCopyGenerationResponse = {
  copy: AdBuilderCopyFields;
  alternates: {
    headline: string[];
    primaryText: string[];
  };
  source: "ai";
};

type CopyGenerationResult = {
  output: TextProviderResponse;
  provider: TextProviderAdapter;
  modelName: string;
  attempts: ProviderRunAttempt[];
};

const IMAGE_GROUNDING_INSTRUCTION =
  "An image of the advertised property is attached. Ground the copy in what is actually visible in it — the property's style, setting, and standout features — and do not invent details that contradict the image.";

const PRIMARY_TEXT_FORMATTING_INSTRUCTION =
  "Primary text must read like a real Meta lead ad: return one string with actual newline characters, starting with a one-line hook followed by 2-4 short benefit or offer lines. Preserve those newlines in JSON, use no hashtags, and use emoji only when the brand voice explicitly calls for it. Keep the wording compliant with Meta Housing rules.";

const COPY_PROMPT_KEYS: PromptKey[] = [
  "adbuilder.copy.system",
  "adbuilder.copy.input_template",
  "adbuilder.copy.output_schema",
  "adbuilder.copy.compliance_rules",
];

/** @deprecated Use META_COPY_CONSTRAINTS from ./meta-copy-contract.ts. */
export const ADBUILDER_COPY_LIMITS = META_COPY_CONSTRAINTS;

export const ADBUILDER_GUIDANCE_LIMITS = {
  summary: 600,
  field: 240,
  fields: 40,
} as const;

export function normalizeAdBuilderAiWritingGuidance(value: unknown): AdBuilderAiWritingGuidance | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const summary = typeof record.summary === "string" ? record.summary.trim().slice(0, ADBUILDER_GUIDANCE_LIMITS.summary) : "";
  const rawFields = record.fields && typeof record.fields === "object" && !Array.isArray(record.fields)
    ? record.fields as Record<string, unknown>
    : {};
  const fields: Record<string, string> = {};
  for (const [key, guidance] of Object.entries(rawFields).slice(0, ADBUILDER_GUIDANCE_LIMITS.fields)) {
    if (typeof guidance !== "string") continue;
    const cleanKey = key.trim().slice(0, 100);
    const cleanGuidance = guidance.trim().slice(0, ADBUILDER_GUIDANCE_LIMITS.field);
    if (cleanKey && cleanGuidance) fields[cleanKey] = cleanGuidance;
  }
  return summary || Object.keys(fields).length ? { summary, fields } : undefined;
}

export async function generateAdBuilderCopy(
  input: AdBuilderCopyGenerationInput,
): Promise<AdBuilderCopyGenerationResponse> {
  const startedAt = Date.now();
  const correlationId = input.correlationId ?? randomUUID();
  const mutationId = `${correlationId}:adbuilder.copy`;
  const bundle = await getActivePromptBundle(COPY_PROMPT_KEYS);
  const assembled = assembleMetaCopyPrompt({
    bundle,
    mode: input.mode ?? "generate",
    context: input.context ?? {},
    brief: input.brief,
    currentCopy: input.copy,
    assistAction: input.assistAction,
  });
  const imageUrl = usableModelImage(input.sourceImageUrl);
  const userPrompt = [
    assembled.user,
    PRIMARY_TEXT_FORMATTING_INSTRUCTION,
    imageUrl ? IMAGE_GROUNDING_INSTRUCTION : "",
  ].filter(Boolean).join("\n\n");
  let generation: CopyGenerationResult | null = null;
  let finalizationStarted = false;

  try {
    generation = await generateCopyWithProfile(assembled.system, userPrompt, imageUrl, {
      workspaceId: input.workspaceId,
      mutationId,
    }, input.providerEnv, input.signal);
    const output = generation.output;
    const json = (output.json ?? {}) as Record<string, unknown>;
    const normalizedCopy = normalizeAdBuilderCopy(json, input.copy);

    finalizationStarted = true;
    await recordAdBuilderProviderRun({
      workspaceId: input.workspaceId,
      userId: input.userId,
      correlationId,
      taskType: "adbuilder.copy",
      modelProfile: "structured_json",
      mutationId,
      prompt: assembled,
      input: generationLogInput(input),
      attempts: generation.attempts,
      latencyMs: Date.now() - startedAt,
      providerName: generation.provider.providerName,
      providerType: generation.provider.providerType,
      modelName: generation.modelName,
      output,
      status: "completed",
    });

    return {
      copy: {
        ...normalizedCopy,
      },
      alternates: {
        headline: clampList(json.altHeadlines, META_COPY_CONSTRAINTS.headline),
        primaryText: clampList(json.altPrimaryTexts, META_COPY_CONSTRAINTS.primaryText),
      },
      source: "ai",
    };
  } catch (error) {
    if (finalizationStarted) throw error;
    const terminalError = error instanceof CopyCascadeError && error.cause instanceof ProviderRunPersistenceError
      ? error.cause
      : error;
    await recordAdBuilderProviderRun({
      workspaceId: input.workspaceId,
      userId: input.userId,
      correlationId,
      taskType: "adbuilder.copy",
      modelProfile: "structured_json",
      mutationId,
      prompt: assembled,
      input: generationLogInput(input),
      attempts: error instanceof CopyCascadeError ? error.attempts : generation?.attempts ?? [],
      latencyMs: Date.now() - startedAt,
      providerName: generation?.provider.providerName ?? "unavailable",
      providerType: "text_generation",
      modelName: generation?.modelName ?? "unavailable",
      output: null,
      status: "failed",
      error: terminalError,
    });
    throw terminalError;
  }
}

export type AdBuilderTemplateCopyFieldSpec = {
  key: string;
  label: string;
  maxLength?: number;
  /** The template's sample value — tone/shape reference only, never final text. */
  sample?: string;
};

export type AdBuilderTemplateCopyInput = {
  workspaceId: string;
  userId: string;
  correlationId?: string;
  /** The user's brief ("Open home Saturday, 18 Smith St Scarborough..."). */
  description: string;
  /** The on-image text fields the selected template declares. */
  fields: AdBuilderTemplateCopyFieldSpec[];
  sourceImageUrl?: string;
  context?: AdBuilderCopyRequestBody["context"];
  /** Explicit service-runtime credentials; web requests use process.env. */
  providerEnv?: ProviderEnvironment;
  signal?: AbortSignal;
};

export type AdBuilderTemplateCopyResponse = {
  /** Values for every declared field key — the text rendered ON the ad image. */
  onImage: Record<string, string>;
  /** Meta feed copy shown around the image. */
  copy: AdBuilderCopyFields;
  source: "ai";
};

const ON_IMAGE_INSTRUCTION_HEADER =
  "This ad is built from a design template with fixed text elements printed ON the image. " +
  "In addition to the standard output fields, return an \"onImage\" JSON object with EXACTLY these keys. " +
  "Write each value from the user's brief and brand context. Match the tone, length, and shape of each " +
  "sample value, but NEVER reuse the sample's facts (addresses, suburbs, prices, names, dates) — those " +
  "are placeholder examples from a different campaign.";

/**
 * One structured call that writes the complete copy set for a template ad:
 * the on-image field values (baked into the generated image by the clone) AND
 * the Meta feed copy around it — all grounded in the same brief so they tell
 * one story.
 */
export async function generateAdBuilderTemplateCopy(
  input: AdBuilderTemplateCopyInput,
): Promise<AdBuilderTemplateCopyResponse> {
  const startedAt = Date.now();
  const correlationId = input.correlationId ?? randomUUID();
  const mutationId = `${correlationId}:adbuilder.template_copy`;
  const bundle = await getActivePromptBundle(COPY_PROMPT_KEYS);
  const assembled = assembleMetaCopyPrompt({
    bundle,
    mode: "brief",
    context: input.context ?? {},
    brief: input.description,
  });
  const fieldLines = input.fields
    .map((field) => {
      const limit = field.maxLength ? `, max ${field.maxLength} characters` : "";
      const sample = field.sample ? ` — sample for tone/shape only: "${field.sample}"` : "";
      return `- "${field.key}" (${field.label}${limit})${sample}`;
    })
    .join("\n");
  const imageUrl = usableModelImage(input.sourceImageUrl);
  const userPrompt = [
    assembled.user,
    PRIMARY_TEXT_FORMATTING_INSTRUCTION,
    `${ON_IMAGE_INSTRUCTION_HEADER}\n${fieldLines}`,
    imageUrl ? IMAGE_GROUNDING_INSTRUCTION : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  let generation: CopyGenerationResult | null = null;
  let finalizationStarted = false;

  try {
    generation = await generateCopyWithProfile(assembled.system, userPrompt, imageUrl, {
      workspaceId: input.workspaceId,
      mutationId,
    }, input.providerEnv, input.signal);
    const json = (generation.output.json ?? {}) as Record<string, unknown>;
    const normalizedCopy = normalizeAdBuilderCopy(json);
    const onImage = normalizeAdBuilderOnImage(json.onImage, input.fields);

    finalizationStarted = true;
    await recordAdBuilderProviderRun({
      workspaceId: input.workspaceId,
      userId: input.userId,
      correlationId,
      taskType: "adbuilder.template_copy",
      modelProfile: "structured_json",
      mutationId,
      prompt: assembled,
      input: { description: input.description, fields: input.fields, context: input.context ?? {} },
      attempts: generation.attempts,
      latencyMs: Date.now() - startedAt,
      providerName: generation.provider.providerName,
      providerType: generation.provider.providerType,
      modelName: generation.modelName,
      output: generation.output,
      status: "completed",
    });

    return {
      onImage,
      copy: {
        ...normalizedCopy,
      },
      source: "ai",
    };
  } catch (error) {
    if (finalizationStarted) throw error;
    const terminalError = error instanceof CopyCascadeError && error.cause instanceof ProviderRunPersistenceError
      ? error.cause
      : error;
    await recordAdBuilderProviderRun({
      workspaceId: input.workspaceId,
      userId: input.userId,
      correlationId,
      taskType: "adbuilder.template_copy",
      modelProfile: "structured_json",
      mutationId,
      prompt: assembled,
      input: { description: input.description, fields: input.fields, context: input.context ?? {} },
      attempts: error instanceof CopyCascadeError ? error.attempts : generation?.attempts ?? [],
      latencyMs: Date.now() - startedAt,
      providerName: generation?.provider.providerName ?? "unavailable",
      providerType: "text_generation",
      modelName: generation?.modelName ?? "unavailable",
      output: null,
      status: "failed",
      error: terminalError,
    });
    throw terminalError;
  }
}

function generationLogInput(input: AdBuilderCopyGenerationInput) {
  return {
    mode: input.mode ?? "generate",
    context: input.context ?? {},
    brief: input.brief,
    copy: input.copy,
    assistAction: input.assistAction,
  };
}

export class AdBuilderCopyNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdBuilderCopyNormalizationError";
  }
}

/**
 * Normalize provider payloads at the paid boundary. Providers sometimes
 * return a singular string where the schema asks for an array (or use the
 * plural field names from Meta's publish pack). Missing required fields fail
 * explicitly; they never become a silent empty string.
 */
export function normalizeAdBuilderCopy(
  value: Record<string, unknown>,
  _current?: Partial<AdBuilderCopyFields>,
): AdBuilderCopyFields {
  const primaryText = normalizeRequiredCopyField(
    firstProviderString(value.primaryText ?? value.primaryTexts ?? value.primary_text),
    META_COPY_CONSTRAINTS.primaryText,
    "primary text",
  );
  const headline = normalizeRequiredCopyField(
    firstProviderString(value.headline ?? value.headlines),
    META_COPY_CONSTRAINTS.headline,
    "headline",
  );
  const description = normalizeRequiredCopyField(
    firstProviderString(value.description ?? value.descriptions),
    META_COPY_CONSTRAINTS.description,
    "description",
  );
  const rawCta = firstProviderString(value.cta ?? value.callToAction);
  const cta = normalizeProviderCta(rawCta);
  return { primaryText, headline, description, cta };
}

function normalizeRequiredCopyField(
  value: string | undefined,
  limit: number,
  field: string,
): string {
  const text = (value ?? "").trim();
  if (!text) throw new AdBuilderCopyNormalizationError(`Provider returned no ${field}.`);
  return truncateAtWordBoundary(text, limit);
}

function firstProviderString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    const first = value.find((item): item is string => typeof item === "string" && item.trim().length > 0);
    return first?.trim();
  }
  return undefined;
}

function normalizeProviderCta(value: string | undefined): string {
  const text = value?.trim() ?? "";
  if (!text) throw new AdBuilderCopyNormalizationError("Provider returned no CTA.");
  const mapped = toMetaCta(text);
  if (META_COPY_CTA_VALUES.includes(mapped)) return mapped;
  throw new AdBuilderCopyNormalizationError(`Provider returned an unsupported CTA: ${text}.`);
}

function clampList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, 2)
    .map((item) => truncateAtWordBoundary(item, limit));
}

/** Normalize every declared on-image field without inventing campaign facts. */
export function normalizeAdBuilderOnImage(
  value: unknown,
  fields: AdBuilderTemplateCopyFieldSpec[],
): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AdBuilderCopyNormalizationError("Provider returned no on-image copy object.");
  }
  const rawFields = value as Record<string, unknown>;
  return Object.fromEntries(fields.map((field) => {
    const raw = typeof rawFields[field.key] === "string" ? (rawFields[field.key] as string).trim() : "";
    if (!raw) throw new AdBuilderCopyNormalizationError(`Provider returned no on-image field: ${field.key}.`);
    return [field.key, field.maxLength ? truncateAtWordBoundary(raw, field.maxLength) : raw];
  }));
}

export { truncateAtWordBoundary } from "./meta-copy-contract.ts";

// Only forward references a vision model can actually read.
function usableModelImage(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  return ref.startsWith("data:image/") || /^https?:\/\//i.test(ref) ? ref : undefined;
}

async function generateCopyWithProfile(
  system: string,
  user: string,
  imageUrl?: string,
  reservation?: { workspaceId: string; mutationId: string },
  providerEnv?: ProviderEnvironment,
  signal?: AbortSignal,
): Promise<CopyGenerationResult> {
  const profile = await resolveRuntimeModelProfile("structured_json");
  const candidates = modelCandidateAttempts(profile);
  const attempts: CopyGenerationResult["attempts"] = [];

  for (const [index, candidate] of candidates.entries()) {
    const provider = createTextProviderForCandidate(candidate, { env: providerEnv });
    if (!reservation) {
      throw new Error("Provider accounting reservation context is required.");
    }
    let execution;
    try {
      execution = await executeAdBuilderProviderAttempt<TextProviderResponse>({
        workspaceId: reservation.workspaceId,
        mutationId: reservation.mutationId,
        attemptIndex: index,
        modelProfile: "structured_json",
        provider,
        execute: () => provider.generate({
          system,
          schemaName: "metaLeadAdPack",
          messages: [{ role: "user", content: user }],
          imageUrl,
          signal,
        }),
      });
    } catch (error) {
      throw new CopyCascadeError(error instanceof Error ? error.message : String(error), attempts, { cause: error });
    }
    attempts.push(execution.attempt);
    if (execution.ok) {
      const output = execution.output;
      return {
        output,
        provider,
        modelName: String(output.providerMetadata.model ?? candidate.model),
        attempts,
      };
    }

    if (!isProviderFallbackEligible(execution.error)) break;
  }

  // Carry the per-candidate outcomes on the error: the failure-path provider
  // run must record WHICH models failed and why, not just the last message —
  // losing this is how a dead provider key masqueraded as an OpenAI quota
  // problem for half a day.
  // The dialog shows this message: summarize EVERY lane's failure instead of
  // quoting whichever provider happened to speak last (that masked a fal
  // parsing bug behind OpenAI's quota message for hours).
  const summary = attempts
    .filter((attempt) => attempt.status === "failed")
    .map((attempt) => `${attempt.provider} (${attempt.model}): ${attempt.error ?? "failed"}`)
    .join(" · ")
    .slice(0, 600);
  const failure = new CopyCascadeError(
    summary || "Copy generation is not configured. Add AZURE_OPENAI_API_KEY or OPENAI_API_KEY to enable it.",
    attempts,
  );
  throw failure;
}

class CopyCascadeError extends Error {
  readonly attempts: CopyGenerationResult["attempts"];

  constructor(message: string, attempts: CopyGenerationResult["attempts"], options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CopyCascadeError";
    this.attempts = attempts;
  }
}
