import { META_COPY_CONSTRAINTS, truncateAtWordBoundary } from "./meta-copy-contract.ts";
import type { AdStudioAiWritingGuidance, AdStudioCopyFields } from "./copy-generation";
import { toMetaCta } from "./meta-cta.ts";

export type CopyProposal = {
  onImage: Record<string, string>;
  copy: AdStudioCopyFields;
  source: "ai" | "fallback";
};

export function buildDeterministicCopyProposal(
  fields: Array<{ key: string; label: string; maxLength?: number }>,
  brief: string,
  current: Partial<AdStudioCopyFields> = {},
  guidance?: AdStudioAiWritingGuidance,
): CopyProposal {
  // Guidance is for the provider prompt only; never expose template
  // instructions as customer-facing ad copy in the deterministic fallback.
  void guidance;
  const cleanBrief = brief.trim() || "Make your next property move with confidence.";
  const headline = truncateAtWordBoundary(current.headline?.trim() || cleanBrief.split(/[.!?]/u)[0] || "Your next property move", META_COPY_CONSTRAINTS.headline);
  const primaryText = truncateAtWordBoundary(current.primaryText?.trim() || cleanBrief, META_COPY_CONSTRAINTS.primaryText);
  const description = truncateAtWordBoundary(current.description?.trim() || "Practical local advice for your next move.", META_COPY_CONSTRAINTS.description);
  const cta = toMetaCta(current.cta?.trim() || "LEARN_MORE");
  const onImage = Object.fromEntries(fields.map(field => [field.key, truncateAtWordBoundary(cleanBrief, field.maxLength ?? 120)]));
  return { onImage, copy: { primaryText, headline, description, cta }, source: "fallback" };
}
