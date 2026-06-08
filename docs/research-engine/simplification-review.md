# Research Engine Simplification Review (v2 — lean core)

Date: 2026-06-08
Status: proposal for approval — no code changed yet
v2 note: v1 of this review added control machinery (canary subsystem, defect triage workflow, actor benchmarking). v2 removes those: the goal is fewer concepts, not better-managed complexity. Where v1 said "manage it", v2 says "delete the structure that makes it possible".

Owner decisions (recorded):

1. **Capture**: cheapest paid service that works, free wherever possible.
2. **Trust gate**: census-first is too strict — cheap LLM review of copy/page/image decides; census is enrichment.
3. **Autonomy**: full autonomy for Hermes within data/config boundaries (never code, secrets, schema, auth).
4. **Simplicity**: less, not more. Fewer steps, fewer rules. (This version.)

---

## 1. Why it keeps failing — root causes with evidence

**RC1. A distributed-systems control plane for one worker.** One VPS process runs the whole pipeline, yet it carries: a work_queue with dedupe keys, claim tokens, claim TTLs, a claims RPC with REST fallback, five watchdog functions to un-stick its own queue, job recycling, refresh_policies, build_runs with build/maintain modes (currently both open at once), and 9 job types passing signed payload contracts to each other. Every one of these is a place to get stuck — and they are where it *is* stuck: 563 due jobs sitting, 1,430 blocked, 25 orphaned jobs of a type with no code. The queue exists to coordinate workers that don't exist.

**RC2. Failure is recorded into landfills nobody reads.** 3,163 coverage defects filed in 7 days, 0 resolved — plus watchdog anomaly rows, ingest_events, media failure flags, and 1,359 hidden creatives, none surfaced anywhere. Three overlapping audit streams (agent_decisions, ingest_events, coverage_defects), zero alerts.

**RC3. One fragile parser, no evidence, no fallback.** Meta's official API cannot return AU commercial ads (EU/US-only programs), so browser capture is the only real source. When Meta changed payload shape, 309 jobs blocked with one identical error and the failing DOM was never saved. ~280 LOC of useless official-API code sits enabled by default.

**RC4. The census-first gate starves the database.** 598 pages verified-but-unresolved, 992 resolver jobs dead-ended. Of 2,785 ads: 34% have location attribution, 21% an agency link, 7% an agent link. The customer view requires the missing joins — which is why you can't query by agent, agency, or location.

**RC5. Docs, tests, and code disagree.** Docs say 5 job types and "no location discovery"; code runs 9 types including location search (1,410 completed runs). Every fresh agent session "fixes" toward whichever doc it read — this contradiction loop is why repeated attempts made it worse.

**RC6. The runtime ships throttled and unmeasured.** Deployment contract: maintain mode, `BLOCKWISE_RESEARCH_RUNTIME_ENABLED=false`. Monitoring checks "container up", never "work done".

## 2. Live evidence snapshot (2026-06-08)

| Metric | Value |
| --- | --- |
| Defects created vs resolved, 7d | 3,163 vs 0 |
| Ads with location / agency / agent attribution | 34% / 21% / 7% |
| Creatives hidden with no review surface | 1,359 of 2,785 |
| Jobs blocked on one parser error | 309 |
| Due jobs sitting unprocessed | 563 |
| Supervisor LOC (+ dead twin library) | 4,559 (+428) |
| Env vars / job types / page statuses / control tables | 67 / 9 / 5 / 5 |

---

## 3. The lean core: one table, one loop, one rule

### One table drives everything: `research.targets`

```
kind          page | search | roster
ref           page_id, or query + area, or area
priority      1..5 (geo tier + value)
interval_min  per-target cadence
next_check_at when it's due
last_success_at, consecutive_failures, last_error, enabled
```

