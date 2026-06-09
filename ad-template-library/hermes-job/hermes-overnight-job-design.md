# Overnight Winner-Scoring + Template-Mining Job — Design

**Goal:** every night, AI-review newly-ingested real-estate ads, score them for quality, keep only "the good stuff", and refresh a searchable library of copy + image templates — automatically, with a human approval gate.

This turns the one-off mining behind `Blockwise-Ad-Template-Library.xlsx` and the Ad Template Studio dashboard into a self-maintaining pipeline.

---

## Where it fits

You already have the ingestion + classification half:

```
Hermes (VPS)                                    Next app / trigger.dev
census → page-resolver → ad-collector           provider-sync (cron 0 */6)
       → ad-classifier  (tags type/hook/style)  adstudio (copy/image gen + scoring.ts)
```

This job adds **two steps after the classifier**:

```
… → blockwise-ad-classifier
      → blockwise-ad-winner-scorer   (NEW: score every classified ad)
      → blockwise-template-miner     (NEW: cluster winners → template candidates)
            → operator approves draft templates
                  → AdStudio offers/templates + research.v_ad_template_library
                        → Ad Template Studio dashboard (live)
```

**Recommended placement: a new Hermes skill pair** (`blockwise-ad-winner-scorer`, `blockwise-template-miner`) on the VPS, reusing `tools/research-runtime` (queue/worker/supervisor + OpenRouter client) and the existing classifier boundary. This keeps AI ad-review on the Hermes side and satisfies the governance rules below.

A lighter alternative — a trigger.dev `schedules.task` in the Next app — is included as `ad-winner-scoring.trigger.ts` for teams who prefer to keep it in the app deploy.

---

## Governance (non-negotiable, from hermes/README + AGENTS.md)

1. **Every write is a decision.** Each `ad_quality_scores` / `ad_template_candidates` upsert creates a matching `research.agent_decisions` row with evidence, confidence, rationale, and model/cost trace. The new tables carry a `decision_id` FK.
2. **Model governance.** Use `model_profiles` / `model_profile_versions` to resolve the text + vision models (same path AdStudio uses). Record runs in `ai_runs` / `ai_usage_ledger` / `adstudio_provider_runs`.
3. **No arbitrary SQL from skills.** Writes go through the signed ingestion API / approved Hermes tool boundary (or, for the trigger.dev variant, the service client — same as `provider-sync.ts`).
4. **Additive schema only.** New tables live in `research` (see `migration-proposal_ad_quality_and_templates.sql`). No existing table, view, API shape, auth, or provider behaviour changes. Apply only with migration assertions in the test suite.
5. **Human gate.** Templates are written `status='draft'`. An operator approves before they reach AdStudio or customers — no auto-publish.

---

## The quality gate — how "good" is decided

Two layers, combined. This is what keeps only the good stuff.

### Layer 1 — objective signals (computed, free, deterministic)
| Signal | Source | Why it proxies performance |
| --- | --- | --- |
| Longevity (days running) | `ad_delivery_started_at` → `stopped_at`/`last_seen_at` | Ads that run for months are the ones converting. 209 ads in your DB run 180+ days. |
| Still active | `active_status='active'` + recent `last_checked_at` | Currently worth spending on. |
| Creative iteration | `count(ad_creative_versions)` | Advertisers only iterate creatives they're investing in (max seen: 14). |
| Cross-agency adoption | # distinct advertisers running the same angle | A pattern many independents run is proven, not a one-off. |

`objective_score` (0–100) is a weighted blend (suggested: longevity 40, active 15, iteration 20, recency 10, copy-completeness 15 — the same weights used to seed the current library).

### Layer 2 — AI review (best text + vision model)
For each ad above an objective pre-filter, the model returns:
- **market_relevant** (bool) — AU residential real estate for our customers? This **drops the overseas "Costa del Sol" / foreign-language cluster** that scores high on longevity but is irrelevant. (Found in the seed data — a pure-longevity gate would wrongly surface it.)
- **AdStudio 6-dimension rubric** (matches `src/lib/adstudio/scoring.ts`): offerClarity /20, localRelevance /15, leadIntentStrength /20, brandFit /15, complianceSafety /20, visualHierarchy /10 → `ai_score` /100. Vision model judges `visualHierarchy` + extracts the image brief from the actual creative.
- **pattern extraction** — the reusable headline/primary_text/cta with `{{slots}}`, plus category / audience / format / hook / funnel tags.

`composite_score = 0.5·objective_score + 0.5·ai_score`, and `is_winner = market_relevant AND composite_score ≥ threshold` (start ~70; tune against the seed library, whose winners sit 64–100).

---

## Nightly flow

```
cron 0 16 * * *  (≈ 02:00 AEST)        maxDuration honoured; idempotent
1. SELECT candidate ads
   - real_estate gated (classification->>'is_real_estate_ad'='true')
   - body present, no unresolved '{{…}}' scrape placeholders
   - changed since last score (creative_hash differs) OR never scored
2. For each batch (e.g. 25):
   - compute objective signals (Layer 1)
   - resolve models via model_profiles; call text model (copy) + vision model (image)
   - get rubric + market_relevant + extracted pattern (Layer 2)
   - upsert research.ad_quality_scores  (+ agent_decisions, + ai_runs/cost)
3. Re-cluster winners → template candidates
   - group is_winner ads by (category × hook_style × funnel_stage)
   - dedupe near-identical copy (normalise headline/body; creative_hash)
   - keep top-N per cluster for VARIETY (cap so one agency can't dominate)
   - upsert research.ad_template_candidates (status preserved if already approved)
4. Emit run summary (scored, winners, new drafts) to operator review queue
```

Variety is enforced structurally: clustering by `category × hook × funnel` and capping per cluster guarantees the library spreads across angles, audiences, formats and hooks rather than collapsing onto the single longest-running category.

---

## Suggested model prompt (text + vision)

> System: You are reviewing a real estate ad for an Australian agent-marketing platform. Decide if it is relevant to AU residential real estate for our customers. Score it on six dimensions (offerClarity 0-20, localRelevance 0-15, leadIntentStrength 0-20, brandFit 0-15, complianceSafety 0-20, visualHierarchy 0-10). Then extract a reusable template: a headline and primary text with `{{variables}}` (suburb, agent_name, price, beds…), a CTA, and tags (category, audience[], format, hook_style, funnel_stage). Flag any compliance risk (housing special-ad-category, discriminatory targeting, guaranteed-price claims, missing privacy policy). Return strict JSON.

Feed the creative image to the vision model for `visualHierarchy` and the image brief (layout/imagery/palette/text-zones). Persist the prompt bundle via the existing `adstudio.copy.*` prompt-governance path so it's versioned.

---

## Rollout

1. Add migration (with assertions) — `migration-proposal_ad_quality_and_templates.sql`.
2. Seed `ad_template_image_briefs` + `ad_template_candidates` from `library.json` (this delivery) so the table starts populated and approved.
3. Ship `blockwise-ad-winner-scorer` (score-only; no template writes) — verify scores against the seed winners.
4. Ship `blockwise-template-miner` writing `status='draft'`; add an operator approval surface (reuse `operator_approvals`).
5. Point the Ad Template Studio dashboard + AdStudio "new ad" dialog at `research.v_ad_template_library`.
6. Tune threshold + weights; add CHECK constraints for the rubric ceilings.

## Cost control
Pre-filter on objective signals before any AI call (most short-lived listing ads never reach the model). Only re-score on `creative_hash` change. Batch + cache by `creative_hash`. Track spend in `ai_usage_ledger`; cap per-night via `ai_cost_policies`.
