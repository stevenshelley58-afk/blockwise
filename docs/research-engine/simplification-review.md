# Research Engine Simplification Review

Date: 2026-06-08
Status: proposal for approval — no code changed yet
Scope: full review of the Hermes ad-research system with the goals of (1) radical simplification, (2) zero silent failure, (3) maximum use of Hermes self-improvement, (4) cheapest-possible capture costs.

Owner decisions already made (recorded from review session):

1. **Capture source**: cheapest paid service that works, free wherever possible.
2. **Trust gate**: census-first is too strict — use a cheap LLM agent reviewing ad copy / page name / image to decide real-estate visibility; census becomes enrichment.
3. **Agent autonomy**: full autonomy for the Hermes self-improvement loop (within data/config boundaries; never code, secrets, schema, or auth).

---

## 1. Why it keeps failing — root causes with evidence

**RC1. One 4,559-line file does everything.** `supabase-supervisor.mjs` implements 9 job types, 3 capture providers, all parsers, watchdogs, retries, and ingestion. 67 unique env vars configure it. Any change risks everything, so every "fix attempt" by a different agent session has added code instead of changing it. A parallel TypeScript library (`research-runtime/src/`, 428 LOC) is dead code — never imported by the deployed `.mjs` files.

**RC2. Failure is recorded but never consumed.** Live numbers (2026-06-08): 3,163 coverage defects created in the last 7 days, **0 resolved**. 2,891 open + 272 blocked. `ingest_events`, watchdog anomaly rows, `media_assets.capture_status='failed'`, `consecutive_failed_checks`, and 1,359 hidden creatives have **no reader** — no console view, no alert, nothing. The system is a write-only failure log. This is the definition of silent failing.

**RC3. The only viable ad source has a single fragile parser and no evidence trail.** Meta's official Ad Library API cannot return AU commercial ads (ALL is EU-only; HOUSING_ADS is US-only), so browser capture of the public Ad Library is the only real source. When Meta changed the embedded payload shape, 309 jobs blocked with the identical error *"Meta Ad Library page loaded but no ad result payload could be parsed"* — and the failing DOM was never saved (the `research-raw-evidence` bucket is env-wired but never written), so the parser can't even be fixed from evidence. Meanwhile ~280 LOC of official-API code sits enabled-by-default doing nothing useful for AU.

**RC4. The strict census-first gate starves the database.** 598 pages are verified-real-estate-but-unresolved; 992 resolver jobs are blocked "no verified meta page". Of 2,785 stored ads: only 945 (34%) have any location attribution, 580 (21%) link to an agency, 192 (7%) link to an agent. The customer view inner-joins `ad_area_matches`, so two-thirds of collected ads are invisible to location queries. **This is why you cannot query by agent, agency, or location** — the ads exist but the joins don't.

**RC5. Docs, tests, and code disagree.** The system map says 5 handled job types and "no location-based discovery anywhere"; the code handles 9 job types including `blockwise-location-ad-search` (1,410 completed location-search fetch runs in production). `hermes-vps-deployment.md` forbids Meta API tokens that the supervisor actively reads. Every new agent session "fixes" toward whichever document it read first. **This contradiction loop is why repeated attempts keep failing.**

**RC6. The runtime ships throttled.** The deployment contract sets `HERMES_RESEARCH_MODE=maintain` (claim 1 job/tick default) and `BLOCKWISE_RESEARCH_RUNTIME_ENABLED=false`. Two build_runs are open simultaneously (one build, one maintain — the mode has flapped). 563 due jobs sit pending right now. Nothing measures "is the backlog draining"; uptime-kuma only checks the container responds, so the pipeline can be dead while monitoring is green.

---

## 2. Live evidence snapshot (2026-06-08)

| Metric | Value | Meaning |
| --- | --- | --- |
| Coverage defects open / blocked | 2,891 / 272 | nothing consumes them |
| Defects created vs resolved, 7d | 3,163 vs 0 | write-only failure log |
| Ads stored | 2,785 | collection partially works |
| Ads with location attribution | 945 (34%) | location queries blind to 66% |
| Ads linked to agency / agent | 580 (21%) / 192 (7%) | agent/agency queries mostly empty |
| Creatives hidden / displayable | 1,359 / 1,426 | half of everything invisible, no review queue |
| Jobs blocked on one parser error | 309 | single point of failure, no evidence saved |
| Resolver jobs blocked | 992 | census-first dead end |
| Due jobs sitting pending | 563 | runtime throttled / not draining |
| Pages: unresolved / collectable / no-ads | 598 / 42 / 230 | funnel inverted |

