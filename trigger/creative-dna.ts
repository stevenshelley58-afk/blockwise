import { schedules } from "@trigger.dev/sdk/v3";
import * as Sentry from "@sentry/nextjs";

import {
  CREATIVE_DNA_VERSION,
  extractCreativeSkeletonForAd,
  type CreativeDnaObservedAd,
} from "../src/lib/ad-template-library/creative-dna.ts";
import { createTextProviderForCandidate } from "../src/lib/adstudio/ai-providers.ts";
import { estimateRunCostUsd, shouldBlockForCostPolicy } from "../src/lib/ai/model-registry.ts";
import { modelCandidateAttempts, resolveRuntimeModelProfile } from "../src/lib/operator/prompts/model-profile-runtime.ts";
import { createSupabaseServiceClient } from "../src/lib/supabase/service.ts";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;
type ResearchClient = ReturnType<SupabaseServiceClient["schema"]>;

type WinnerRow = {
  observed_ad_id: string;
  composite_score: number | string;
  scored_at: string;
};

type ExistingSkeletonRow = {
  observed_ad_id: string;
};

type RawWinnerCreativeRow = {
  id: string;
  observed_ad_id: string;
  format: string | null;
  headline: string | null;
  body: string | null;
  cta: string | null;
  primary_image_url: string | null;
  ad_type: string | null;
  primary_intent: string | null;
  observed_ads?: {
    advertiser_pages?: { page_name: string | null } | Array<{ page_name: string | null }> | null;
  } | Array<{
    advertiser_pages?: { page_name: string | null } | Array<{ page_name: string | null }> | null;
  }> | null;
};

export type CreativeDnaRunSummary = {
  winnersScanned: number;
  skippedExisting: number;
  skippedMissingImage: number;
  extracted: number;
  failed: number;
  costBlocked: number;
};

const WINNER_LIMIT = 50;
const EXTRACTION_LIMIT = 25;
const CREATIVE_SELECT = `
  id,
  observed_ad_id,
  format,
  headline,
  body,
  cta,
  primary_image_url,
  ad_type,
  primary_intent,
  observed_ads!inner (
    advertiser_pages (
      page_name
    )
  )
`;

export const extractCreativeDnaNightly = schedules.task({
  id: "extract-creative-dna-nightly",
  cron: "30 16 * * *",
  maxDuration: 280,
  run: async () => runCreativeDnaExtractor(createSupabaseServiceClient()),
});

export async function runCreativeDnaExtractor(serviceSupabase: SupabaseServiceClient): Promise<CreativeDnaRunSummary> {
  const research = serviceSupabase.schema("research");
  const summary: CreativeDnaRunSummary = {
    winnersScanned: 0,
    skippedExisting: 0,
    skippedMissingImage: 0,
    extracted: 0,
    failed: 0,
    costBlocked: 0,
  };

  const winners = await loadLatestWinnerIds(research);
  summary.winnersScanned = winners.length;
  const existing = await loadExistingSkeletonSourceIds(research, winners);
  const targetIds = winners.filter((id) => !existing.has(id)).slice(0, EXTRACTION_LIMIT);
  summary.skippedExisting = winners.length - targetIds.length;

  const ads = await loadWinnerCreatives(research, targetIds);
  const profile = await resolveRuntimeModelProfile("vision_extract");
  const attempts = modelCandidateAttempts(profile);

  for (const ad of ads) {
    if (!ad.imageUrl) {
      summary.skippedMissingImage += 1;
      continue;
    }

    const estimatedCostUsd = estimateRunCostUsd(attempts[0], { inputTokens: 1800, outputTokens: 600, imageUnits: 1 });
    const costPolicy = shouldBlockForCostPolicy("vision_extract", { estimatedCostUsd });
    if (costPolicy.blocked) {
      summary.costBlocked += 1;
      continue;
    }

    try {
      const extraction = await extractWithFallbacks(ad, attempts);
      await persistCreativeSkeleton(research, ad, extraction);
      summary.extracted += 1;
    } catch (error) {
      Sentry.captureException(error);
      summary.failed += 1;
    }
  }

  await recordRunSummary(research, summary);
  return summary;
}

