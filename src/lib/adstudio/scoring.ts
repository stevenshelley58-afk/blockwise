import { randomUUID } from "node:crypto";

import { createTextProviderForCandidate } from "./ai-providers.ts";
import type { TextProviderAdapter, TextProviderResponse } from "./providers.ts";
import type { AssembledPrompt } from "../operator/prompts/assemble-prompt.ts";
import { modelCandidateAttempts, resolveRuntimeModelProfile } from "../operator/prompts/model-profile-runtime.ts";
import { getActivePromptSection } from "../operator/prompts/prompt-registry.ts";
import { recordAdStudioProviderRun } from "../operator/prompts/redact-prompt-run.ts";
import type { AdStudioCampaignPack, AdStudioVariantScore } from "./types.ts";

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

// ── LLM-judge scoring ─────────────────────────────────────────────────────────
// One batched structured-JSON call scores every variant's enriched copy.
// Any failure falls back silently to the deterministic scores already on the pack.

type JudgeAttempt = { provider: string; model: string; status: "attempted" | "failed" | "completed"; error?: string };

type JudgedVariantScore = {
  dimensions: {
    offerClarity: number;
    localRelevance: number;
    leadIntentStrength: number;
    brandFit: number;
    complianceSafety: number;
    visualHierarchy: number;
  };
  notes: string[];
  warnings: string[];
};

export async function scoreCampaignPackVariantsWithAi(input: {
  pack: AdStudioCampaignPack;
  workspaceId: string;
  userId: string;
}): Promise<AdStudioCampaignPack> {
  const { pack } = input;
  if (pack.variants.length === 0) return pack;

  const startedAt = Date.now();
  const correlationId = randomUUID();
  let prompt: AssembledPrompt | null = null;
  const attempts: JudgeAttempt[] = [];
  let provider: TextProviderAdapter | null = null;
  let modelName = "unavailable";
  let output: TextProviderResponse | null = null;

  try {
    const section = await getActivePromptSection("adstudio.scoring.system");
    const user = buildScoringUserPrompt(pack);
    prompt = {
      system: section.body,
      user,
      fullPrompt: `${section.body}\n\n${user}`,
      promptVersions: [{ key: section.key, version: section.version, id: section.id, source: section.source }],
      fallbackPromptUsed: section.source === "fallback",
      warnings:
        section.source === "fallback"
          ? [`${section.key} used bundled fallback${section.fallbackReason ? ` (${section.fallbackReason})` : ""}.`]
          : [],
    };

    const profile = await resolveRuntimeModelProfile("structured_json");
    let lastError: unknown = null;

    for (const candidate of modelCandidateAttempts(profile)) {
      const candidateProvider = createTextProviderForCandidate(candidate);
      attempts.push({ provider: candidateProvider.providerName, model: candidate.model, status: "attempted" });

      try {
        output = await candidateProvider.generate({
          system: prompt.system,
          schemaName: "metaLeadAdPack",
          messages: [{ role: "user", content: prompt.user }],
        });
        provider = candidateProvider;
        modelName = String(output.providerMetadata.model ?? candidate.model);
        attempts[attempts.length - 1] = { provider: candidateProvider.providerName, model: candidate.model, status: "completed" };
        break;
      } catch (error) {
        lastError = error;
        attempts[attempts.length - 1] = {
          provider: candidateProvider.providerName,
          model: candidate.model,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    if (!output || !provider) {
      throw lastError ?? new Error("AI scoring is not configured.");
    }

    await recordAdStudioProviderRun({
      workspaceId: input.workspaceId,
      userId: input.userId,
      correlationId,
      taskType: "adstudio.scoring",
      modelProfile: "structured_json",
      prompt,
      input: { campaignId: pack.campaign.campaignId, variantCount: pack.variants.length },
      attempts,
      latencyMs: Date.now() - startedAt,
      providerName: provider.providerName,
      providerType: provider.providerType,
      modelName,
      output,
      status: "completed",
    });

    const judged = parseJudgeScores(output.json);
    if (judged.size === 0) return pack;

    return {
      ...pack,
      variants: pack.variants.map((variant) => {
        const judgedScore = judged.get(variant.variantId);
        if (!judgedScore) return variant;
        return {
          ...variant,
          score: scoreAdStudioVariant({
            ...judgedScore.dimensions,
            notes: judgedScore.notes.length ? judgedScore.notes : variant.score.notes,
            warnings: judgedScore.warnings.length ? judgedScore.warnings : variant.score.warnings,
          }),
        };
      }),
    };
  } catch (error) {
    if (prompt) {
      try {
        await recordAdStudioProviderRun({
          workspaceId: input.workspaceId,
          userId: input.userId,
          correlationId,
          taskType: "adstudio.scoring",
          modelProfile: "structured_json",
          prompt,
          input: { campaignId: pack.campaign.campaignId, variantCount: pack.variants.length },
          attempts,
          latencyMs: Date.now() - startedAt,
          providerName: provider?.providerName ?? "unavailable",
          providerType: "text_generation",
          modelName,
          output: null,
          status: "failed",
          error,
        });
      } catch {
        // Recording must never break generation.
      }
    }
    return pack;
  }
}

function buildScoringUserPrompt(pack: AdStudioCampaignPack): string {
  const market = [pack.campaign.market.suburb, pack.campaign.market.state].filter(Boolean).join(", ");
  const lines = [
    "Campaign context:",
    `- Goal: ${pack.campaign.goal}`,
    `- Market: ${market}`,
    `- Business: ${pack.brandKit.identity.tradingName || pack.brandKit.identity.businessName}`,
    ...(pack.brandKit.tone.voice ? [`- Brand voice: ${pack.brandKit.tone.voice}`] : []),
    "",
    "Score these ad copy variants:",
  ];

  for (const variant of pack.variants) {
    const copyPack = pack.copyPacks.find((candidate) => candidate.variantId === variant.variantId);
    lines.push(
      "",
      `variantId: ${variant.variantId}`,
      `- Angle: ${variant.angle}`,
      `- Headline: ${variant.headline}`,
      `- Primary text: ${copyPack?.meta.primaryText[0] ?? ""}`,
      `- Description: ${copyPack?.meta.descriptions[0] ?? ""}`,
      `- CTA: ${variant.cta}`,
    );
  }

  return lines.join("\n");
}

function parseJudgeScores(json: unknown): Map<string, JudgedVariantScore> {
  const judged = new Map<string, JudgedVariantScore>();
  const root = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  const entries = root && Array.isArray(root.variants) ? root.variants : [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const variantId = typeof record.variantId === "string" ? record.variantId : null;
    const offerClarity = numberOrNull(record.offerClarity);
    const localRelevance = numberOrNull(record.localRelevance);
    const leadIntentStrength = numberOrNull(record.leadIntentStrength);
    const brandFit = numberOrNull(record.brandFit);
    const complianceSafety = numberOrNull(record.complianceSafety);
    const visualHierarchy = numberOrNull(record.visualHierarchy);

    if (
      !variantId ||
      offerClarity === null ||
      localRelevance === null ||
      leadIntentStrength === null ||
      brandFit === null ||
      complianceSafety === null ||
      visualHierarchy === null
    ) {
      continue;
    }

    judged.set(variantId, {
      dimensions: { offerClarity, localRelevance, leadIntentStrength, brandFit, complianceSafety, visualHierarchy },
      notes: stringList(record.notes, 3),
      warnings: stringList(record.warnings, 3),
    });
  }

  return judged;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, max)
    .map((item) => item.trim());
}
