# Hermes Research Engine — Complete System Map

Date: 2026-06-04
Compiled from repository source only (no live VPS or database commands).
Source files are listed at the end of this document.

## 1. Overview

The research engine runs as a Hermes worker container (`blockwise-hermes`) plus
an internal Steel browser sidecar (`blockwise-steel`) on a Hostinger VPS,
deployed via Coolify with pinned images. The Hermes container holds two
cooperating runtimes:

| Runtime | What it is | What it does today |
| --- | --- | --- |
| Hermes agent | Nous Research `hermes-agent` base image, wrapped by `main-wrapper.sh` | Gateway API (:8642), dashboard (:9119), loads the 7 SKILL.md files, owns cron scheduling, OpenRouter/mem0 integration, local browser mode |
| Research supervisor | `hermes/tools/research-runtime/bin/supabase-supervisor.mjs` (Node, ~3,000 lines), started as a background process by the wrapper | The deterministic queue worker that performs census, page resolution, ad collection, media capture, and classification |
| Steel browser sidecar | `ghcr.io/steel-dev/steel-browser`, configured by `STEEL_IMAGE` | Internal-only browser API (:3000) and CDP (:9223) on the `research` Docker network; no host port binding |

Supabase is the system of record (schema `research`); the Next.js app's
`/operator` console is the control surface. `blockwise-uptime-kuma` provides
local uptime monitoring.

Key current-state facts (verified in source):

- The deployed supervisor handlers make **no LLM calls**. Classification is
  deterministic regex; its decision rows record `model: "deterministic"`.
- OpenRouter is fully wired (client, env schema, per-task model slots) but is
  the agent layer's concern — page_resolution, ad_classification,
  coverage_audit, defect_investigation each have a model slot.
- `blockwise-coverage-auditor` and `blockwise-defect-investigator` exist as
  queue job kinds and skills but have **no supervisor handler**; they belong to
  the Hermes agent layer (cron / operator triggered).
- `blockwise-operator-chat` is a stub; the live `/api/operator/research/chat`
  route assembles canned stats from views and logs an `operator_chat` decision.

## 2. The supervisor loop (tick anatomy)

`main()` loops forever: `tick()` → sleep `HERMES_QUEUE_LOOP_INTERVAL_MS`
(compose: 10,000 ms; code default 60,000 ms). Each tick:

1. **ensureBuildRun** — reuse the open `build_runs` row (status `running`,
   current mode) or create one (`trigger: "scheduled"`, market from target
   states).
2. **ensureSourceBackedRefreshPolicies** — auto-seed missing refresh policies
   (see §6).
3. **enqueueDueCensusJobs** — query `refresh_policies` where `active = true`
   and `next_refresh_at <= now()`, order by priority asc, limit
   `HERMES_RESEARCH_SUPERVISOR_POLICY_LIMIT` (compose 50; defaults 50 build /
   10 maintain). Skip policies whose state has no census source. Dedupe on
   `census:STATE:POSTCODE`:
   - pending/claimed job exists → skip;
   - blocked/failed job exists → recycle only if the old failure matches known
     schema-bug signatures (reset to pending, attempts 0), else defer the
     policy 12 h;
   - otherwise insert a `work_queue` row, priority `HERMES_CENSUS_QUEUE_PRIORITY`
     (30), `max_attempts: 3`.
4. **enqueueDueAdPageRefreshJobs** — pages with status `resolved_collectable`
   or `no_ads_confirmed`, a non-`slug:` numeric `page_id`, and
   `last_checked_at` null or older than `HERMES_AD_PAGE_REFRESH_INTERVAL_MINUTES`
   (360 maintain / 720 build). Capacity-capped: ≤ 80/200 active collector jobs,
   batch ≤ 16/40 per tick. Jobs enqueue at priority 8, `available_at`
   staggered 2 s apart, dedupe key `ad-refresh:<pageId>:<timeBucket>`.
5. **processClaimedJobs** — claim via RPC `claim_work_queue_jobs`
   (worker id, queue `research`, the 5 handled job types, limit
   `HERMES_QUEUE_CLAIM_LIMIT` = 8 in compose, claim TTL 900 s). If the RPC is
   missing, a REST fallback claims rows one-by-one with a generated
   `claim_token`. Claimed jobs run in parallel batches up to
   `HERMES_QUEUE_MAX_JOBS_PER_TICK` (8). `finishJob` patches the row **only if
   the claim token still matches**. Handler errors retry with backoff
   `60s × 2^(attempts-1)` capped at 900 s until `max_attempts` (3), then the
   job is blocked as `handler_failed_max_attempts`.
