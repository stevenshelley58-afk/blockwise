import { schedules } from "@trigger.dev/sdk/v3";

import {
  WINNER_SCORER_VERSION,
  buildClusterKey,
  buildTemplateDraftsFromWinners,
  deriveTemplateKey,
  isScoringEligible,
  scoreWinnerCandidate,
  type OwnedAdPerformanceSignal,
  type TemplateDraft,
  type WinnerCandidate,
  type WinnerForMining,
} from "../src/lib/ad-template-library/winner-scoring.ts";
import { creativeSkeletonSchema, type CreativeSkeleton } from "../src/lib/ad-template-library/skeleton.ts";
import { createSupabaseServiceClient } from "../src/lib/supabase/service.ts";
import { captureTriggerException } from "./sentry.ts";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;
type ResearchClient = ReturnType<SupabaseServiceClient["schema"]>;

type LatestScoreRow = {
  observed_ad_id: string;
  decision_id: string | null;
  scored_at: string;
};

type LatestWinnerScoreRow = LatestScoreRow & {
  objective_score: number | string;
  composite_score: number | string;
  scorer_version: string;
  rationale: string | null;
  is_winner: boolean;
};

type RawCreativeRow = {
  id: string;
  observed_ad_id: string;
  format: string | null;
  headline: string | null;
  body: string | null;
  cta: string | null;
  primary_image_url: string | null;
  video_url: string | null;
  creative_hash: string | null;
  classification: Record<string, unknown> | null;
  ad_type: string | null;
  primary_intent: string | null;
  observed_ads?: RawObservedAdRow | RawObservedAdRow[] | null;
};

type RawObservedAdRow = {
  id: string;
  advertiser_page_id: string | null;
  active_status: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  ad_delivery_started_at: string | null;
  ad_delivery_stopped_at: string | null;
  advertiser_pages?: RawAdvertiserPageRow | RawAdvertiserPageRow[] | null;
};

type RawAdvertiserPageRow = {
  id: string;
  page_name: string | null;
};

type AgentDecisionRow = {
  id: string;
  evidence: Record<string, unknown> | null;
};

type CreativeSkeletonRow = {
  observed_ad_id: string;
  creative_skeleton: unknown;
};

type OwnedPerformanceRow = {
  observed_ad_id: string | null;
  template_key: string | null;
  impressions: number;
  clicks: number;
  leads: number;
  qualified_leads: number;
  spend_cents: number;
  lead_quality_score: number | string | null;
};

type RunSummary = {
  scanned: number;
  eligible: number;
  skippedAlreadyCurrent: number;
  scored: number;
  winners: number;
  scoreFailures: number;
  minedDrafts: number;
  protectedApprovedRows: number;
  minerFailures: number;
};

const SCORE_BATCH_LIMIT = 25;
const CANDIDATE_SCAN_LIMIT = SCORE_BATCH_LIMIT * 8;
const MINER_WINNER_LIMIT = 500;

const CREATIVE_SELECT = `
  id,
  observed_ad_id,
  format,
  headline,
  body,
  cta,
  primary_image_url,
  video_url,
  creative_hash,
  classification,
  ad_type,
  primary_intent,
  observed_ads!inner (
    id,
    advertiser_page_id,
    active_status,
    first_seen_at,
    last_seen_at,
    ad_delivery_started_at,
    ad_delivery_stopped_at,
    advertiser_pages!inner (
      id,
      page_name
    )
  )
`;

export const scoreAdWinnersNightly = schedules.task({
  id: "score-ad-winners-nightly",
  cron: "0 16 * * *",
  maxDuration: 280,
  run: async () => runNightlyWinnerScorer(createSupabaseServiceClient()),
});

export async function runNightlyWinnerScorer(serviceSupabase: SupabaseServiceClient): Promise<RunSummary> {
  const research = serviceSupabase.schema("research");
  const now = new Date();
  const summary: RunSummary = {
    scanned: 0,
    eligible: 0,
    skippedAlreadyCurrent: 0,
    scored: 0,
    winners: 0,
    scoreFailures: 0,
    minedDrafts: 0,
    protectedApprovedRows: 0,
    minerFailures: 0,
  };

  const candidates = await loadScoringCandidates(research, now);
  summary.scanned = candidates.scanned;
  summary.eligible = candidates.eligible;
  summary.skippedAlreadyCurrent = candidates.skippedAlreadyCurrent;

  for (const candidate of candidates.candidates) {
    try {
      const score = scoreWinnerCandidate(candidate, now);
      await persistAdQualityScore(research, candidate, score);
      summary.scored += 1;
      if (score.isWinner) summary.winners += 1;
    } catch (error) {
      captureTriggerException(error, "score-ad-winners-nightly");
      summary.scoreFailures += 1;
    }
  }

  try {
    const mined = await mineTemplateCandidates(research);
    summary.minedDrafts = mined.draftRows;
    summary.protectedApprovedRows = mined.protectedApprovedRows;
  } catch (error) {
    captureTriggerException(error, "score-ad-winners-nightly");
    summary.minerFailures += 1;
  }

  await recordRunSummaryDecision(research, summary);
  return summary;
}

