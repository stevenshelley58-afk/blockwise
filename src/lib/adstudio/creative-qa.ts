import { runLayoutQA, type LayoutQAResult } from "./layout-qa.ts";
import { scoreAdStudioVariant } from "./scoring.ts";
import type { AdStudioCampaignPack, AdStudioCreative } from "./types.ts";

export const SCORE_GATE_THRESHOLD = 70;

export type SimilarityGuardResult = {
  pass: boolean;
  reasons: string[];
};

export function runSimilarityGuard(
  candidateHash: string | null,
  knownHashes: string[],
): SimilarityGuardResult {
  if (!candidateHash) return { pass: true, reasons: [] };
  if (knownHashes.includes(candidateHash)) {
    return { pass: false, reasons: ["exact duplicate of an existing variant (content hash match)"] };
  }
  return { pass: true, reasons: [] };
}

export const COPY_SIMILARITY_WARN_THRESHOLD = 0.6;

export function trigramJaccardSimilarity(a: string, b: string): number {
  const left = textTrigrams(a);
  const right = textTrigrams(b);
  if (left.size === 0 || right.size === 0) return left.size === right.size ? 1 : 0;

  let intersection = 0;
  for (const gram of left) {
    if (right.has(gram)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function findPackCopySimilarityWarnings(
  pack: Pick<AdStudioCampaignPack, "variants" | "copyPacks">,
  threshold = COPY_SIMILARITY_WARN_THRESHOLD,
): string[] {
  const entries = pack.variants.map((variant) => {
    const copyPack = pack.copyPacks.find((candidate) => candidate.variantId === variant.variantId);
    return {
      angle: variant.angle,
      text: `${variant.headline} ${copyPack?.meta.primaryText[0] ?? ""}`,
    };
  });
  const warnings: string[] = [];

  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const similarity = trigramJaccardSimilarity(entries[i]!.text, entries[j]!.text);
      if (similarity > threshold) {
        warnings.push(
          `Variants "${entries[i]!.angle}" and "${entries[j]!.angle}" use very similar copy (${Math.round(similarity * 100)}% overlap). Distinct angles perform better on Meta.`,
        );
      }
    }
  }
  return warnings;
}

function textTrigrams(value: string): Set<string> {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  const grams = new Set<string>();
  for (let index = 0; index + 3 <= normalized.length; index += 1) {
    grams.add(normalized.slice(index, index + 3));
  }
  return grams;
}

export type ScoreGateResult = {
  pass: boolean;
  score: number;
  threshold: number;
};

export type ScoreDimensions = {
  offerClarity: number;
  localRelevance: number;
  leadIntentStrength: number;
  brandFit: number;
  complianceSafety: number;
  visualHierarchy: number;
};

export function runScoreGate(
  dimensions: ScoreDimensions,
  threshold = SCORE_GATE_THRESHOLD,
): ScoreGateResult {
  const result = scoreAdStudioVariant({ ...dimensions, notes: [], warnings: [] });
  return { pass: result.score >= threshold, score: result.score, threshold };
}

const AU_BANNED_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: "guaranteed_price", pattern: /guarantee(d)?\s+(price|sale|result)/i },
  { code: "discriminatory", pattern: /\b(families only|retirees only|young professionals only)\b/i },
  { code: "fake_scarcity", pattern: /\b(only \d+ homes? left|last chance)\b/i },
  { code: "financial_advice", pattern: /\b(investment advice|financial advice|guaranteed return)\b/i },
  { code: "us_portal", pattern: /\b(zillow|realtor\.com|trulia)\b/i },
];

export type ComplianceGateResult = {
  pass: boolean;
  issues: Array<{ code: string; text: string }>;
};

export function runComplianceGate(copyText: string): ComplianceGateResult {
  const issues: Array<{ code: string; text: string }> = [];
  for (const rule of AU_BANNED_PATTERNS) {
    if (rule.pattern.test(copyText)) {
      issues.push({ code: rule.code, text: `Pattern '${rule.code}' matched.` });
    }
  }
  return { pass: issues.length === 0, issues };
}

export type RenderedTileQAResult = {
  pass: boolean;
  reasons: string[];
  layout: LayoutQAResult;
  compliance: ComplianceGateResult;
};

export function runRenderedTileQA(input: { creative: AdStudioCreative; copyText: string }): RenderedTileQAResult {
  const layout = runLayoutQA(input.creative);
  const compliance = runComplianceGate(input.copyText);
  const reasons = [
    ...Object.values(layout.checks).flatMap((check) => check.issues.map((issue) => issue.message)),
    ...compliance.issues.map((issue) => issue.text),
  ];
  return { pass: layout.pass && compliance.pass, reasons, layout, compliance };
}