This single table **replaces** work_queue, refresh_policies, build_runs, build_run_reports, dedupe keys, claim tokens, watchdogs, job recycling, and the build/maintain modes. Retry = `next_check_at = now() + backoff`. "Blocked" = `consecutive_failures` high → interval stretches (never silently removed). The due-targets select uses `FOR UPDATE SKIP LOCKED` from day one — one clause, and a deploy overlap or accidental second worker can never double-process (or double-spend on paid capture).

### One loop

```
every tick:
  take N due targets by priority
  page   → capture ads for page          → ingest
  search → capture ads for location query → ingest (new pages found become page targets)
  roster → scrape area roster              → upsert agencies/agents/service-areas
  success: next_check_at += interval   failure: backoff, failures++, last_error set
```

Geo tiers (Perth → WA → capitals → national) are just target priorities — seeded as data, advanced by the agent. Brand-name searches ("Ray White Subiaco") are ordinary `search` targets — this replaces the entire resolver pipeline for finding an agency's page. The loop runs targets with bounded concurrency (≈4 in flight) and a hard per-target timeout, so one hung browser session can never stall the system.

**Crash-only by design.** The worker holds no state — everything lives in Supabase, every ingest step is an idempotent upsert (ads by external id, media by content hash, classification by creative + version). The process can be killed at any moment and restarted with zero corruption; "backfill" isn't a subsystem, it's just re-running ingest over stored rows.

### Capture: one function, two providers

Try self-hosted browser (free). On parse failure: save DOM + screenshot to `research-raw-evidence`, try the paid endpoint (capped). Both fail = target failure with evidence. If the trailing parse-fail rate over the last 20 browser captures exceeds 50%, the loop flips provider order in settings and alerts — **no canary subsystem; the work itself is the canary.** "No ads" is recorded only when the empty-state marker is actually parsed; zero-without-proof is a failure.

### Ingest: inline steps, not queued jobs

