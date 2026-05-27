import type { AdStudioVariantScore } from "./types.ts";

export type VariantScoreInput = {
  offerClarity: number;
  localRelevance: number;
  leadIntentStrength: number;
  brandFit: number;
  complianceSafety: number;
  visualHierarchy: number;
  notes: string[];
  warnings: string[];
};

export function scoreAdStudioVariant(input: VariantScoreInput): AdStudioVariantScore {
  const dimensions = {
    offerClarity: clamp(input.offerClarity, 0, 20),
    localRelevance: clamp(input.localRelevance, 0, 15),
    leadIntentStrength: clamp(input.leadIntentStrength, 0, 20),
    brandFit: clamp(input.brandFit, 0, 15),
    complianceSafety: clamp(input.complianceSafety, 0, 20),
    visualHierarchy: clamp(input.visualHierarchy, 0, 10),
  };

  return {
    score: Object.values(dimensions).reduce((sum, value) => sum + value, 0),
    notes: input.notes,
    warnings: input.warnings,
    dimensions,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