6. **runWatchdogs** — five SQL functions (see §7).
7. Structured log line summarising the tick.

Every queue transition (insert / claim / complete / block / fail / requeue)
writes a `research.ingest_events` row (`source_provider: "hermes"`).

## 3. The job chain (handlers in the supervisor)

Order: census → page resolver → ad collector → { media collector, classifier }.
Each stage queues the next; every gate is enforced in code.

### blockwise-agent-census (priority 30)
- Fetches evidence URLs for the postcode: REIWA suburb roster pages
  (suburb slugs from `hermes/data/au-postcodes.json` +
  `POSTCODE_ROSTER_SOURCES`), agency websites, configured source templates.
- Each fetched page → `source_documents` row (sha-256 content hash dedup;
  hash + metadata stored, not the body).
- Extracts roster entries (REIWA JSON-LD / embedded data) and agency facts →
  `upsertVerifiedAgency` → verified `agencies` / `agents` rows + decision rows.
- Success: queues `blockwise-page-resolver` per verified subject, sets policy
  `last_refreshed_at = now()`, `next_refresh_at = +12 h`.
- No verified evidence: defer policy 24 h + coverage defect (blocked).
  Fetch errors: defer 6 h + defect. **Failure never downgrades existing rows.**
- Only this path may set `is_real_estate = true`.

### blockwise-page-resolver (queued by census)
- Requires `subjectId` + `censusDecisionId` + `sourceDocumentIds`, else
  blocked (`page_resolver_missing_verified_census_handoff`).
- Fetches ≤ 4 census evidence URLs, then ≤ 3 website candidates found in them;
  every page saved as a source document; mines all for Facebook links.
- Facebook candidates must match the verified subject (name/slug check) or are
  skipped with the reason recorded.
- Numeric Meta page id from URL, or fetched from the FB page HTML.
  Confidence: 92 with numeric id → `advertiser_pages.status =
  resolved_collectable`; 78 slug-only → `verified_real_estate_unresolved`
  (`page_id = slug:<slug>`).
- Writes a `page_resolution` decision + `real_estate_verifications` row
  (`verified` vs `needs_review`).
- Fallback: Meta Ad Library exact verified-name lookup (never location),
  candidates scored on name tokens, known URLs, and real-estate signals.
- Numeric id → queues `blockwise-ad-collector` with resolver decision +
  census gate. Low confidence → coverage defect, not a page.

### blockwise-ad-collector (priority 30 from resolver; 8 from auto-refresh)
- Refuses any payload without `advertiserPageId`, `metaPageId`, and
  `realEstateGate.verified === true`.
- Capture provider:
  - `hermes_browser` (default): headless Chromium dumps the rendered DOM of
    `facebook.com/ads/library/?active_status=…&ad_type=all&country=AU&view_all_page_id=<id>&media_type=all`
    within `HERMES_META_CAPTURE_TIMEOUT_MS` (30 s); parser extracts the JSON
    embedded after `search_results_connection` keys, up to
    `HERMES_META_CAPTURE_RESULTS_LIMIT` (250) items.
  - `http_json`: POST the same input to an operator-configured endpoint.
- Outcomes:
  - Failure / parse warnings → fetch run `failed` + coverage defect + throw
    (retry path). **Provider failure is never absence.**
  - 0 items **with** `confirmed_absence` → run `success`, page →
    `no_ads_confirmed`.
  - Items → ingest `ad_fetch_runs` → `observed_ads` → `ad_snapshots` →
    `ad_creatives`; per creative queue `blockwise-media-collector` (if media
    sources) and `blockwise-ad-classifier`, both priority 5, deduped on
    creative + content hash.
  - Hit the 250 cap → coverage defect suggesting paginated collection.
  - Page patched `resolved_collectable`, `last_successful_check_at = now()`,
    `consecutive_failed_checks = 0`.

### blockwise-media-collector (priority 5)
- Seeds `media_assets` from the creative's image/video/thumbnail URLs
  (external asset ids derived from URL hashes).
- Downloads each (30 s timeout, UA `BlockwiseHermesResearch/1.0`), uploads to
  the `research-ad-creatives` bucket with checksum + content hash; identical
  content is deduped; bucket auto-created if missing.