upsert ad/creative → write a new snapshot **only when the content hash changes** (otherwise just bump `last_seen_at` — keeps storage flat at national scale) → fetch media inline (per-asset failures recorded on the asset, retried on the target's next pass) → classify (regex prefilter, cheap LLM on copy + page name, vision only if inconclusive; census/roster match upgrades confidence) → attribute (≥1 `ad_area_matches` row: the search area that found it, copy mentions, landing URL, service areas — search-derived matches carry low `confidence`, corroborated ones high, using the column that already exists) → link agency/agent from roster.

Ad lifecycle: only a **successful full page capture** may mark that page's missing ads inactive; search results never imply absence (a search is a sample, not a census of the page).

This deletes media-collector and classifier as queue concepts (currently 35,000+ job rows of bookkeeping for what are function calls).

### One rule (replaces the guardrail rulebook)

> An ad is displayable iff it has an external id, a page, ≥1 location, and a passing classification. Anything less is pending, counted in health, and retried on the target's next pass. Every failure must be visible on its target row.

The census-first chain, payload gate contracts (censusDecisionId / realEstateGate handoffs), location prohibitions, and 5-value page status enum are deleted. Page identity = classification score; collection health = `last_success_at` + `consecutive_failures`. Plain timestamps and counts, no enums.

## 4. No silent failure — by construction, not by process

1. Failures live on the target row (last_error, consecutive_failures) — the console's first screen is "what's failing and why", straight from `targets`. No defect workflow, no triage process: **coverage_defects stops being written and is dropped after cutover.**
2. One audit stream: `agent_decisions` for judgments (classification verdicts, agent actions, provider flips). Mechanical write-logging (ingest_events) is deleted.
3. `v_health` (one row): heartbeat age, due backlog, failing targets, parse-fail rate 24h, % ads attributed, % displayable, paid spend MTD, paid-spend-without-ingest. `/api/operator/research/health` (on **Vercel**, reading Supabase) returns 503 when red.
4. Alerting that survives the VPS dying: a free external monitor (UptimeRobot or similar) pings the Vercel health endpoint. The worker writes its heartbeat to Supabase, Vercel reads Supabase, the monitor reads Vercel — no link in that chain lives on the VPS. This **deletes the uptime-kuma container** (the current monitor runs on the same host it monitors, so it dies with the patient).
5. Suspect "no ads" pages: their targets simply stay scheduled; nothing is ever concluded permanently from a failed provider.

### Failure-mode walkthrough (top-down / bottom-up check)

| Failure | What happens, with no special machinery |
| --- | --- |
| Meta changes payload shape | evidence saved → paid fallback serves the target → trailing fail-rate flips provider order → alert; ads keep flowing |
| Meta walls the VPS IP | same path; the saved DOM shows the wall, so the cause is diagnosable, not guessed |
| Paid actor breaks / schema drifts | >5% mapping failure = capture failure with raw payload saved; browser still primary |
| Budget cap hit | fail-closed, browser-only, health shows it |
| Supabase down | worker idles and retries; health endpoint fails → external monitor alerts |
| VPS dies | heartbeat goes stale → health 503 → external monitor alerts (monitor is off-box) |
| Worker crashes mid-ingest | crash-only + idempotent upserts: restart finishes the job, nothing corrupts |
| Hung browser session | per-target timeout + bounded concurrency; the tick never stalls |
| Duplicate worker (deploy overlap) | `SKIP LOCKED` — double processing impossible |
| Classifier LLM down | regex prefilter still runs; creatives stay pending (not hidden), counted in health, retried |
| Classifier drifts wrong | daily 20-sample precision check → prompt version rollback |
| Ambiguous suburb names (wrong-state ads) | search-derived area matches carry low confidence; views/threshold filter them until corroborated |
| Target volume at national scale (~50k rows) | indexed due-time query; trivial for Postgres |

## 5. Hermes self-improvement — one skill, full autonomy

Daily self-review cron (the only new skill): read `v_health` + deltas vs yesterday (mem0) → retry/stretch failing targets, flip provider order, advance geo tier when current tier is green, sample 20 classifications and roll the classifier prompt version if precision <95% (prompt-manager already exists), check paid spend → morning report (decision row + webhook). Weekly: re-attempt long-failing targets, seed next tier's targets.

Autonomy surface = `targets`, `runtime_settings`, prompt versions, model choice — all audited. Code, env, schema, auth remain off-limits. The unreachable coverage-auditor/defect-investigator skills are deleted (self-review replaces both).

## 6. Costs — cheapest that works

Free path is primary (browser). **Fallback-only dispatch** means paid capture uses one chosen cheap actor (~$0.49–0.75/1k ads — not the $4.30/1k official actor that burned $219), called per due target only when the free path fails. Hard caps, all enforced in code: per-run `maxTotalChargedUsd` ≤ $1 + result cap 250; monthly cap (default $25) checked against Apify's limits API (`GET /v2/users/me/limits`) + our ledger (`ad_fetch_runs.cost_usd`) before every dispatch, fail-closed; Apify account limit ~$30 as backstop; spend-without-ingest is a red health flag. Hermes price-polls monthly and reports — actor auto-shopping/benchmarking is **deferred** (machinery we don't need yet). Review the $199/mo Apify subscription once real fallback volume is known. Classifier costs cents/day on a sub-cent model.

## 7. What gets deleted (the heart of the plan)

