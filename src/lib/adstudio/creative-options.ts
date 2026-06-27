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

export type CreativeOptionAttempt = {
  option: number;
  provider: string;
  model: string;
  status: "completed" | "failed";
  error?: string;
};

export type CreativeOption = {
  index: number;
  assetUrl: string;
  model: string;
  provider: string;
  seed: number;
};

export type CreativeOptionsResult = {
  options: CreativeOption[];
  attempts: CreativeOptionAttempt[];
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
  const attempts: CreativeOptionAttempt[] = [];

  const settled = await Promise.all(
    Array.from({ length: input.count }, (_unused, index) =>
      generateOneOption(input.providers, input.imageInput, baseSeed + index + 1, index, attempts),
    ),
  );

  const options = settled.filter((option): option is CreativeOption => option !== null);

  return {
    options,
    attempts,
    compliance: runComplianceGate(input.copyText),
  };
}

async function generateOneOption(
  providers: ImageProviderAdapter[],
  imageInput: ImageProviderRequest,
  seed: number,
  index: number,
  attempts: CreativeOptionAttempt[],
): Promise<CreativeOption | null> {
  let lastError: unknown = null;

  for (const provider of providers) {
    try {
      const result: ImageProviderResponse = await provider.generate({ ...imageInput, seed });
      if (!result.assetUrl) {
        throw new Error("Provider returned no image.");
      }
      attempts.push({ option: index, provider: provider.providerName, model: result.model, status: "completed" });
      return {
        index,
        assetUrl: result.assetUrl,
        model: result.model,
        provider: provider.providerName,
        seed: result.seed ?? seed,
      };
    } catch (error) {
      lastError = error;
      attempts.push({
        option: index,
        provider: provider.providerName,
        model: "unavailable",
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  void lastError;
  return null;
}
