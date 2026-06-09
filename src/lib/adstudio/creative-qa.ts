import { scoreAdStudioVariant } from "./scoring.ts";
import type { TextProviderAdapter } from "./providers.ts";
import type { AdStudioCampaignPack } from "./types.ts";

export const SCORE_GATE_THRESHOLD = 70;

// ── Vision QA ────────────────────────────────────────────────────────────────

const VISION_QA_SYSTEM = `You are a quality reviewer for Australian real estate ad creatives.
Examine the image and return ONLY compact JSON:
{
  "pass": true | false,
  "reasons": ["reason if fail, empty array if pass"],
  "has_us_cues": true | false,
  "has_garbled_text": true | false,
  "has_distorted_faces": true | false,
  "has_warped_buildings": true | false,
  "is_low_resolution": true | false,
  "is_au_appropriate": true | false
}
Fail (pass=false) if ANY of these are true:
- American houses, mailboxes, yard signs, flags, HOA lawns (has_us_cues)
- Garbled, distorted, or unreadable rendered text (has_garbled_text)
- Distorted or malformed faces (has_distorted_faces)
- Warped or physically impossible buildings (has_warped_buildings)
- Clearly blurry, pixelated, or low-resolution image (is_low_resolution)
Pass only if is_au_appropriate and none of the fail conditions apply.
Output JSON only.`;

export type VisionQAResult = {
  pass: boolean;
  reasons: string[];
};

export async function runVisionQA(
  imageUrl: string,
  provider: TextProviderAdapter,
): Promise<VisionQAResult> {
  const response = await provider.generate({
    system: VISION_QA_SYSTEM,
    schemaName: "metaLeadAdPack",
    imageUrl,
    messages: [{ role: "user", content: "Review this ad creative image for AU quality." }],
  });

  const raw = (response.json ?? {}) as Record<string, unknown>;
  const pass = raw.pass === true;
  const reasons = Array.isArray(raw.reasons) ? (raw.reasons as string[]) : [];

  if (!pass && reasons.length === 0) {
    const flags = ["has_us_cues", "has_garbled_text", "has_distorted_faces", "has_warped_buildings", "is_low_resolution"];
    for (const flag of flags) {
      if (raw[flag] === true) reasons.push(flag.replace(/_/g, " "));
    }
    if (reasons.length === 0) reasons.push("vision QA failed");
  }

  return { pass, reasons };
}

// ── Similarity guard ──────────────────────────────────────────────────────────
// Content-hash dedup prevents exact duplicate images from surviving the QA pass.
// The style-profile extractor's do_not_copy=true + never-passing source pixels
// handles perceptual similarity at the generation stage; this guard catches
// any identical-bytes duplicates at output.

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

// ── Cross-variant copy similarity (non-blocking diversity hint) ───────────────
// Meta's delivery system suppresses near-duplicate creatives, so warn (never
// block) when two variants' headline + primary text are nearly the same.

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

// ── Score gate ────────────────────────────────────────────────────────────────

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
  const result = scoreAdStudioVariant({
    ...dimensions,
    notes: [],
    warnings: [],
  });

  return {
    pass: result.score >= threshold,
    score: result.score,
    threshold,
  };
}

// ── Copy compliance gate ──────────────────────────────────────────────────────

const AU_BANNED_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: "guaranteed_price",   pattern: /guarantee(d)?\s+(price|sale|result)/i },
  { code: "discriminatory",     pattern: /\b(families only|retirees only|young professionals only)\b/i },
  { code: "fake_scarcity",      pattern: /\b(only \d+ homes? left|last chance)\b/i },
  { code: "financial_advice",   pattern: /\b(investment advice|financial advice|guaranteed return)\b/i },
  { code: "us_portal",          pattern: /\b(zillow|realtor\.com|trulia)\b/i },
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

// ── Composite gate ────────────────────────────────────────────────────────────

export type CreativeQAInput = {
  imageUrl: string;
  copyText: string;
  scoreDimensions: ScoreDimensions;
  knownContentHashes?: string[];
  candidateContentHash?: string;
  visionProvider: TextProviderAdapter;
  scoreThreshold?: number;
};

export type CreativeQAResult = {
  pass: boolean;
  gates: {
    visionQA: VisionQAResult;
    similarity: SimilarityGuardResult;
    scoreGate: ScoreGateResult;
    compliance: ComplianceGateResult;
  };
  score: number;
};

export async function runCreativeQA(input: CreativeQAInput): Promise<CreativeQAResult> {
  const [visionQA, similarity, scoreGate, compliance] = await Promise.all([
    runVisionQA(input.imageUrl, input.visionProvider),
    Promise.resolve(runSimilarityGuard(input.candidateContentHash ?? null, input.knownContentHashes ?? [])),
    Promise.resolve(runScoreGate(input.scoreDimensions, input.scoreThreshold)),
    Promise.resolve(runComplianceGate(input.copyText)),
  ]);

  return {
    pass: visionQA.pass && similarity.pass && scoreGate.pass && compliance.pass,
    gates: { visionQA, similarity, scoreGate, compliance },
    score: scoreGate.score,
  };
}
