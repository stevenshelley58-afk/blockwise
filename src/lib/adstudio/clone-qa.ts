// Editable-region detection + deterministic text QA for AI-cloned creatives.
//
// Copy verification is gone. Baked-in text used to trigger a blocking reroll
// loop; now the customer gets the ad immediately and fixes any text in place.
// What survives:
//   - detectCloneRegions: one vision call per render locates the editable
//     hit-boxes that power in-place editing. Never throws (returns []).
//   - applyDeterministicTextEditQa: a deterministic text render writes the
//     requested characters itself, so its verdict updates without a model call.
//   - parseCloneRegions / boxFromRegionEntry: parse the vision response into
//     normalized 0..1 editor boxes.

import { randomUUID } from "node:crypto";

import { createTextProviderForCandidate } from "./ai-providers.ts";
import type { TextProviderAdapter, TextProviderResponse } from "./providers.ts";
import type { AdStudioCloneQa, AdStudioCloneRegion } from "./types.ts";
import {
  isProviderFallbackEligible,
  modelCandidateAttempts,
  resolveRuntimeModelProfile,
} from "../operator/prompts/model-profile-runtime.ts";
import {
  executeAdStudioProviderAttempt,
  recordAdStudioProviderRun,
  type ProviderRunAttempt,
} from "../operator/prompts/redact-prompt-run.ts";

export type CloneRegion = AdStudioCloneRegion;
export type CloneBox = CloneRegion["box"];

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
export function boxFromRegionEntry(item: Record<string, unknown>): CloneBox {
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
): CloneRegion[] {
  if (!Array.isArray(raw)) return [];
  const regions: CloneRegion[] = [];
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

function cloneQaPassed(qa: Pick<AdStudioCloneQa, "copyChecks" | "defects">): boolean {
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

export type DetectCloneRegionsInput = {
  workspaceId: string;
  userId: string;
  correlationId?: string;
  /** Model-readable image (data: URL or absolute http(s) URL). */
  imageUrl: string;
  /** Copy keys the creative declares; used to classify boxes as text/image. */
  expectedCopy?: Record<string, string>;
  /** Distinguishes parallel feed/story region reservations for one generation. */
  format?: string;
};

const REGION_DETECTION_SYSTEM = [
  "You are locating the editable regions of an ad creative so a user can edit",
  "them in place. Return ONLY JSON matching this exact shape:",
  '{ "regions": [ { "box": [x1, y1, x2, y2], "key": "<short>", "kind": "text" } ] }',
  "Each entry is one editable hit-box. \"box\" is [x1, y1, x2, y2] with every",
  "value normalized to the 0..1 range relative to the full image (top-left",
  "origin). \"key\" is a short snake_case identifier for the element. \"kind\"",
  'is "text" for headlines, captions, prices, phone numbers and other editable',
  'copy, or "image" for photos, logos and other image areas. Detect every',
  "distinct editable element. Do not include any text outside the JSON object.",
].join(" ");

/**
 * One vision call per render: locates the editable hit-boxes that power
 * in-place editing. Mirrors the old QA request shape (imageUrl +
 * response_format json_object) but returns ONLY the regions array. On ANY
 * failure — provider misconfiguration, dispatch error, malformed JSON — it
 * returns [] so the main pipeline never breaks.
 */
export async function detectCloneRegions(input: DetectCloneRegionsInput): Promise<CloneRegion[]> {
  try {
    const startedAt = Date.now();
    const correlationId = input.correlationId ?? randomUUID();
    const format = input.format ?? "clone";
    const mutationId = `${correlationId}:adstudio.clone_regions:${format}`;
    const expectedCopy = input.expectedCopy ?? {};

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
            system: REGION_DETECTION_SYSTEM,
            schemaName: "metaLeadAdPack",
            imageUrl: input.imageUrl,
            messages: [{ role: "user", content: "Locate the editable regions in this ad creative." }],
          }),
        });
        attempts.push(execution.attempt);
        if (!execution.ok) {
          lastError = execution.error;
          if (!isProviderFallbackEligible(execution.error)) break;
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
      taskType: "adstudio.clone_regions",
      modelProfile: "vision_classification",
      mutationId,
      prompt: {
        system: REGION_DETECTION_SYSTEM,
        user: "Locate the editable regions in this ad creative.",
        fullPrompt: REGION_DETECTION_SYSTEM,
        promptVersions: [],
        fallbackPromptUsed: false,
        warnings: [],
      },
      input: { format },
      attempts,
      latencyMs: Date.now() - startedAt,
      providerName: provider?.providerName ?? "unavailable",
      providerType: "text_generation",
      modelName,
      output,
      status: output ? "completed" : "failed",
      error: output ? undefined : lastError,
    });

    if (!output) return [];
    const json = (output.json ?? {}) as Record<string, unknown>;
    return parseCloneRegions(json.regions, expectedCopy);
  } catch {
    return [];
  }
}