async function loadScoringCandidates(
  research: ResearchClient,
  now: Date,
): Promise<{ scanned: number; eligible: number; skippedAlreadyCurrent: number; candidates: WinnerCandidate[] }> {
  const rows = await fetchRecentCreativeRows(research, CANDIDATE_SCAN_LIMIT);
  const baseCandidates = rows.map(mapCreativeRow).filter((candidate): candidate is WinnerCandidate => Boolean(candidate));
  const eligible = baseCandidates.filter(isScoringEligible);
  const enriched = await enrichCandidateStats(research, eligible);
  const performance = await loadOwnedPerformanceSignals(research, {
    observedAdIds: enriched.map((candidate) => candidate.observedAdId),
    templateKeys: enriched.map((candidate) => templateKeyForCandidate(candidate)).filter((key): key is string => Boolean(key)),
  });
  const latestScores = await loadLatestScores(research, enriched.map((candidate) => candidate.observedAdId));
  const decisionEvidence = await loadDecisionEvidence(
    research,
    [...latestScores.values()].map((row) => row.decision_id).filter((id): id is string => Boolean(id)),
  );
  const candidates: WinnerCandidate[] = [];
  let skippedAlreadyCurrent = 0;

  for (const baseCandidate of enriched) {
    const candidate: WinnerCandidate = {
      ...baseCandidate,
      ownedPerformance:
        performance.byObservedId.get(baseCandidate.observedAdId)
        ?? performance.byTemplateKey.get(templateKeyForCandidate(baseCandidate) ?? "")
        ?? null,
    };
    const latest = latestScores.get(candidate.observedAdId);
    const latestCreativeHash = latest?.decision_id ? stringValue(decisionEvidence.get(latest.decision_id)?.creative_hash) : null;
    const score = scoreWinnerCandidate(candidate, now);

    if (score.score < 40) {
      skippedAlreadyCurrent += 1;
      continue;
    }
    if (latest && candidate.creativeHash && latestCreativeHash === candidate.creativeHash) {
      skippedAlreadyCurrent += 1;
      continue;
    }

    candidates.push(candidate);
    if (candidates.length >= SCORE_BATCH_LIMIT) break;
  }

  return {
    scanned: rows.length,
    eligible: eligible.length,
    skippedAlreadyCurrent,
    candidates,
  };
}

