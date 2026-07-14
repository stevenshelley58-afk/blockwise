// Vision QA for AI-cloned creatives: verifies the EXACT copy strings rendered
// on the generated image and returns normalized bounding boxes for every
// editable element (the regions that power in-place editing).
//
// Baked-in text is clone-first's biggest risk — the model can typo the user's
// headline, suburb, or phone number. One vision call per generation does double
// duty: copy verification (drives the reroll loop) and region detection.

import { randomUUID } from "node:crypto";

import { createTextProviderForCandidate } from "./ai-providers.ts";
import type { TextProviderAdapter, TextProviderResponse } from "./providers.ts";
import type { AdStudioCloneQa, AdStudioCloneRegion } from "./types.ts";
import {
  isRetryableProviderFailure,
  modelCandidateAttempts,
  resolveRuntimeModelProfile,
} from "../operator/prompts/model-profile-runtime.ts";
import { getActivePromptBundle } from "../operator/prompts/prompt-registry.ts";
import {
  executeAdStudioProviderAttempt,
  recordAdStudioProviderRun,
  type ProviderRunAttempt,
} from "../operator/prompts/redact-prompt-run.ts";

export { cloneQaWarnings } from "./clone-qa-warnings.ts";

export type CloneQaInput = {
  workspaceId: string;
  userId: string;
  correlationId?: string;
  /** Model-readable image (data: URL or absolute http(s) URL). */
  imageUrl: string;
  /** Final resolved copy values baked into the image, keyed by field key. */
  expectedCopy: Record<string, string>;
  /** Distinguishes parallel feed/story QA reservations for one generation. */
  format: string;
  attempt: number;
};

/**
 * Normalize representation-only differences while preserving the customer's
 * exact characters. Case and punctuation are content, not layout.
 */
export function normalizeRenderedText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?|\n/g, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function clamp01(value: unknown): number {
  const num = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.min(1, Math.max(0, num));
}

function parseRegions(raw: unknown): AdStudioCloneRegion[] {
  if (!Array.isArray(raw)) return [];
  const regions: AdStudioCloneRegion[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const key = typeof item.key === "string" ? item.key.trim() : "";
    const box = (item.box ?? {}) as Record<string, unknown>;
    if (!key) continue;
    regions.push({
      key,
      kind: item.kind === "image" ? "image" : "text",
      box: {
        x: clamp01(box.x),
        y: clamp01(box.y),
        width: clamp01(box.width),
        height: clamp01(box.height),
      },
    });
  }
  return regions;
}

function parseCopyChecks(
  raw: unknown,
  expectedCopy: Record<string, string>,
): AdStudioCloneQa["copyChecks"] {
  const byKey = new Map<string, { rendered: string }>();
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const item = entry as Record<string, unknown>;
      const key = typeof item.key === "string" ? item.key : "";
      if (!key) continue;
      byKey.set(key, {
        rendered: typeof item.rendered === "string" ? item.rendered : "",
      });
    }
  }

  // Every expected field gets a verdict; a field the model did not report is a miss.
  return Object.entries(expectedCopy).map(([key, expected]) => {
    const reported = byKey.get(key);
    const rendered = reported?.rendered ?? "";
    const exact = rendered.length > 0 && normalizeRenderedText(rendered) === normalizeRenderedText(expected);
    return { key, expected, rendered, exact };
  });
}

export function cloneQaPassed(qa: Pick<AdStudioCloneQa, "copyChecks" | "defects">): boolean {
  return qa.copyChecks.every((check) => check.exact) && qa.defects.length === 0;
}

export function cloneQaMutationId(correlationId: string, format: string, attempt: number): string {
  return `${correlationId}:adstudio.clone_qa:${format}:${attempt}`;
}

/** Human-readable correction fed back into the reroll prompt. */
export function cloneQaCorrectionPrompt(qa: Pick<AdStudioCloneQa, "copyChecks" | "defects">): string {
  const mismatches = qa.copyChecks
    .filter((check) => !check.exact)
    .map((check) => `the ${check.key.replace(/_/g, " ")} must read EXACTLY "${check.expected}"${check.rendered ? ` (previous attempt rendered "${check.rendered}")` : " (it was missing)"}`);
  const defects = qa.defects.map((defect) => `fix: ${defect}`);
  return ["Corrections from review of the previous attempt:", ...mismatches, ...defects].join(" ");
}

export async function runCloneQa(input: CloneQaInput): Promise<AdStudioCloneQa> {
  const startedAt = Date.now();
  const correlationId = input.correlationId ?? randomUUID();
  const mutationId = cloneQaMutationId(correlationId, input.format, input.attempt);
  const bundle = await getActivePromptBundle(["adstudio.clone_qa.v1"]);
  const system = bundle["adstudio.clone_qa.v1"].body;
  const expectedList = Object.entries(input.expectedCopy)
    .map(([key, value]) => `- ${key}: "${value}"`)
    .join("\n");
  const user = `Verify this ad creative. Expected copy:\n${expectedList}`;
  const prompt = {
    system,
    user,
    fullPrompt: `${system}\n\n${user}`,
    promptVersions: [],
    fallbackPromptUsed: false,
    warnings: [],
  };

  const profile = await resolveRuntimeModelProfile("vision_classification");
  const candidates = modelCandidateAttempts(profile);
  const attempts: ProviderRunAttempt[] = [];
  let output: TextProviderResponse | null = null;
  let provider: TextProviderAdapter | null = null;
  let modelName = "unavailable";
  let lastError: unknown = null;

  for (const [attemptIndex, candidate] of candidates.entries()) {
    const candidateProvider = createTextProviderForCandidate(candidate);
    try {
      const execution = await executeAdStudioProviderAttempt<TextProviderResponse>({
        workspaceId: input.workspaceId,
        mutationId,
        attemptIndex,
        modelProfile: "vision_classification",
        provider: candidateProvider,
        execute: () => candidateProvider.generate({
          system,
          schemaName: "metaLeadAdPack",
          imageUrl: input.imageUrl,
          messages: [{ role: "user", content: user }],
        }),
      });
      attempts.push(execution.attempt);
      if (!execution.ok) {
        lastError = execution.error;
        if (!isRetryableProviderFailure(execution.error)) break;
        continue;
      }
      output = execution.output;
      provider = candidateProvider;
      modelName = String(output.providerMetadata.model ?? candidate.model);
      break;
    } catch (error) {
      lastError = error;
      break;
    }
  }

  await recordAdStudioProviderRun({
    workspaceId: input.workspaceId,
    userId: input.userId,
    correlationId,
    taskType: "adstudio.clone_qa",
    modelProfile: "vision_classification",
    mutationId,
    prompt,
    input: { expectedCopy: input.expectedCopy, format: input.format, attempt: input.attempt },
    attempts,
    latencyMs: Date.now() - startedAt,
    providerName: provider?.providerName ?? "unavailable",
    providerType: "text_generation",
    modelName,
    output,
    status: output ? "completed" : "failed",
    error: output ? undefined : lastError,
  });

  if (!output) {
    throw lastError instanceof Error ? lastError : new Error("Clone QA is not configured.");
  }

  const json = (output.json ?? {}) as Record<string, unknown>;
  const copyChecks = parseCopyChecks(json.copyChecks, input.expectedCopy);
  const defects = Array.isArray(json.defects)
    ? (json.defects as unknown[]).filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const regions = parseRegions(json.regions);

  return {
    passed: copyChecks.every((check) => check.exact) && defects.length === 0,
    attempts: input.attempt,
    checkedAt: new Date().toISOString(),
    copyChecks,
    defects,
    regions,
    model: modelName,
  };
}