---

## 3. Target design — one loop, four verbs

Replace the census→resolver→collector chain-of-gates with a single ranked work loop:

```
DISCOVER  →  CAPTURE  →  ATTRIBUTE  →  REVIEW
(location search,   (one provider     (location + agency   (cheap LLM gate,
 page refresh,       chain with        + agent links,        sampling QA,
 ranked geo tiers)   auto-failover)    mandatory)            census enrich)
```

**DISCOVER.** Geographic tiers stored as data (Perth metro → WA → AU capitals → national). Location-ad-search (already implemented and producing 1,410 runs) becomes the primary discovery engine; page refresh keeps known pages current. Pages discovered by location search are auto-created as candidate pages — no census prerequisite. Census continues as roster *enrichment* (agency/agent identity), not a gate.

**CAPTURE.** One provider chain, config-as-data: `self-hosted browser (free, primary) → paid endpoint (fallback) `. Every parse failure saves the DOM + screenshot to `research-raw-evidence` (already wired, currently unwritten). A canary capture (a page known to always run ads, e.g. a national portal) runs every 30 minutes; on canary failure the supervisor pauses mass capture, flips provider, and raises an alert — this kills the 309-identical-errors pattern permanently. Delete the official-API path (~280 LOC): it cannot serve AU commercial ads.

**ATTRIBUTE.** An ad is not "ingested" until it has: ≥1 `ad_area_matches` row (minimum: the search area that found it — new additive match_type `source_search_area`, plus `copy_mention`/`landing_url`/service-area inference), and a page→agency/agent link attempt. Backfill the 1,840 unattributed ads from existing copy, landing URLs, and the roster. Customer view keeps the inner join — but now everything qualifies.

**REVIEW.** The trust gate becomes the classifier (per your decision): deterministic regex as cheap prefilter, then a cheap OpenRouter model (the `ad_classification` model slot already exists) over copy + page name, vision call only when text is inconclusive. Census verification upgrades confidence when it lands. Hidden creatives get a visible review queue, and the agent samples both hidden and displayable daily to measure its own precision.

**Status model.** Replace the 5 conflated page statuses with two orthogonal fields: `identity` (candidate / verified) and `collection_health` (never_checked / ok / no_ads_confirmed / failing), plus `last_capture_at` / `next_check_at`. Console shows plain language; "checked: no ads returned (via <provider>, <date>)" replaces "no_ads_confirmed".

**Config-as-data.** Replace ~50 of the 67 env vars with a `research.runtime_settings` table read each tick (cadences, batch sizes, provider order, geo tier, pause flags, spend caps). Env keeps only secrets + bootstrapping (~15 vars). This is also what makes full agent autonomy safe — see §5.

---

## 4. The no-silent-failure contract

One rule, enforced in code: **every failure ends in exactly one of (a) capped retry, (b) automatic repair, (c) a defect with evidence + owner + next action, or (d) an operator alert. Nothing else is permitted to exist.**

1. **`research.v_health`** — one row: heartbeat age, due-backlog size, blocked count by signature, parse-fail rate (24h), canary status, % ads attributed, % creatives reviewed, open defect count. The only health surface; console renders it as the first screen.
2. **`/api/operator/research/health`** returns HTTP 503 whenever any v_health field is red. Point the already-deployed uptime-kuma at it — uptime-kuma natively sends email/Telegram/webhook notifications. Alerting with zero new dependencies.
3. **Absence requires proof.** "No ads" is only recorded when the page loaded AND the empty-state marker parsed. Zero-results-without-proof is a capture failure with stored evidence. Nightly re-check of `no_ads_confirmed` pages older than 7 days (the current 230 were judged by the broken parser and are suspect).
4. **Defects become a workflow, not a landfill.** Every defect carries a signature; the self-review skill clusters by signature daily, mass-resolves clusters whose root cause is fixed, and escalates *new* signatures to the morning report. Standing target: <100 open defects.
5. **No more swallow-and-complete.** Media-collector jobs that fail every asset must file a defect, not complete; schema-mismatch silent column-dropping (`patchMediaAsset`, `insertCoverageDefect`) becomes a hard failure; hidden creatives appear in a review queue with counts on v_health.
6. **Pages that stop being checked must say so.** `consecutive_failed_checks >= 3` currently silently removes a page from refresh forever; instead it sets `collection_health=failing`, files a defect, and the self-review loop retries weekly.