async function fetchRecentCreativeRows(research: ResearchClient, limit: number): Promise<RawCreativeRow[]> {
  const { data, error } = await research
    .from("ad_creatives")
    .select(CREATIVE_SELECT)
    .not("body", "is", null)
    .eq("display_state", "displayable")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Unable to load ad winner candidates: ${error.message}`);
  }

  return (data ?? []) as RawCreativeRow[];
}

async function fetchCreativeRowsByObservedIds(research: ResearchClient, observedAdIds: string[]): Promise<RawCreativeRow[]> {
  if (observedAdIds.length === 0) return [];
  const { data, error } = await research
    .from("ad_creatives")
    .select(CREATIVE_SELECT)
    .in("observed_ad_id", observedAdIds);

  if (error) {
    throw new Error(`Unable to load winning ad creatives: ${error.message}`);
  }

  return (data ?? []) as RawCreativeRow[];
}

async function enrichCandidateStats(research: ResearchClient, candidates: WinnerCandidate[]): Promise<WinnerCandidate[]> {
  if (candidates.length === 0) return [];
  const [versions, crossAgencyCounts] = await Promise.all([
    loadCreativeVersionCounts(research, candidates.map((candidate) => candidate.observedAdId)),
    loadCrossAgencyCounts(research, candidates.map((candidate) => candidate.creativeHash).filter((hash): hash is string => Boolean(hash))),
  ]);

  return candidates.map((candidate) => ({
    ...candidate,
    creativeVersions: versions.get(candidate.observedAdId) ?? 1,
    crossAgencyCount: candidate.creativeHash ? (crossAgencyCounts.get(candidate.creativeHash) ?? 1) : 1,
  }));
}

async function loadCreativeVersionCounts(research: ResearchClient, observedAdIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (observedAdIds.length === 0) return counts;

  const { data, error } = await research.from("ad_creative_versions").select("observed_ad_id").in("observed_ad_id", observedAdIds);
  if (error) {
    throw new Error(`Unable to load creative version counts: ${error.message}`);
  }

  for (const row of (data ?? []) as Array<{ observed_ad_id: string }>) {
    counts.set(row.observed_ad_id, (counts.get(row.observed_ad_id) ?? 0) + 1);
  }
  return counts;
}

async function loadCrossAgencyCounts(research: ResearchClient, creativeHashes: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const hashes = [...new Set(creativeHashes)];
  if (hashes.length === 0) return counts;

  const { data, error } = await research
    .from("ad_creatives")
    .select("creative_hash, observed_ads!inner(advertiser_page_id)")
    .in("creative_hash", hashes);

  if (error) {
    throw new Error(`Unable to load cross-advertiser counts: ${error.message}`);
  }

  const advertisersByHash = new Map<string, Set<string>>();
  for (const row of (data ?? []) as Array<{ creative_hash: string | null; observed_ads?: { advertiser_page_id: string | null } | Array<{ advertiser_page_id: string | null }> | null }>) {
    if (!row.creative_hash) continue;
    const observed = firstNested(row.observed_ads);
    const advertiser = observed?.advertiser_page_id;
    if (!advertiser) continue;
    const set = advertisersByHash.get(row.creative_hash) ?? new Set<string>();
    set.add(advertiser);
    advertisersByHash.set(row.creative_hash, set);
  }

  for (const [hash, advertisers] of advertisersByHash.entries()) {
    counts.set(hash, advertisers.size);
  }

  return counts;
}

async function loadOwnedPerformanceSignals(
  research: ResearchClient,
  input: { observedAdIds: string[]; templateKeys: string[] },
): Promise<{ byObservedId: Map<string, OwnedAdPerformanceSignal>; byTemplateKey: Map<string, OwnedAdPerformanceSignal> }> {
  const byObservedId = new Map<string, OwnedAdPerformanceSignal>();
  const byTemplateKey = new Map<string, OwnedAdPerformanceSignal>();
  const observedAdIds = [...new Set(input.observedAdIds)];
  const templateKeys = [...new Set(input.templateKeys)];

  if (observedAdIds.length === 0 && templateKeys.length === 0) {
    return { byObservedId, byTemplateKey };
  }

  let query = research
    .from("owned_ad_performance")
    .select("observed_ad_id,template_key,impressions,clicks,leads,qualified_leads,spend_cents,lead_quality_score");

  if (observedAdIds.length > 0 && templateKeys.length > 0) {
    query = query.or(`observed_ad_id.in.(${observedAdIds.join(",")}),template_key.in.(${templateKeys.join(",")})`);
  } else if (observedAdIds.length > 0) {
    query = query.in("observed_ad_id", observedAdIds);
  } else {
    query = query.in("template_key", templateKeys);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Unable to load owned ad performance signals: ${error.message}`);
  }

  for (const row of (data ?? []) as OwnedPerformanceRow[]) {
    if (row.observed_ad_id) {
      mergeOwnedPerformanceSignal(byObservedId, row.observed_ad_id, row);
    }
    if (row.template_key) {
      mergeOwnedPerformanceSignal(byTemplateKey, row.template_key, row);
    }
  }

  return { byObservedId, byTemplateKey };
}

function mergeOwnedPerformanceSignal(
  signals: Map<string, OwnedAdPerformanceSignal>,
  key: string,
  row: OwnedPerformanceRow,
) {
  const current = signals.get(key) ?? {
    impressions: 0,
    clicks: 0,
    leads: 0,
    qualifiedLeads: 0,
    spendCents: 0,
    leadQualityScore: null,
  };
  const quality = row.lead_quality_score === null ? null : Number(row.lead_quality_score);
  signals.set(key, {
    impressions: current.impressions + row.impressions,
    clicks: current.clicks + row.clicks,
    leads: current.leads + row.leads,
    qualifiedLeads: current.qualifiedLeads + row.qualified_leads,
    spendCents: current.spendCents + row.spend_cents,
    leadQualityScore: quality !== null && Number.isFinite(quality) ? quality : current.leadQualityScore,
  });
}