- Failures patch `capture_status = failed` per asset (job still completes).
- Requeues the classifier afterwards so display gating sees captured media.

### blockwise-ad-classifier (priority 5)
- Deterministic regex over headline/body/CTA text. Categories: appraisal,
  just_sold, listing / open_home, property_management, market_update,
  agency_brand; confidence 0.86 with a real-estate signal, 0.45 without.
- Writes an `ad_classification` decision (`model: "deterministic"`) and
  patches the creative: classification, ad_type, primary_intent,
  `display_state = displayable` **only if** real-estate AND media captured
  (for image/video/carousel formats), else `hidden`.

## 4. Skills layer (the prompt surface, `hermes/skills/`)

| Skill | Role | Notable tools |
| --- | --- | --- |
| blockwise-agent-census | Roster owner; only path to `is_real_estate = true`; sources: WA licence registers, REIWA suburb pages, agency sites, Domain/REA corroboration | HTTPS fetch, self-hosted browser session, mem0.search, ingest API |
| blockwise-page-resolver | Verified subject → real Meta advertiser page; brand/site/social search only | HTTPS fetch, meta-library-capture (verification only), self-hosted browser, mem0 |
| blockwise-ad-collector | Page-gated Ad Library capture; refuses location inputs outright | meta-library-capture, ingest API |
| blockwise-ad-classifier | Strict-JSON classification contract; repair_once_then_fail; below-threshold → review + defect | research-runtime OpenRouter, ingest API |
| blockwise-coverage-auditor | Samples coverage; browsing files defects, never creates data | self-hosted browser, read-only queries, ingest API |
| blockwise-defect-investigator | Operator-triggered replay; routes repair to the owning skill; supersedes bad decisions | self-hosted browser, read-only queries, ingest API |
| blockwise-operator-chat | Stub — NL over `research.v_*` views only; no writes, no paid actions without confirmation | supabase.query, pgvector (future), write_decision |

Shared rules (hermes/README.md): census-first; no location-based Ad Library
discovery; collection is page-first; no arbitrary SQL (signed ingestion API
only); every write needs a decision row; evidence (URL + source_documents.id)
is mandatory; provider failure ≠ absence; model names env-only.

## 5. Models

| Item | Value |
| --- | --- |
| Provider | OpenRouter only (`HERMES_PROVIDER=openrouter`), temperature 0 |
| Default / escalation | `HERMES_DEFAULT_MODEL` / `HERMES_ESCALATION_MODEL` (both required by compose; never pinned in code) |
| Per-task slots | `HERMES_OPENROUTER_MODELS_JSON` keys: `page_resolution`, `ad_classification`, `coverage_audit`, `defect_investigation` |
| Resolution order | task slot → default → `HERMES_OPENROUTER_MODEL`; escalation model on `useEscalationModel` |
| Budget | `HERMES_DAILY_SPEND_LIMIT_USD` (25); `cost_usd` logged per fetch run; operator chat reports 24 h spend |
| Live today | Supervisor handlers are deterministic — no OpenRouter calls in the deployed loop |

## 6. Scheduling and cadence (timezone Australia/Perth)

| Trigger | Cadence | Detail |
| --- | --- | --- |
| Hermes cron: weekly-census-priority-1 | `0 3 * * 1` (Mon 03:00) | skill blockwise-agent-census, `{ state: WA, priority_max: 1 }` |
| Hermes cron: weekly-coverage-audit | `0 5 * * 1` (Mon 05:00) | skill blockwise-coverage-auditor, sampled manual browse |
| Supervisor tick | every 10 s (compose) | full tick anatomy in §2 |
| Policy auto-seed | every tick | candidates from `au-postcodes.json` for states with an enabled census source, filtered by `HERMES_RESEARCH_TARGET_POSTCODES` / target states; insert ≤ 500 build / ≤ 100 maintain missing policies; priority 3 (WA) / 4, cadence 1,440 min, `next_refresh_at` staggered 1 s apart, duplicate-safe |
| Census refresh | success → +12 h | fetch errors defer 6 h; no evidence defer 24 h; blocked recycle-or-defer 12 h |
| Ad page refresh | stale after 6 h maintain / 12 h build | batch 16/40, max active 80/200, priority 8, staggered 2 s |
| Retries | 3 attempts | backoff 1 m → 2 m → 4 m, cap 15 m; then blocked |
| Claim TTL | 15 min | stale claims requeued by watchdog |
| Operator refresh-now | next tick | postcode → `next_refresh_at = now()`; page → `last_checked_at = null` |
| Kill switch | immediate | all `refresh_policies.active = false`; manual refresh-now still works |

