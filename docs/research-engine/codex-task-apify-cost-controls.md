# Codex Task — Apify Cost Controls + Autonomous Cheapest-Actor Selection

Date: 2026-06-08
Hand this file to Codex as the task spec. Read `docs/research-engine/simplification-review.md` (§3 capture chain, §4 no-silent-failure contract, §5 autonomy, §6 cost plan) and `AGENTS.md` before starting. This task implements §6's "Apify cost controls" and adds autonomous actor selection.

## Context (why)

June billing blowout: $219.28 charged by `apify/facebook-ads-scraper` (~$4.30/1k ads, the expensive official actor) in uncapped runs; ~51k ad events charged, zero rows reached the research DB. Root causes: no per-run cost cap, no budget guard before dispatch, expensive actor hard-coded by choice, Apify used as a firehose instead of a fallback.

## Hard constraints (from AGENTS.md + owner decisions)

1. No new npm dependencies — Apify is called with plain `fetch`.
2. Schema changes additive only, with migration assertions. No auth, public API shape, or provider-behaviour changes outside this task's scope.
3. Apify is a **fallback** capture provider behind the existing `http_json`-style path — never the primary firehose. Dispatch only for due pages/searches that the free browser path cannot serve (canary tripped / circuit open / weekly cross-check).
4. Only secret added to env: `APIFY_TOKEN`. All tunables live in `research.runtime_settings` so the Hermes agent can manage them autonomously (audited via `agent_decisions`).
5. Fail-closed for paid calls: if the budget state cannot be verified (limits API unreachable, ledger query fails), do not dispatch to Apify.

## Deliverable A — amend the rebuild plan

In the active rebuild plan, add under the capture phase: (1) per-run cost caps, (2) pre-dispatch budget guard, (3) spend ledger + health surfacing, (4) autonomous actor selection (below), (5) account backstop. Mark `apify/facebook-ads-scraper` as banned (price). Note the dependency: `runtime_settings` and `v_health` come from the simplification review P0/P3 — if they don't exist yet, create minimal versions in this task.

### Capture-phase canary contract

The paid fallback must be gated by known-good ad canaries before any mass capture changes:

1. **Canary set.** Store canaries as data with `meta_page_id` or `page_url`, market, `expected_min_ads = 1`, `last_known_good_ad_id`, `last_known_good_run_id`, `last_known_good_at`, and raw-evidence pointers. Seed the initial candidates from stable, high-volume real-estate advertisers: national portal `realestate.com.au`, national portal `Domain`, franchise group `Ray White Group`, and one WA branch page chosen from the last 30 days of successful Blockwise captures.
2. **Promotion rule.** A candidate becomes a known-good active canary only after two consecutive green captures inside 24 hours with at least one active ad and saved DOM/screenshot evidence in `research-raw-evidence`.
3. **Failure rule.** Zero results from a known-good canary are valid absence only when Meta's explicit empty-state marker is parsed. Otherwise the canary fails, mass capture pauses, the provider flips or circuit-breaks, and an alert/defect is raised.
4. **Freshness rule.** Rotate out any active canary that has gone 7 days without fresh ad-positive proof, and promote a replacement through the same evidence rule.

## Deliverable B — implementation

### B1. Apify capture adapter

New module `hermes/tools/research-runtime/bin/apify-capture.mjs` (keep the supervisor file from growing):

- `createApifyRun({ actorId, input, maxTotalChargedUsd, timeoutSecs })` → `POST https://api.apify.com/v2/acts/{actorId}/runs?maxTotalChargedUsd=...` — **every** run MUST set `maxTotalChargedUsd` (from settings, default 1.00) and the actor input's result cap (`count`/`maxResults` per the actor's schema, default 250 to mirror `HERMES_META_CAPTURE_RESULTS_LIMIT`).
- Poll run status; on success `GET .../dataset/items`; map items through a per-actor `schema_map` (jsonb field-mapping, see B4) into the same capture-outcome contract the browser parser returns (`items[]`, `confirmed_absence`, `metadata.provider = "apify:<actorId>"`).
- Any mapping shortfall (required field missing on >5% of items) = capture failure with the raw payload saved to the `research-raw-evidence` bucket — never silently ingest partial junk.

### B2. Budget guard (pre-dispatch, every Apify call)