async function loadLatestScores(research: ResearchClient, observedAdIds: string[]): Promise<Map<string, LatestScoreRow>> {
  const latest = new Map<string, LatestScoreRow>();
  if (observedAdIds.length === 0) return latest;

  const { data, error } = await research
    .from("ad_quality_scores")
    .select("observed_ad_id,decision_id,scored_at")
    .in("observed_ad_id", observedAdIds)
    .order("scored_at", { ascending: false });

  if (error) {
    throw new Error(`Unable to load latest ad quality scores. Has the ad quality migration been applied? ${error.message}`);
  }

  for (const row of (data ?? []) as LatestScoreRow[]) {
    if (!latest.has(row.observed_ad_id)) latest.set(row.observed_ad_id, row);
  }
  return latest;
}

async function loadDecisionEvidence(research: ResearchClient, decisionIds: string[]): Promise<Map<string, Record<string, unknown>>> {
  const evidence = new Map<string, Record<string, unknown>>();
  const ids = [...new Set(decisionIds)];
  if (ids.length === 0) return evidence;

  const { data, error } = await research.from("agent_decisions").select("id,evidence").in("id", ids);
  if (error) {
    throw new Error(`Unable to load score decision evidence: ${error.message}`);
  }

  for (const row of (data ?? []) as AgentDecisionRow[]) {
    evidence.set(row.id, row.evidence ?? {});
  }

  return evidence;
}

async function persistAdQualityScore(research: ResearchClient, candidate: WinnerCandidate, score: ReturnType<typeof scoreWinnerCandidate>): Promise<void> {
  const { data: decision, error: decisionError } = await research
    .from("agent_decisions")
    .insert({
      decision_type: "ad_classification",
      subject_type: "observed_ad",
      subject_id: candidate.observedAdId,
      decision: {
        action: "score_ad_winner",
        scorer_version: WINNER_SCORER_VERSION,
        composite_score: score.compositeScore,
        is_winner: score.isWinner,
        market_relevant: score.review.marketRelevant,
      },
      rationale: score.review.rationale,
      confidence: Math.round(score.compositeScore),
      evidence: {
        creative_hash: candidate.creativeHash,
        ad_creative_id: candidate.adCreativeId,
        objective_score: score.score,
        objective_signals: score.signals,
        owned_performance_score: score.performanceScore,
        owned_performance: candidate.ownedPerformance ?? null,
        deterministic_review: {
          offer_clarity: score.review.offerClarity,
          local_relevance: score.review.localRelevance,
          lead_intent: score.review.leadIntent,
          brand_fit: score.review.brandFit,
          compliance_safety: score.review.complianceSafety,
          visual_hierarchy: score.review.visualHierarchy,
          tags: score.review.tags,
          warnings: score.review.warnings,
        },
      },
      hermes_skill: WINNER_SCORER_VERSION,
      model: null,
      cost_usd: 0,
    })
    .select("id")
    .single();

  if (decisionError || !decision?.id) {
    throw new Error(`Unable to create ad score decision: ${decisionError?.message ?? "missing decision id"}`);
  }

  const { error: scoreError } = await research.from("ad_quality_scores").insert({
    observed_ad_id: candidate.observedAdId,
    scorer_version: WINNER_SCORER_VERSION,
    model: null,
    image_model: null,
    longevity_days: score.longevityDays,
    is_active: candidate.isActive,
    creative_versions: candidate.creativeVersions,
    cross_agency_count: candidate.crossAgencyCount,
    objective_score: score.score,
    market_relevant: score.review.marketRelevant,
    offer_clarity: score.review.offerClarity,
    local_relevance: score.review.localRelevance,
    lead_intent: score.review.leadIntent,
    brand_fit: score.review.brandFit,
    compliance_safety: score.review.complianceSafety,
    visual_hierarchy: score.review.visualHierarchy,
    ai_score: score.review.score,
    composite_score: score.compositeScore,
    is_winner: score.isWinner,
    rationale: score.review.rationale,
    warnings: score.review.warnings,
    decision_id: decision.id,
  });

  if (scoreError) {
    throw new Error(`Unable to insert ad quality score for ${candidate.observedAdId}: ${scoreError.message}`);
  }
}