Modes: `HERMES_RESEARCH_MODE=build` (rebuilding coverage, bounded backfills,
higher concurrency) vs `maintain` (default posture: routine refresh only).
`BLOCKWISE_RESEARCH_RUNTIME_ENABLED` gates whether the supervisor starts at all.

## 7. Watchdogs (every tick, SQL functions)

| Function | Window / threshold |
| --- | --- |
| watchdog_requeue_stale_jobs | limit 100 — reclaims expired claims |
| watchdog_record_provider_failures | 3+ failures in 24 h |
| watchdog_record_zero_ad_anomalies | 48 h window |
| watchdog_record_missing_media | 24 h window |
| watchdog_record_unclassified_creatives | 24 h window |

## 8. Data model (`research` schema)

Tables (20), grouped:

- **Evidence & audit**: source_documents (sha-256 hash dedup; hash + metadata,
  not body), agent_decisions (every mutation: decision JSON, rationale,
  confidence, evidence, skill, model, cost), ingest_events,
  real_estate_verifications
- **Roster**: agencies, agents, agent_service_areas
- **Pages & collection**: advertiser_pages, ad_fetch_runs, observed_ads,
  ad_snapshots, ad_creatives, media_assets, ad_area_matches
- **Coverage**: coverage_audits, coverage_defects
- **Control plane**: refresh_policies, work_queue, build_runs,
  build_run_reports

Views (app- and operator-facing): v_active_ads_by_postcode,
v_competitors_by_postcode, v_ad_hooks_by_suburb, v_agent_ad_history,
v_coverage_status, v_recent_creative_patterns, v_missing_competitors,
plus operator work-queue diagnostics. The app reads **views only** — the
real-estate display gate lives there.

Storage buckets: `research-ad-creatives` (media collector writes; checksum +
content-hash dedup; auto-created), `research-screenshots` and
`research-raw-evidence` (env-wired for agent-layer browser capture and future
adapters; not written by the deterministic loop today).

## 9. Operator controls (`/operator` + API routes)

| Control | Route | Effect |
| --- | --- | --- |
| Refresh now | POST /api/operator/research/refresh-now | postcode → policy `next_refresh_at = now()`; page → `last_checked_at = null`; picked up next tick; audited as `cadence_change` decision |
| Kill switch | POST /api/operator/research/kill-switch | all policies `active = !paused`; halts the scheduler, manual runs still allowed; audited |
| Chat | POST /api/operator/research/chat | assembles stats from v_coverage_status, work-queue diagnostics, defects, fetch-run spend, skill list; proposes a refresh action; logs `operator_chat` decision (full NL chat is the Phase-9 stub) |
| Skills / files | GET /api/operator/research/skills, /files | lists SKILL.md assets |

## 10. Guardrails (enforced in code, not just docs)

1. Census-first: only census can verify real-estate status.
2. Page-first collection: collector requires page id + resolver decision +
   census gate; payload schema rejects location selectors outright.
3. No location-based Ad Library discovery anywhere in the pipeline.
4. Provider failure is never zero ads; absence requires explicit confirmation.
5. Every mutation pairs with an agent_decisions row (evidence, confidence,
   rationale, model, cost).
6. Claim-token concurrency: a stale worker cannot overwrite a requeued job.
7. Result-cap defects: hitting 250 items files a defect instead of silently
   truncating coverage.
8. Pinned images only; model names env-only; kill switch + daily spend limit.

## 11. Source file index

- `hermes/tools/research-runtime/bin/supabase-supervisor.mjs` — deployed loop
- `hermes/tools/research-runtime/src/{config,types,supervisor,worker,openrouter}.ts` — library
- `hermes/skills/*/SKILL.md` — 7 skills
- `hermes/data/{au-postcodes.json,agent-sources.json}` — seed data
- `infra/hermes/{Dockerfile,hermes.toml,main-wrapper.sh}` — container + agent config
- `infra/coolify/docker-compose.research.yml` — deployment + env defaults
- `supabase/migrations/202605280003_research_engine.sql`, `202605280004_research_views.sql`, `202605300003_blockwise_hard_reset_clean_schema.sql` — schema
- `src/app/api/operator/research/*` — operator routes
- `docs/research-engine/*` — architecture, runbook, modes, go-live
- `hermes/README.md` — runtime rules
