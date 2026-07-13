// "Create more options" — fully generative ad-creative alternatives.
//
// Distinct from the composite Create (template + copy + fit photo): this asks an
// image model for finished creatives that riff on the user's photo + their copy
// using the per-template generative prompt. It NEVER replaces the composite
// result; it is an opt-in editor action that returns extra options to choose from.
//
// Pure orchestration (no DOM / Next / Supabase) so it is unit-testable: the route
// supplies the resolved providers (from the image_generative profile) and the
// assembled image input; this fans out `count` independent options, each running
// the provider cascade with its own seed. One option failing never blocks the
// others.

import { runComplianceGate, type ComplianceGateResult } from "./creative-qa.ts";
import type { ImageProviderAdapter, ImageProviderRequest, ImageProviderResponse } from "./providers.ts";
import {
  executeAdStudioProviderAttempt,
  type ProviderRunAttempt,
} from "../operator/prompts/redact-prompt-run.ts";
import { isRetryableProviderFailure } from "../operator/prompts/model-profile-runtime.ts";

export type CreativeOptionAttempt = ProviderRunAttempt & { option: number };

export type CreativeOption = {
  index: number;
  assetUrl: string;
  model: string;
  provider: string;
  seed: number;
  usage: ImageProviderResponse["usage"];
};

export type CreativeOptionsResult = {
  options: CreativeOption[];
  attempts: CreativeOptionAttempt[];
  fatalErrors: unknown[];
  /** Re-run compliance gate on the copy these options carry (the WS7 re-trigger). */
  compliance: ComplianceGateResult;
};

export type GenerateCreativeOptionsInput = {
  /** Ordered, reference-capable image providers (image_generative profile + fallback). */
  providers: ImageProviderAdapter[];
  imageInput: ImageProviderRequest;
  /** Copy text the options will carry, re-checked for AU compliance. */
  copyText: string;
  count: number;
  workspaceId: string;
  mutationId: string;
  executeAttempt?: typeof executeAdStudioProviderAttempt;
};

const MIN_OPTIONS = 1;
const MAX_OPTIONS = 4;

export function clampOptionCount(count: number | undefined): number {
  if (!Number.isFinite(count)) return 3;
  return Math.max(MIN_OPTIONS, Math.min(MAX_OPTIONS, Math.trunc(count as number)));
}

/**
 * Generates `count` generative options in parallel. Each option cascades through
 * the providers (first success wins) with its own seed for visual diversity.
 * Returns only the options that produced an image; every attempt is recorded.
 */
export async function generateCreativeOptions(
  input: GenerateCreativeOptionsInput,
): Promise<CreativeOptionsResult> {
  const baseSeed = input.imageInput.seed ?? 0;
  const settled = await Promise.allSettled(
    Array.from({ length: input.count }, (_unused, index) =>
      generateOneOption(
        input.providers.slice(0, 2),
        input.imageInput,
        baseSeed + index + 1,
        index,
        input.workspaceId,
        input.mutationId,
        input.executeAttempt ?? executeAdStudioProviderAttempt,
      ),
    ),
  );
  const lanes = settled
    .filter((result): result is PromiseFulfilledResult<CreativeOptionLaneResult> => result.status === "fulfilled")
    .map((result) => result.value);
  const options = lanes.flatMap((lane) => lane.option ? [lane.option] : []);
  const attempts = lanes.flatMap((lane) => lane.attempts);
  const fatalErrors = [
    ...lanes.flatMap((lane) => lane.fatalError ? [lane.fatalError] : []),
    ...settled.flatMap((result) => result.status === "rejected" ? [result.reason] : []),
  ];

  return {
    options,
    attempts,
    fatalErrors,
    compliance: runComplianceGate(input.copyText),
  };
}

async function generateOneOption(
  providers: ImageProviderAdapter[],
  imageInput: ImageProviderRequest,
  seed: number,
  index: number,
  workspaceId: string,
  mutationId: string,
  executeAttempt: typeof executeAdStudioProviderAttempt,
): Promise<CreativeOptionLaneResult> {
  const attempts: CreativeOptionAttempt[] = [];
  for (const [providerIndex, provider] of providers.entries()) {
    const attemptIndex = index * providers.length + providerIndex;
    let execution;
    try {
      execution = await executeAttempt<ImageProviderResponse>({
        workspaceId,
        mutationId,
        attemptIndex,
        modelProfile: "image_generative",
        provider,
        execute: async () => {
          const result = await provider.generate({ ...imageInput, seed });
          if (!result.assetUrl) throw new Error("Provider returned no image.");
          return result;
        },
      });
    } catch (fatalError) {
      return { option: null, attempts, fatalError };
    }
    attempts.push({ option: index, ...execution.attempt });
    if (execution.ok) {
      const result = execution.output;
      return { option: {
        index,
        assetUrl: result.assetUrl,
        model: result.model,
        provider: provider.providerName,
        seed: result.seed ?? seed,
        usage: result.usage,
      }, attempts, fatalError: null };
    }
    if (!isRetryableProviderFailure(execution.error)) {
      return { option: null, attempts, fatalError: null };
    }
  }

  return { option: null, attempts, fatalError: null };
}

type CreativeOptionLaneResult = {
  option: CreativeOption | null;
  attempts: CreativeOptionAttempt[];
  fatalError: unknown | null;
};