async function mineTemplateCandidates(research: ResearchClient): Promise<{ draftRows: number; protectedApprovedRows: number }> {
  const { data, error } = await research
    .from("ad_quality_scores")
    .select("observed_ad_id,decision_id,scored_at,objective_score,composite_score,scorer_version,rationale,is_winner")
    .eq("is_winner", true)
    .order("scored_at", { ascending: false })
    .limit(MINER_WINNER_LIMIT);

  if (error) {
    throw new Error(`Unable to load winner scores for template mining: ${error.message}`);
  }

  const latestScores = new Map<string, LatestWinnerScoreRow>();
  for (const row of (data ?? []) as LatestWinnerScoreRow[]) {
    if (!latestScores.has(row.observed_ad_id)) latestScores.set(row.observed_ad_id, row);
  }

  const creativeRows = await fetchCreativeRowsByObservedIds(research, [...latestScores.keys()]);
  const candidates = await enrichCandidateStats(
    research,
    creativeRows.map(mapCreativeRow).filter((candidate): candidate is WinnerCandidate => Boolean(candidate)),
  );
  const skeletons = await loadCreativeSkeletons(research, candidates.map((candidate) => candidate.observedAdId));
  const winners: WinnerForMining[] = candidates.flatMap((candidate) => {
    const score = latestScores.get(candidate.observedAdId);
    if (!score) return [];
    return [
      {
        ...candidate,
        compositeScore: Number(score.composite_score),
        objectiveScore: Number(score.objective_score),
        scorerVersion: score.scorer_version,
        rationale: score.rationale,
        creativeSkeleton: skeletons.get(candidate.observedAdId) ?? null,
      },
    ];
  });

  const drafts = buildTemplateDraftsFromWinners(winners, { keepPerCluster: 3, maxAdvertiserPerCluster: 1 });
  let draftRows = 0;
  let protectedApprovedRows = 0;

  for (const draft of drafts) {
    const result = await persistTemplateDraft(research, draft);
    if (result === "draft_written") draftRows += 1;
    if (result === "approved_protected") protectedApprovedRows += 1;
  }

  return { draftRows, protectedApprovedRows };
}

