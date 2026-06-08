# Codex Kickoff — Research Engine Rebuild (lean core)

Date: 2026-06-08
This is the single entry point. Work top to bottom. Do not start coding until the pre-flight section passes.

## Read order (before anything)

1. `AGENTS.md` — engineering rules. Binding.
2. `docs/research-engine/simplification-review.md` — the approved architecture (v2 lean core + robustness walkthrough). This is the design source of truth; where older docs disagree with it, they are stale.
3. `docs/research-engine/codex-task-apify-cost-controls.md` — Apify adapter + cost controls spec (slotted into the phases below).
4. Treat `hermes-system-map.md`, `hermes-vps-deployment.md`, `known-limitations.md`, and `hermes/README.md` as **historical reference only** — they describe the system being replaced and contradict the code in places (documented in the review §1 RC5).

## Locked owner decisions (do not relitigate)

1. Cheapest paid capture that works; free browser path primary.
2. Classifier-led trust gate (cheap LLM on copy/page/image); census/roster is enrichment, never a gate.
3. Hermes has full autonomy over data/config (`targets`, `runtime_settings`, prompt versions, model choice — all audited); never code, env secrets, schema, auth.
4. Less complexity: net production LOC must fall; concept counts in review §7 are acceptance criteria.

## Pre-flight (verify, don't assume)

1. `npm run typecheck && npm run test:research && npm run test:hard-reset` green on main before any branch.
2. CodeGraph freshness per AGENTS.md (`codegraph status`; `codegraph sync` if stale).
3. Supabase: project `uwwbvdloschaccycjozr`, schema `research`. Confirm live counts roughly match review §2 (if wildly different, stop and report — the ground truth has moved).
4. Confirm the operator checklist below is done (env/secrets are operator-owned; never commit tokens).

### Operator checklist (Steve — human-only items)

- [ ] `APIFY_TOKEN` added to the VPS Coolify env (never in the repo).
- [ ] Apify: no schedules/saved tasks pointing at `apify/facebook-ads-scraper`; account limit raised (done 2026-06-08); plan downgrade decision deferred to P1 exit.
- [ ] Free external monitor account (e.g. UptimeRobot) ready to point at the health endpoint when P0 ships.
- [ ] Pick fallback actor to wire first (default: trial `automly/facebook-ad-library-scraper` and `constructive_calm/facebook-ad-library-pro` with $0.25-capped runs, keep the better).
- [ ] Pick classifier model slot (any sub-cent vision-capable OpenRouter model) → `HERMES_OPENROUTER_MODELS_JSON.ad_classification`.

## Phases → PRs (one PR per phase, gated; do not start N+1 until N's acceptance passes)

### PR-0 — Stop the bleed (review §8 P0) — smallest possible diff to the CURRENT loop

1. On Meta capture parse failure: save DOM + screenshot to `research-raw-evidence` (bucket env-wired, currently never written).
2. `research.v_health` view + `/api/operator/research/health` route returning 503 when red (fields per review §4.3). Heartbeat = worker writes a settings/heartbeat row each tick.
3. Runtime env fix on VPS: `BLOCKWISE_RESEARCH_RUNTIME_ENABLED=true`, `HERMES_RESEARCH_MODE=build`, close the stale duplicate `build_runs` row.
4. Operator points the external monitor at the health endpoint.

*Accept:* induced parse failure produces stored evidence and a monitor alert within 30 min; due-job backlog visibly drains; health goes red when the worker is stopped.

### PR-1 — Lean core cutover (review §3) + Apify adapter (cost-controls spec B1–B3, B5 + canary contract)