---

## 5. Hermes self-improvement — full autonomy, safely bounded

What exists today (verified): skills hot-reload (`auto_reload=true`), mem0 wired (read-only), OpenRouter per-task model slots, prompt-manager skill with version/activate/rollback, model-router skill, two cron jobs, coverage-auditor + defect-investigator skills (currently unreachable — no handler). The agent can already write queue rows, defects, and decisions; it cannot touch code, env, or schema. Keep that hard boundary; widen the middle with **settings-as-data**:

**The autonomy surface** (all writes audited as `agent_decisions` rows):

| Agent may autonomously | Mechanism |
| --- | --- |
| Flip capture provider / pause mass capture | `runtime_settings` |
| Tune cadences, batch sizes, concurrency within caps | `runtime_settings` |
| Advance geo tier when coverage targets met | `runtime_settings` |
| Requeue / recycle blocked job clusters | work_queue writes |
| Re-check suspect no-ads pages, retry failing pages | work_queue writes |
| Mass-resolve defect clusters with fixed root cause | coverage_defects |
| Version and roll back its own classifier prompt | prompt-manager (exists) |
| Choose models per task within spend cap | model-router (exists) |
| Remember per-target quirks and yesterday's state | mem0 (enable writes) |

**Daily self-review cron** (new skill, the keystone): read v_health and deltas vs yesterday (mem0) → requeue transient clusters → run canary decision → sample 20 classifications (10 hidden / 10 displayable), grade with the critic model, roll the prompt version if precision <95% → triage defect signatures → write a morning report (decision row + alert webhook). **Weekly**: re-give coverage-auditor its cron, re-resolve a sample of the 598 unresolved pages, and evaluate geo-tier advancement.

Spend stays bounded by `HERMES_DAILY_SPEND_LIMIT_USD` plus a per-provider monthly cap in settings.

---

## 6. Cost plan — cheapest that works

**Free (the default path).** Self-hosted Steel browser capture stays primary; classifier prefilter is regex (free); cheap-model classification of ~3k ads costs single-digit dollars once, then cents/day; all alerting via existing uptime-kuma.

**Paid (fallback + verification only).** Wire the existing `HERMES_META_CAPTURE_ENDPOINT` (`http_json` provider — already built) to one vendor adapter:

| Vendor | Price | Notes |
| --- | --- | --- |
| Apify actors (e.g. automly, constructive_calm) | ~$0.49–0.75 / 1,000 ads | cheapest credible; pay-per-result |
| ScrapeCreators | pay-as-you-go, no monthly minimum | simplest API; good fallback fit |
| SearchAPI.io | $2–4 / 1,000 searches (~25 ads/search) | pricier; strong docs |

Used only when the canary trips or as a weekly cross-check, expect **$5–20/month** early, ~$50–80/month at full WA scale only if the free path is down often. Start pay-as-you-go; no subscription until usage proves it.

### Apify cost controls (mandatory if Apify is the vendor)

Post-mortem of the June blowout: $219.28 went to `apify/facebook-ads-scraper` (the official actor, effectively ~$4.30/1k ads — 7–9× dearer than automly/constructive_calm) via uncapped runs on day 1 of the billing period; ~51k ad events were charged and **none of them appear in the research DB** (no Apify provider rows exist in `ad_fetch_runs`). The Apify account hard limit stopped it at $220. Lessons baked into the design:

1. **Per-run hard cap.** Every Apify run is created with `maxTotalChargedUsd` (≤ $1) on the run-creation API call, plus the actor input's own `count`/`maxResults` cap (mirror `HERMES_META_CAPTURE_RESULTS_LIMIT`, 250) and a timeout. A runaway run cannot exceed $1 even if everything else fails.
2. **Pre-dispatch budget check.** Before any Apify call the supervisor reads `GET /v2/users/me/limits` (returns `monthlyUsageUsd` vs `maxMonthlyUsageUsd`) and our own ledger; if month-to-date ≥ the provider cap in `runtime_settings` (default $25), the provider is circuit-broken: fall back to browser or pause + alert. Our soft cap sits *below* the Apify account limit so we always stop first.
3. **Own ledger.** `ad_fetch_runs.cost_usd` (column already exists) records the charged amount per run; `v_health` shows month-to-date spend per provider; the morning report includes it. Spend with no ingested rows (the June failure mode) is itself a red health condition.
4. **Account backstop.** Keep Apify's custom monthly limit set low (e.g. $30 — adjustable via `PUT /v2/users/me/limits` or the UI) with email notifications on. Two independent brakes: ours (smart, early) and Apify's (dumb, final).
5. **Right actor, right plan.** Use a ~$0.49–0.75/1k actor, not the $4.30/1k official one. The current $199/month prepaid subscription dwarfs expected usage — review/downgrade once P1 proves real fallback volume.
6. **Fallback-only dispatch.** Apify is never a primary firehose: it is called per due page/search with dedupe, only when the canary trips or for the weekly cross-check, so spend is bounded by work the pipeline actually needs.