- Read `GET https://api.apify.com/v2/users/me/limits` → `current.monthlyUsageUsd`, `limits.maxMonthlyUsageUsd`.
- Read local ledger: `sum(ad_fetch_runs.cost_usd)` this calendar month where `source_provider like 'apify:%'`.
- Settings keys (defaults): `apify_monthly_cap_usd` = 25, `apify_per_run_cap_usd` = 1.00, `apify_enabled` = true.
- If `max(localSpend, apifyReportedUsage) >= apify_monthly_cap_usd` → set `apify_state = circuit_open` in settings, file ONE defect (signature `apify_budget_cap`), skip dispatch, fall back to browser or defer the job. Re-check daily.
- Our cap must stay below the Apify account limit; assert and warn in health if not.

### B3. Spend ledger

- After each run, fetch run detail (`usageTotalUsd` / charged event counts) and write it to `ad_fetch_runs.cost_usd` (column exists).
- Add to `v_health`: `apify_mtd_spend_usd`, `apify_state`, and red flag `paid_spend_without_ingest` (cost recorded in 24h with zero observed_ads ingested from that provider — the June failure mode).

### B4. Autonomous cheapest-actor selection (the Hermes part)

New additive table `research.capture_actors`:

```
actor_id text pk, status text check (candidate|approved|rejected|banned),
price_per_1k_usd numeric, pricing_checked_at timestamptz,
schema_map jsonb, last_benchmark jsonb, notes text, updated_at timestamptz
```

Seed rows: `automly/facebook-ad-library-scraper`, `constructive_calm/facebook-ad-library-pro`, `curious_coder/facebook-ads-library-scraper` as `candidate`; `apify/facebook-ads-scraper` as `banned` (price).

Selection loop (runs inside the daily self-review; supervisor executes, agent decides):

1. **Price poll (daily, free):** `GET /v2/acts/{actorId}` → `pricingInfos` (PAY_PER_EVENT `pricePerEvent` / PRICE_PER_DATASET_ITEM tiers) → update `price_per_1k_usd`.
2. **Benchmark (monthly, or when any price moves >20%, or a new candidate appears):** run each non-banned actor against one canary page with `maxTotalChargedUsd = 0.25`, `maxResults = 50`. Score = cost per **valid** ad, where valid = passes the ingest contract (external ad id, page id, creative text or media URL present; duplicate ratio <10%), plus failure rate and latency. Persist to `last_benchmark`.
3. **Choose:** cheapest actor with status `approved` and a passing benchmark → write `apify_actor_id` to `runtime_settings` with an `agent_decisions` row (rationale + benchmark evidence). Tie/missing data → keep current.
4. **Promotion:** a `candidate` whose benchmark passes AND whose output maps through the generic field-mapper at ≥95% becomes `approved` (decision row). A candidate needing bespoke mapping code gets a defect proposing adapter work — **code changes stay with humans/Codex, not Hermes**.
5. **Discovery (weekly):** `GET /v2/store?search=facebook ad library` to find new candidates; insert as `candidate` only — never auto-run an unvetted actor outside the capped benchmark.

### B5. Account backstop

At boot and in the daily loop, assert the Apify account limit: if `maxMonthlyUsageUsd` differs from settings key `apify_account_limit_usd` (default 30), `PUT /v2/users/me/limits` to set it. The agent may lower it autonomously; raising it above the settings ceiling requires the operator to change the ceiling.

### B6. Tests (extend `tests/research-engine/`)

1. Run-creation always includes `maxTotalChargedUsd` and a results cap (reject dispatch without them).
2. Budget guard blocks at cap; fail-closed when limits API errors.
3. Ledger written from run detail; `paid_spend_without_ingest` flag computed.
4. Field-mapper contract test per approved actor using stored fixtures; >5% mapping failure = capture failure with evidence write.
5. Benchmark scorer picks cheapest passing actor; banned actors never selected; unvetted candidates never run outside benchmark caps.
6. Migration assertions for `capture_actors` (+ `runtime_settings` if created here); public view shapes unchanged.

Run: `npm run test:research`, `npm run test:hard-reset`, `npm run typecheck`.

## Acceptance

1. Induced price spike on the selected actor → next daily loop switches to the cheaper passing actor, with a decision row recording why.
2. Simulated month-to-date spend ≥ cap → zero further Apify dispatches, circuit-open defect filed once, health shows `apify_state=circuit_open`, browser fallback continues.
3. No code path can create an Apify run without per-run cost + result caps (test-enforced).
4. `v_health` shows Apify MTD spend; morning report includes it.
5. AGENTS.md reporting block in the PR (LOC before/after, files created/deleted, behaviour changed: yes).

## Out of scope

Making Apify primary; auto-adopting unvetted actors into production rotation; any non-Apify vendor (ScrapeCreators adapter is a separate task if chosen); plan downgrade decision (operator).
