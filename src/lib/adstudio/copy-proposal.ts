import type { AdStudioAiWritingGuidance, AdStudioCopyFields } from "./copy-generation";

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
  const headline = (current.headline?.trim() || cleanBrief.split(/[.!?]/u)[0] || "Your next property move").slice(0, 40);
  const primaryText = (current.primaryText?.trim() || cleanBrief).slice(0, 125);
  const description = (current.description?.trim() || "Practical local advice for your next move.").slice(0, 90);
  const cta = current.cta?.trim() || "LEARN_MORE";
  const onImage = Object.fromEntries(fields.map(field => [field.key, cleanBrief.slice(0, field.maxLength ?? 120).trim()]));
  return { onImage, copy: { primaryText, headline, description, cta }, source: "fallback" };
}