async function persistTemplateDraft(research: ResearchClient, draft: TemplateDraft): Promise<"draft_written" | "approved_protected"> {
  const { data: existing, error: existingError } = await research
    .from("ad_template_candidates")
    .select("template_key,status")
    .eq("template_key", draft.templateKey)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Unable to check existing template candidate ${draft.templateKey}: ${existingError.message}`);
  }

  if ((existing as { status?: string } | null)?.status === "approved") {
    return "approved_protected";
  }

  const subjectId = draft.sourceObservedAdIds[0] ?? draft.templateKey;
  const { data: decision, error: decisionError } = await research
    .from("agent_decisions")
    .insert({
      decision_type: "ad_classification",
      subject_type: "observed_ad",
      subject_id: subjectId,
      decision: {
        action: "mine_ad_template_candidate",
        scorer_version: draft.scorerVersion,
        template_key: draft.templateKey,
        cluster_key: draft.clusterKey,
        status: "draft",
      },
      rationale: draft.winnerRationale,
      confidence: Math.round(draft.evidenceScore),
      evidence: {
        source_observed_ad_ids: draft.sourceObservedAdIds,
        evidence_score: draft.evidenceScore,
        category: draft.category,
        hook_style: draft.hookStyle,
        funnel_stage: draft.funnelStage,
      },
      hermes_skill: "template-miner-v1",
      model: null,
      cost_usd: 0,
    })
    .select("id")
    .single();

  if (decisionError || !decision?.id) {
    throw new Error(`Unable to create template miner decision for ${draft.templateKey}: ${decisionError?.message ?? "missing decision id"}`);
  }

  if (draft.creativeSkeleton && draft.imageBriefId) {
    await persistCanonicalImageBrief(research, draft);
  }

  const { error: upsertError } = await research.from("ad_template_candidates").upsert(
    {
      template_key: draft.templateKey,
      status: "draft",
      updated_at: new Date().toISOString(),
      category: draft.category,
      audience: draft.audience,
      format: draft.format,
      hook_style: draft.hookStyle,
      funnel_stage: draft.funnelStage,
      adstudio_template_id: draft.adstudioTemplateId,
      offer_id: draft.offerId,
      goal: draft.goal,
      headline: draft.headline,
      primary_text: draft.primaryText,
      description: draft.description,
      cta: draft.cta,
      variables: draft.variables,
      image_brief_id: draft.imageBriefId,
      creative_skeleton: draft.creativeSkeleton ?? null,
      exemplar_observed_ad_ids: draft.exemplarObservedAdIds,
      evidence_score: draft.evidenceScore,
      source_observed_ad_ids: draft.sourceObservedAdIds,
      winner_rationale: draft.winnerRationale,
      compliance_note: draft.complianceNote,
      scorer_version: draft.scorerVersion,
      decision_id: decision.id,
    },
    { onConflict: "template_key" },
  );

  if (upsertError) {
    throw new Error(`Unable to upsert template candidate ${draft.templateKey}: ${upsertError.message}`);
  }

  return "draft_written";
}

async function persistCanonicalImageBrief(research: ResearchClient, draft: TemplateDraft): Promise<void> {
  if (!draft.creativeSkeleton || !draft.imageBriefId) return;

  const skeleton = draft.creativeSkeleton;
  const { error } = await research.from("ad_template_image_briefs").upsert(
    {
      brief_id: draft.imageBriefId,
      name: `${draft.category} ${draft.hookStyle}`.replace(/[_-]+/gu, " "),
      concept: skeleton.copy.hook_style,
      layout: skeleton.archetype,
      imagery: `${skeleton.shot.type}; ${skeleton.composition.focal_point}`,
      palette: skeleton.color.palette.join(", "),
      text_rules: `${skeleton.text_system.headline_zone}; ${skeleton.text_system.cta_style}`,
      formats: draft.format,
      ai_prompt_seed: skeleton.copy.headline_pattern,
      creative_skeleton: skeleton,
      skeleton_version: skeleton.version,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "brief_id" },
  );

  if (error) {
    throw new Error(`Unable to upsert canonical image brief ${draft.imageBriefId}: ${error.message}`);
  }
}

async function loadCreativeSkeletons(research: ResearchClient, observedAdIds: string[]): Promise<Map<string, CreativeSkeleton>> {
  const skeletons = new Map<string, CreativeSkeleton>();
  if (observedAdIds.length === 0) return skeletons;

  const { data, error } = await research
    .from("creative_skeletons")
    .select("observed_ad_id,creative_skeleton")
    .in("observed_ad_id", observedAdIds);

  if (error) {
    throw new Error(`Unable to load creative skeletons for template mining: ${error.message}`);
  }

  for (const row of (data ?? []) as CreativeSkeletonRow[]) {
    const parsed = creativeSkeletonSchema.safeParse(row.creative_skeleton);
    if (parsed.success) skeletons.set(row.observed_ad_id, parsed.data);
  }

  return skeletons;
}

async function recordRunSummaryDecision(research: ResearchClient, summary: RunSummary): Promise<void> {
  const { error } = await research.from("agent_decisions").insert({
    decision_type: "operator_chat",
    subject_type: "operator_query",
    subject_id: `nightly-winner-scorer:${new Date().toISOString()}`,
    decision: {
      action: "nightly_winner_scorer_summary",
      scorer_version: WINNER_SCORER_VERSION,
      summary,
    },
    rationale: "Nightly ad winner scorer and template miner completed with deterministic scoring and draft-only template writes.",
    confidence: summary.scoreFailures === 0 && summary.minerFailures === 0 ? 100 : 60,
    evidence: summary,
    hermes_skill: WINNER_SCORER_VERSION,
    model: null,
    cost_usd: 0,
  });

  if (error) {
    throw new Error(`Unable to record nightly winner scorer summary: ${error.message}`);
  }
}

function mapCreativeRow(row: RawCreativeRow): WinnerCandidate | null {
  const observed = firstNested(row.observed_ads);
  if (!observed) return null;
  const advertiser = firstNested(observed.advertiser_pages);

  return {
    observedAdId: row.observed_ad_id,
    adCreativeId: row.id,
    advertiserPageId: observed.advertiser_page_id,
    advertiserName: advertiser?.page_name ?? null,
    adType: row.ad_type,
    primaryIntent: row.primary_intent,
    format: row.format,
    headline: row.headline,
    body: row.body,
    cta: row.cta,
    primaryImageUrl: row.primary_image_url,
    videoUrl: row.video_url,
    creativeHash: row.creative_hash,
    classification: row.classification ?? {},
    firstSeenAt: observed.first_seen_at,
    lastSeenAt: observed.last_seen_at,
    deliveryStartedAt: observed.ad_delivery_started_at,
    deliveryStoppedAt: observed.ad_delivery_stopped_at,
    isActive: observed.active_status === "active",
    creativeVersions: 1,
    crossAgencyCount: 1,
  };
}

function templateKeyForCandidate(candidate: WinnerCandidate): string {
  return deriveTemplateKey(buildClusterKey(candidate));
}

function firstNested<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