---

## 7. Deletions and cleanups

| Item | Saving |
| --- | --- |
| Dead TS library `research-runtime/src/` | 428 LOC |
| Official Meta API path + config + its test | ~310 LOC |
| `_archive/research-orchestrator-legacy-20260530/` | ~50 MB |
| Orphan `blockwise-page-recovery` queue rows (25) | DB noise |
| Stale docs (system-map, vps doc, known-limitations claims) → regenerate one canonical `SYSTEM.md` | kills the contradiction loop |
| Root-level done/obsolete plan files (HERMES-FIXES-PROMPT.md, CODEX-BROWSERBASE-REMOVAL-PLAN.md, HANDOFF.md) → archive | repo clarity |
| Env vars 67 → ~15 (+ settings table) | config surface |
| Close stale open build_runs; single mode source of truth | state clarity |
| Supervisor target after refactor | ≤ ~2,000 LOC in same file layout (no 1→5 file explosion) |

Tests: update the collector-contract and system-map-derived tests to the new contract (location discovery first-class; collector still page-targeted per capture; classifier-led gate). Add: ingestion requires area match; absence requires proof; parse failure stores evidence; canary circuit breaker; health endpoint turns red.

---

## 8. Rollout — each phase gated by acceptance, next phase blocked until green

**P0 — Stop the bleed (day 1).** Evidence-on-parse-failure; canary + circuit breaker; `v_health` + 503 health endpoint + uptime-kuma alert; set build mode + runtime-enabled in one place; close the stale build_run. *Accept: induced parser failure alerts within 30 min and pauses capture; backlog visibly drains.*

**P1 — Capture reliability (week 1).** Fix the parser against stored evidence; vendor adapter on `http_json` + auto-failover; requeue the 309 parse-fail blocks; re-check all 230 no-ads pages. *Accept: parse-fail rate <5%; canary green 72h; no_ads list re-verified.*

**P2 — Attribution & trust gate (week 2).** Classifier-led gate (cheap LLM); mandatory area attribution on ingest + backfill 1,840 ads; agency/agent link backfill; two-axis page status + console relabel; hidden-creative review queue. *Accept: ≥95% of ads have location attribution; agent/agency/location queries return data; hidden count visible and falling.*

**P3 — Self-improvement (week 3).** `runtime_settings` table; daily self-review cron with full-autonomy surface; defect signature triage; classifier prompt versioning + precision sampling; mem0 writes. *Accept: 7 unattended days of morning reports; open defects <100; zero manual interventions required.*

**P4 — Scale.** Geo tier advancement Perth → WA → capitals → national, agent-driven against coverage targets and health greenness.

---

## 9. AGENTS.md compliance

Schema work is explicitly requested (additive only: `runtime_settings`, new match_type values, `v_health`, status columns; migration assertions included). No new dependencies (vendor adapter is plain `fetch`; alerting is existing uptime-kuma). Public API response shapes preserved (views change additively). Auth untouched. Net production LOC: deletions (~740 LOC + dead archive) offset additions; report per-PR numbers as required. This is explicitly-requested feature/cleanup work — not a "simplification PR" in the AGENTS.md sense (that label forbids schema changes), so tag PRs accordingly.

## 10. Open items for the owner

1. Pick the fallback vendor (recommend starting ScrapeCreators PAYG or the cheapest Apify actor after a 100-ad trial of each — both have free trial credits).
2. Choose the cheap classifier model slot (any sub-cent vision-capable model on OpenRouter; configurable, never pinned in code).
3. Confirm the canary page(s) — ideally 2–3 large advertisers that never stop running ads (e.g. national portals/franchise groups).