| Deleted | Replaced by |
| --- | --- |
| work_queue machinery (claims, TTLs, dedupe, recycling, 5 watchdogs) | due-time loop on `targets` |
| refresh_policies, build_runs, build_run_reports, build/maintain modes | `targets` + settings |
| coverage_defects workflow (3,163/week write-only) | failures on target rows + v_health |
| ingest_events (duplicate audit stream) | agent_decisions only |
| 9 job types + payload gate contracts | 3 target kinds, plain handlers |
| census-first gate + resolver dead-ends | classifier-led rule; roster as enrichment |
| 5-value page status enum (incl. my v1 two-axis proposal) | timestamps + counts + scores |
| Official Meta API path (~280 LOC) + its test | nothing — it can't serve AU |
| Dead TS library (428 LOC) | nothing |
| Unreachable auditor/investigator skills, stale SKILL.md rulebook | one self-review skill |
| v1 additions: canary subsystem, defect triage, actor benchmark loop | trailing fail-rate, target rows, fixed actor + caps |
| ~55 of 67 env vars | ~10 env (secrets/bootstrap) + settings table |
| uptime-kuma container (monitors the host it runs on) | free external monitor pinging the Vercel health endpoint |
| Stale docs (system-map, vps doc claims, known-limitations) + root plan files + `_archive` legacy orchestrator | one regenerated `SYSTEM.md` |

**Concept count: 5 control tables → 1 (+settings). 9 job types → 3 target kinds. 5 statuses → 0 enums. 2 modes → 0. 3 audit streams → 1. 67 env vars → ~10. Supervisor 4,559 → ~1,000 LOC (same file layout — no file explosion).** Data tables (agencies, agents, service areas, pages, ads, snapshots, creatives, media, area matches, source documents) keep their shape; customer-facing views unchanged in shape. Net production LOC decreases.

## 8. Rollout — five small phases, each gated

**P0 (day 1).** Evidence-on-parse-failure + `v_health` + 503 endpoint + free external monitor on the *current* loop; fix runtime env (build posture, single mode). *Accept: induced failure alerts in 30 min; backlog drains.*
**P1 (week 1).** Lean core cutover: `targets` + one loop + capture chain (browser→paid, capped) + inline ingest. Seed targets from existing pages/policies; stop writing old control tables; fix parser from stored evidence; requeue the 309 + re-check the 230 "no-ads" pages as ordinary due targets. *Accept: parse-fail <5%; old control tables idle; supervisor ≤ ~1,500 LOC and falling.*
**P2 (week 2).** Classifier-led gate + attribution backfill of the 1,840 unattributed ads + agency/agent link backfill; console first screen = failing targets + health. *Accept: ≥95% ads attributed; agent/agency/location queries return data.*
**P3 (week 3).** Self-review skill + settings autonomy + prompt versioning. *Accept: 7 unattended days of morning reports, no manual interventions.*
**P4.** Drop old control tables (after backup), delete dead code/docs, scale tiers Perth → national, agent-driven. *Accept: concept counts in §7 verified; AGENTS.md LOC report shows net decrease.*

## 9. AGENTS.md compliance

Schema work explicitly requested; additive first (targets, settings, v_health), drops only in P4 after backup, all with migration assertions. No new dependencies. Public view shapes preserved. Net production LOC decreases — report per-PR. Tag as explicitly-requested rebuild work (not "simplification PR" per AGENTS.md's narrow definition, which forbids schema changes).

## 10. Open items

1. Fallback vendor final pick (one cheap actor; trial credits first).
2. Classifier model slot (any sub-cent vision-capable OpenRouter model).
3. Apify $199/mo subscription — downgrade decision after P1 volume is known.

## 11. The one honest unknown

The architecture's only structural bet is that the **free browser path stays viable** against Meta's anti-bot posture from a datacenter IP. The design absorbs failure either way (evidence + fallback + visible cost), but if the browser path turns out permanently walled, paid capture becomes primary and the cost profile changes: roughly $0.0005–0.001 per charged ad means low tens of dollars/month at Perth scale but potentially $200–400/month at full national scale with twice-daily checks. That is a **pricing decision, not an architecture change** — the P1 exit produces the real numbers (parse-fail rate by provider, ads/check, cost/1k), and the options at that point are: add a residential proxy to the browser (small monthly cost, keeps free-primary), accept paid-primary with longer check intervals for cold areas, or hybrid (paid for discovery sweeps, browser for page refreshes). Decide then, with data; build nothing for it now.