1. Additive migration: `research.targets`, `research.runtime_settings` (+ `capture_actors` seed if implementing the canary/benchmark data there). Migration assertions required.
2. One loop: due-targets select with `FOR UPDATE SKIP LOCKED`, bounded concurrency (~4), hard per-target timeout. Three handlers (page / search / roster) calling capture + inline ingest. Crash-only: every step an idempotent upsert.
3. Capture chain: browser → on parse failure, evidence + Apify fallback (per-run Apify `maxTotalChargeUsd` ≤ $1, result cap 250, budget guard, ledger to `ad_fetch_runs.cost_usd`). Trailing parse-fail rate >50% over last 20 browser captures flips provider order in settings + alerts. Canary contract per the cost-controls spec — prefer implementing canaries as flagged high-priority `targets` rows rather than a new table.
4. Ingest: snapshot only on content-hash change; lifecycle rule (only successful full page capture marks missing ads inactive; searches never imply absence); area match on every ad (search-derived = low confidence); agency/agent link from roster.
5. Seed targets from existing pages + refresh policies + Perth-tier suburb searches + brand searches for known agencies (replaces resolver). Stop writing work_queue/refresh_policies/build_runs. Fix the browser parser against the evidence captured in PR-0.
6. Delete in this PR: official Meta API path (~280 LOC), dead TS library (428 LOC), orphan `blockwise-page-recovery` rows.

*Accept:* parse-fail <5%; canary green 72h; old control tables idle; the 230 `no_ads_confirmed` pages re-checked as ordinary targets; supervisor ≤ ~1,500 LOC and falling; Apify ledger shows real costs per run.

### PR-2 — Trust gate + attribution (review §8 P2)

Classifier-led displayability (regex prefilter → cheap LLM → vision only if inconclusive); re-run ingest over all stored ads to backfill attribution (no separate backfill system); console first screen = v_health + failing targets, plain language.

*Accept:* ≥95% of ads have ≥1 area match; agent/agency/location queries return data; hidden/pending counts visible and falling.

### PR-3 — Self-improvement (review §5) + Apify autonomy (cost-controls B4)

Daily self-review skill (retry/stretch targets, provider flips, geo-tier advancement, 20-sample classification precision check with prompt-version rollback, spend report → morning report). Apify price poll + capped benchmark + actor promotion per B4. Account backstop (B5) asserted from settings.

*Accept:* 7 unattended days of morning reports; no manual interventions; open question list empty or escalated.

### PR-4 — Demolition + scale (review §8 P4)

Backup, then drop old control tables; delete coverage_defects/ingest_events writers, stale docs (regenerate one `SYSTEM.md`), `_archive` legacy orchestrator, uptime-kuma container; env vars to ~10. Geo tiers advance Perth → WA → capitals → national, agent-driven.

*Accept:* concept counts in review §7 verified; net production LOC decrease reported.

## Hard do-nots

1. No new npm dependencies anywhere.
2. No schema changes beyond the additive ones specified (+ P4 drops after backup).
3. No changes to auth, public API response shapes, or customer view shapes.
4. Never commit secrets; never bypass Meta login walls/CAPTCHAs (public data only).
5. No Apify run without `maxTotalChargeUsd` + result cap — test-enforced.
6. Don't "improve" by adding subsystems. If a fix wants a new table/queue/workflow, re-read review §7 and find the deletion instead.

## Per-PR reporting (AGENTS.md)

Production LOC before/after, net change, files created/deleted, largest file before/after, duplicated code removed, behaviour changed yes/no, plus: `npm run typecheck`, `npm run test:research`, `npm run test:hard-reset` outputs, and the phase acceptance evidence (queries/screenshots).

## Live verification queries (run after each deploy)

```sql
-- heartbeat + backlog
select * from research.v_health;
-- targets draining
select kind, count(*) filter (where next_check_at <= now()) as due,
       count(*) filter (where consecutive_failures >= 3) as failing
from research.targets group by 1;
-- attribution completeness
select count(*) as ads,
       count(*) filter (where exists (select 1 from research.ad_area_matches m where m.observed_ad_id = a.id)) as with_area
from research.observed_ads a;
-- paid spend this month
select coalesce(sum(cost_usd),0) from research.ad_fetch_runs
where source_provider like 'apify:%' and started_at >= date_trunc('month', now());
```
