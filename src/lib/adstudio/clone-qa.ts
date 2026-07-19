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

/**
 * Vision models localize far more accurately in their native detection format
 * (box_2d = [ymin, xmin, ymax, xmax] integers scaled 0-1000) than when asked
 * for fractional x/y/width/height, which drifts and undersizes. Convert to the
 * editor's fractional box here. Legacy fractional "box" objects (older prompt
 * versions may still be active in the DB) remain accepted.
 */
function boxFromRegionEntry(item: Record<string, unknown>): AdStudioCloneRegion["box"] {
  const box2d = item.box_2d;
  if (Array.isArray(box2d) && box2d.length === 4) {
    const values = box2d.map((value) => (typeof value === "number" && Number.isFinite(value) ? value : 0));
    // A model that ignores the 0-1000 scale and answers in 0-1 fractions would
    // otherwise collapse every box into the top-left 0.1% of the image.
    const scale = values.every((value) => value <= 1) ? 1 : 1 / 1000;
    const [ymin, xmin, ymax, xmax] = values.map((value) => clamp01(value * scale)) as [number, number, number, number];
    return {
      x: Math.min(xmin, xmax),
      y: Math.min(ymin, ymax),
      width: Math.abs(xmax - xmin),
      height: Math.abs(ymax - ymin),
    };
  }
  const box = (item.box ?? {}) as Record<string, unknown>;
  return {
    x: clamp01(box.x),
    y: clamp01(box.y),
    width: clamp01(box.width),
    height: clamp01(box.height),
  };
}

export function parseCloneRegions(
  raw: unknown,
  expectedCopy: Record<string, string>,
): AdStudioCloneRegion[] {
  if (!Array.isArray(raw)) return [];
  const regions: AdStudioCloneRegion[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const key = typeof item.key === "string" ? item.key.trim() : "";
    if (!key) continue;
    regions.push({
      key,
      // Declared copy keys are authoritative. Vision occasionally labels a
      // text box inside a large photo region as an image, which would open the
      // file picker instead of the text editor.
      kind: Object.hasOwn(expectedCopy, key) ? "text" : item.kind === "image" ? "image" : "text",
      box: boxFromRegionEntry(item),
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

/**
 * A deterministic text render writes the requested characters itself, so it
 * does not need another vision-model round trip. The previous passing verdict
 * remains authoritative for every untouched pixel and copy field.
 */
export function applyDeterministicTextEditQa(
  previous: AdStudioCloneQa,
  fieldKey: string,
  value: string,
): AdStudioCloneQa {
  const expected = value.trim();
  let replaced = false;
  const copyChecks = previous.copyChecks.map((check) => {
    if (check.key !== fieldKey) return check;
    replaced = true;
    return { key: fieldKey, expected, rendered: expected, exact: true };
  });
  if (!replaced) {
    copyChecks.push({ key: fieldKey, expected, rendered: expected, exact: true });
  }

  const next: AdStudioCloneQa = {
    ...previous,
    attempts: 1,
    checkedAt: new Date().toISOString(),
    copyChecks,
    model: "deterministic-text-renderer",
  };
  return { ...next, passed: cloneQaPassed(next) };
}

export function cloneQaMutationId(correlationId: string, format: string, attempt: number): string {
  return `${correlationId}:adstudio.clone_qa:${format}:${attempt}`;
}

export async function runCloneQa(input: CloneQaInput): Promise<AdStudioCloneQa> {
  const startedAt = Date.now();
  const correlationId = input.correlationId ?? randomUUID();
  const mutationId = cloneQaMutationId(correlationId, input.format, input.attempt);
  const bundle = await getActivePromptBundle(["adstudio.clone_qa"]);
  const system = bundle["adstudio.clone_qa"].body;
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
    throw lastError instanceof Error ? lastError : new Error("Ad quality check is not configured.");
  }

  const json = (output.json ?? {}) as Record<string, unknown>;
  const copyChecks = parseCopyChecks(json.copyChecks, input.expectedCopy);
  const defects = Array.isArray(json.defects)
    ? (json.defects as unknown[]).filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const regions = parseCloneRegions(json.regions, input.expectedCopy);

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