async function extractWithFallbacks(
  ad: CreativeDnaObservedAd,
  attempts: ReturnType<typeof modelCandidateAttempts>,
): Promise<Awaited<ReturnType<typeof extractCreativeSkeletonForAd>>> {
  let lastError: unknown = null;

  for (const candidate of attempts) {
    try {
      return await extractCreativeSkeletonForAd({
        ad,
        provider: createTextProviderForCandidate(candidate, { model: candidate.model }),
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Creative DNA extraction failed.");
}

async function loadLatestWinnerIds(research: ResearchClient): Promise<string[]> {
  const { data, error } = await research
    .from("ad_quality_scores")
    .select("observed_ad_id,composite_score,scored_at")
    .eq("is_winner", true)
    .order("scored_at", { ascending: false })
    .limit(WINNER_LIMIT);

  if (error) {
    throw new Error(`Unable to load winners for creative DNA extraction: ${error.message}`);
  }

  const ids: string[] = [];
  for (const row of (data ?? []) as WinnerRow[]) {
    if (!ids.includes(row.observed_ad_id)) ids.push(row.observed_ad_id);
  }
  return ids;
}

async function loadExistingSkeletonSourceIds(research: ResearchClient, observedAdIds: string[]): Promise<Set<string>> {
  if (observedAdIds.length === 0) return new Set();

  const { data, error } = await research
    .from("creative_skeletons")
    .select("observed_ad_id")
    .in("observed_ad_id", observedAdIds);

  if (error) {
    throw new Error(`Unable to load existing creative skeletons: ${error.message}`);
  }

  return new Set(
    ((data ?? []) as ExistingSkeletonRow[])
      .map((row) => row.observed_ad_id),
  );
}

async function loadWinnerCreatives(research: ResearchClient, observedAdIds: string[]): Promise<CreativeDnaObservedAd[]> {
  if (observedAdIds.length === 0) return [];

  const { data, error } = await research
    .from("ad_creatives")
    .select(CREATIVE_SELECT)
    .in("observed_ad_id", observedAdIds);

  if (error) {
    throw new Error(`Unable to load winner creatives for creative DNA extraction: ${error.message}`);
  }

  return ((data ?? []) as RawWinnerCreativeRow[]).flatMap((row) => {
    if (!row.primary_image_url) return [];
    const observed = firstNested(row.observed_ads);
    const advertiser = firstNested(observed?.advertiser_pages);
    return [{
      observedAdId: row.observed_ad_id,
      adCreativeId: row.id,
      imageUrl: row.primary_image_url,
      headline: row.headline,
      body: row.body,
      cta: row.cta,
      adType: row.ad_type,
      primaryIntent: row.primary_intent,
      format: row.format,
      advertiserName: advertiser?.page_name ?? null,
    }];
  });
}

async function persistCreativeSkeleton(
  research: ResearchClient,
  ad: CreativeDnaObservedAd,
  extraction: Awaited<ReturnType<typeof extractCreativeSkeletonForAd>>,
): Promise<void> {
  const { data: decision, error: decisionError } = await research
    .from("agent_decisions")
    .insert({
      decision_type: "ad_classification",
      subject_type: "observed_ad",
      subject_id: ad.observedAdId,
      decision: {
        action: "extract_creative_skeleton",
        extractor_version: CREATIVE_DNA_VERSION,
        confidence: extraction.skeleton.confidence,
      },
      rationale: `Extracted ${extraction.skeleton.archetype} creative skeleton from winning ad image.`,
      confidence: Math.round(extraction.skeleton.confidence),
      evidence: {
        ad_creative_id: ad.adCreativeId,
        source_image_url: ad.imageUrl,
        prompt_versions: extraction.promptVersions,
        provider_metadata: extraction.providerMetadata,
        usage: extraction.usage,
      },
      hermes_skill: CREATIVE_DNA_VERSION,
      model: String(extraction.providerMetadata.model ?? "vision_extract"),
      cost_usd: 0,
    })
    .select("id")
    .single();

  if (decisionError || !decision?.id) {
    throw new Error(`Unable to record creative DNA decision for ${ad.observedAdId}: ${decisionError?.message ?? "missing decision id"}`);
  }

  const { error } = await research.from("creative_skeletons").upsert(
    {
      observed_ad_id: ad.observedAdId,
      ad_creative_id: ad.adCreativeId,
      creative_skeleton: extraction.skeleton,
      skeleton_version: extraction.skeleton.version,
      extractor_version: CREATIVE_DNA_VERSION,
      model: String(extraction.providerMetadata.model ?? "vision_extract"),
      confidence: extraction.skeleton.confidence,
      extracted_at: new Date().toISOString(),
      decision_id: decision.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "observed_ad_id" },
  );

  if (error) {
    throw new Error(`Unable to persist creative skeleton for ${ad.observedAdId}: ${error.message}`);
  }
}

async function recordRunSummary(research: ResearchClient, summary: CreativeDnaRunSummary): Promise<void> {
  const { error } = await research.from("agent_decisions").insert({
    decision_type: "operator_chat",
    subject_type: "operator_query",
    subject_id: `creative-dna:${new Date().toISOString()}`,
    decision: {
      action: "creative_dna_summary",
      extractor_version: CREATIVE_DNA_VERSION,
      summary,
    },
    rationale: "Creative DNA extractor completed with schema-validated skeleton writes.",
    confidence: summary.failed === 0 ? 100 : 60,
    evidence: summary,
    hermes_skill: CREATIVE_DNA_VERSION,
    model: null,
    cost_usd: 0,
  });

  if (error) {
    throw new Error(`Unable to record creative DNA run summary: ${error.message}`);
  }
}

function firstNested<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
