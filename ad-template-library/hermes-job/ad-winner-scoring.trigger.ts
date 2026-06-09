/**
 * PROPOSAL skeleton — lighter trigger.dev alternative to the Hermes skill pair.
 * Place in ./trigger to activate (mirrors trigger/provider-sync.ts). Left here in
 * /ad-template-library/hermes-job so it is NOT auto-deployed before review.
 *
 * Governance: each score write must also create a research.agent_decisions row and
 * record the AI run (omitted here for brevity — wire to the same helpers AdStudio
 * uses: recordAdStudioProviderRun + ai_usage_ledger). Resolve models via
 * model_profiles. Templates are written status='draft' for operator approval.
 */
import { schedules } from "@trigger.dev/sdk/v3";
import { createSupabaseServiceClient } from "../src/lib/supabase/service.ts";
// import { scoreAdStudioVariant } from "../src/lib/adstudio/scoring.ts"; // reuse the 6-dim rubric
// import { resolveRuntimeModelProfile } from "../src/lib/operator/prompts/model-profile-runtime.ts";

type Candidate = {
  observed_ad_id: string; ad_type: string; format: string; headline: string | null;
  body: string | null; cta: string | null; primary_image_url: string | null;
  days_running: number; is_active: boolean; versions: number; cross_agency_count: number;
  creative_hash: string | null;
};

function objectiveScore(c: Candidate): number {
  const longevity = Math.min(c.days_running, 365) / 365 * 40;
  const active = c.is_active ? 15 : 0;
  const iter = Math.min(c.versions, 10) / 10 * 20;
  const adoption = Math.min(c.cross_agency_count, 10) / 10 * 15;
  const complete = c.headline && c.cta ? 10 : 0;
  return Math.round(longevity + active + iter + adoption + complete);
}

export const scoreAdWinnersNightly = schedules.task({
  id: "score-ad-winners-nightly",
  cron: "0 16 * * *", // ~02:00 AEST
  maxDuration: 280,
  run: async () => {
    const supabase = createSupabaseServiceClient();

    // 1) candidate ads changed since last score (no arbitrary SQL in the Hermes
    //    variant — there it goes through the signed ingestion boundary instead).
    const { data: candidates, error } = await supabase
      .schema("research")
      .rpc("select_unscored_real_estate_ads", { batch_limit: 200 }); // proposed RPC
    if (error) throw new Error(error.message);

    let scored = 0, winners = 0;
    for (const c of (candidates ?? []) as Candidate[]) {
      const objective = objectiveScore(c);

      // 2) AI review (best text + vision model). Pseudocode — wire to your provider.
      //    const model = await resolveRuntimeModelProfile("adstudio.copy.system");
      //    const ai = await reviewAd({ model, copy: c, imageUrl: c.primary_image_url });
      const ai = {
        market_relevant: true, ai_score: 0,
        dimensions: { offerClarity: 0, localRelevance: 0, leadIntentStrength: 0,
                      brandFit: 0, complianceSafety: 0, visualHierarchy: 0 },
        rationale: "", warnings: [] as string[],
      };

      const composite = Math.round(0.5 * objective + 0.5 * ai.ai_score);
      const isWinner = ai.market_relevant && composite >= 70;

      // 3) upsert score (+ agent_decisions + ai_runs — omitted)
      await supabase.schema("research").from("ad_quality_scores").insert({
        observed_ad_id: c.observed_ad_id, scorer_version: "winner-scorer-v1",
        longevity_days: c.days_running, is_active: c.is_active,
        creative_versions: c.versions, cross_agency_count: c.cross_agency_count,
        objective_score: objective, market_relevant: ai.market_relevant,
        ...ai.dimensions, ai_score: ai.ai_score, composite_score: composite,
        is_winner: isWinner, rationale: ai.rationale, warnings: ai.warnings,
      });
      scored++; if (isWinner) winners++;
    }

    // 4) re-cluster winners → template candidates (status='draft'); dedupe + cap
    //    per (category × hook × funnel) for variety. Proposed RPC keeps SQL server-side.
    const { data: mined } = await supabase
      .schema("research").rpc("refresh_template_candidates", { keep_per_cluster: 4 });

    return { scored, winners, draftTemplates: (mined as { drafts?: number } | null)?.drafts ?? 0 };
  },
});
