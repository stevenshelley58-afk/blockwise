# Research Engine Environment Variables

Date: 2026-06-12

This file documents the variables read by the active Hermes research runtime in
`infra/coolify/docker-compose.research.yml`,
`hermes/tools/research-runtime/src/config.ts`, and
`hermes/tools/research-runtime/bin/supabase-supervisor.mjs`.

Do not print real secret values in logs or docs.

## Required Runtime

| Variable | Used by | Notes |
| --- | --- | --- |
| `HERMES_BASE_IMAGE` | Docker build arg | Must be a pinned Hermes image tag or digest; never `:latest`. |
| `BLOCKWISE_HERMES_IMAGE` | Compose image | Built Blockwise Hermes image tag. |
| `STEEL_IMAGE` | Compose image | Must be a pinned Steel browser tag or digest. |
| `UPTIME_KUMA_IMAGE` | Compose image | Pinned uptime monitor image. |
| `HERMES_API_SERVER_KEY` | Hermes gateway | Required by compose. Can mirror `HERMES_WEBHOOK_SECRET` when rotating from older reset scripts. |
| `HERMES_DEFAULT_MODEL` | Hermes/OpenAI | Direct OpenAI model slug; defaults to `gpt-5.5`. |
| `OPENAI_API_KEY` | OpenAI client | Required for LLM-backed page resolution, classification, audits, and investigations. |
| `SUPABASE_URL` | Compose and supervisor | Passed through as `HERMES_SUPABASE_URL`. |
| `SUPABASE_SECRET_KEY` | Compose and supervisor | Preferred current server credential; passed through as `HERMES_SUPABASE_SECRET_KEY`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Compose and supervisor | Legacy JWT fallback; passed through as `HERMES_SUPABASE_SERVICE_ROLE_KEY`. |

## Hermes Gateway And Models

| Variable | Default | Notes |
| --- | --- | --- |
| `HERMES_CONFIG` | `/app/hermes.toml` | Compose sets this path. |
| `HERMES_HOME` | `/opt/data` | Runtime data directory. |
| `HERMES_ACCEPT_HOOKS` | `1` | Enables hook acceptance for the gateway. |
| `HERMES_WEBHOOK_SECRET` | none | Legacy webhook secret still passed through for compatibility. |
| `HERMES_GATEWAY_HOST_PORT` | `8642` | Bound to localhost on the VPS. |
| `HERMES_DASHBOARD_HOST_PORT` | `9119` | Bound to localhost on the VPS. |
| `HERMES_DASHBOARD_INSECURE` | `1` | Dashboard is not public; keep behind the VPS boundary. |
| `HERMES_MODELS_JSON` | `{}` | Optional direct OpenAI per-task model map for `page_resolution`, `ad_classification`, `coverage_audit`, and `defect_investigation`. |
| `MEM0_API_KEY` | none | Passed through to Hermes when configured. |
| `MEM0_PROJECT_ID` | `blockwise-research` | Passed through to Hermes. |
| `RESEND_API_KEY` | none | Optional notification email provider key. |

## Supervisor Cadence

| Variable | Default | Notes |
| --- | --- | --- |
| `HERMES_RESEARCH_MODE` | `maintain` | `build` raises several queue and backfill defaults. |
| `HERMES_BUILD_CONCURRENCY` | `4` | Runtime config value. |
| `HERMES_MAINTAIN_CONCURRENCY` | `1` | Runtime config value. |
| `HERMES_COLLECTION_INTERVAL_SECONDS` | `900` | Runtime collection interval. |
| `HERMES_DAILY_SPEND_LIMIT_USD` | `25` | Overall daily paid/LLM spend guard. |
| `HERMES_RESEARCH_QUEUE_PATH` | `.hermes/research-queue.json` | Local queue path for non-Supabase runtime code. |
| `HERMES_QUEUE_WORKER_ID` | generated UUID in supervisor | Stable worker ID is optional. |
| `HERMES_QUEUE_LOOP_INTERVAL_MS` | `60000` in supervisor, `10000` in compose | Poll interval. Compose overrides the supervisor fallback. |
| `HERMES_QUEUE_CLAIM_LIMIT` | `4` build, `1` maintain; compose default `8` | Claim batch size. |
| `HERMES_QUEUE_CLAIM_TTL_SECONDS` | `900` | Queue claim timeout. |
| `HERMES_QUEUE_MAX_JOBS_PER_TICK` | `4` build, `1` maintain; compose default `8` | Max jobs processed each tick. |
| `HERMES_QUEUE_DRY_RUN` | `false` | Runtime config value. |
| `HERMES_RESEARCH_SUPERVISOR_POLICY_LIMIT` | `50` build, `10` maintain; compose default `50` | Max policy rows scanned by supervisor. |
| `HERMES_RESEARCH_FETCH_TIMEOUT_MS` | `8000` | Fetch timeout for supervisor network calls. |
| `HERMES_RESEARCH_TARGET_POSTCODES` | `ALL` | CSV postcode list; `ALL` or `*` means all configured targets. |
| `HERMES_CENSUS_SOURCE_URL_TEMPLATES` | none | Optional census source URL templates. |
| `HERMES_CENSUS_MAX_ROSTER_URLS_PER_POSTCODE` | `5` | Roster source cap. |
| `HERMES_CENSUS_QUEUE_PRIORITY` | `30` | Census job priority. |
| `HERMES_CENSUS_AUTO_SEED_POLICIES_ENABLED` | enabled unless `false` | Auto-seeds census policies. |
| `HERMES_CENSUS_POLICY_SEED_BATCH_SIZE` | `500` build, `100` maintain | Census policy seed batch size. |
| `HERMES_CENSUS_RECYCLE_BLOCKED_ENABLED` | enabled unless `false` | Allows blocked census work recycling. |

## Storage

| Variable | Default | Notes |
| --- | --- | --- |
| `HERMES_SUPABASE_URL` | `SUPABASE_URL` | Supervisor accepts either variable, but compose sets both. |
| `HERMES_SUPABASE_SECRET_KEY` | `SUPABASE_SECRET_KEY` | Preferred opaque server credential. Sent as `apikey` only. |
| `HERMES_SUPABASE_SERVICE_ROLE_KEY` | `SUPABASE_SERVICE_ROLE_KEY` | Supervisor accepts either variable, but compose sets both. |
| `HERMES_RESEARCH_AD_CREATIVES_BUCKET` | `research-ad-creatives` | Stored creative media bucket. |
| `HERMES_RESEARCH_SCREENSHOTS_BUCKET` | `research-screenshots` | Screenshot bucket. |
| `HERMES_RESEARCH_RAW_EVIDENCE_BUCKET` | `research-raw-evidence` | Raw provider evidence bucket. |

## Browser And Meta Capture

| Variable | Default | Notes |
| --- | --- | --- |
| `HERMES_REMOTE_BROWSER_CDP_URL` | `http://blockwise-steel:9223` in compose; empty in supervisor fallback | Remote browser CDP endpoint. When unset, supervisor uses local Chromium. |
| `HERMES_REMOTE_BROWSER_FAILURE_COOLDOWN_MS` | `1800000` | Remote browser failure cooldown. |
| `HERMES_META_BROWSER_CHALLENGE_COOLDOWN_MS` | `900000` | Challenge cooldown before browser capture resumes. |
| `HERMES_META_BROWSER_EXECUTABLE` | `chromium` | Falls back to `CHROMIUM_BIN` before `chromium`. |
| `CHROMIUM_BIN` | none | Local browser executable fallback. |
| `HERMES_META_BROWSER_TIMEOUT_MS` | `30000` | Browser capture timeout passed by compose. |
| `HERMES_META_CAPTURE_PROVIDER` | `hermes_browser` or `http_json` when `HERMES_META_CAPTURE_ENDPOINT` is set | Capture provider selector. |
| `HERMES_META_CAPTURE_ENDPOINT` | none | Structured HTTP JSON capture endpoint. |
| `HERMES_META_CAPTURE_TIMEOUT_MS` | `30000` | Capture timeout. |
| `HERMES_META_CAPTURE_RESULTS_LIMIT` | `250` | Capped to 250 by supervisor. |
| `HERMES_AD_PAGE_REFRESH_ENABLED` | enabled unless `false` | Refreshes known Meta ad pages. |
| `HERMES_AD_PAGE_REFRESH_INTERVAL_MINUTES` | `720` build, `360` maintain | Refresh cadence. |
| `HERMES_AD_PAGE_REFRESH_BATCH_SIZE` | `40` build, `16` maintain | Refresh batch size. |
| `HERMES_AD_PAGE_REFRESH_MAX_ACTIVE` | `200` build, `80` maintain | Active refresh cap. |

## Location Ad Search

Location ad search is enabled by default. Set
`HERMES_LOCATION_AD_SEARCH_ENABLED=false` only as an operator kill switch.

| Variable | Default | Notes |
| --- | --- | --- |
| `HERMES_LOCATION_AD_SEARCH_ENABLED` | enabled unless `false` | Supervisor queues `blockwise-location-ad-search` work. |
| `HERMES_LOCATION_AD_SEARCH_INTERVAL_MINUTES` | `720` | Location ad search cadence. |
| `HERMES_LOCATION_AD_SEARCH_BATCH_SIZE` | `40` build, `12` maintain | Search batch size. |
| `HERMES_LOCATION_AD_SEARCH_MAX_ACTIVE` | `120` build, `40` maintain | Active search cap. |
| `HERMES_LOCATION_AD_SEARCH_MAX_SUBURBS_PER_POSTCODE` | `8` | Suburb cap per postcode. |

## Official Meta Ad Library API

Official API capture is enabled when
`HERMES_META_OFFICIAL_API_ENABLED` is not `false` and one of the access-token
variables is present.

| Variable | Default | Notes |
| --- | --- | --- |
| `HERMES_META_AD_LIBRARY_ACCESS_TOKEN` | none | Preferred Hermes-scoped token variable. |
| `META_AD_LIBRARY_ACCESS_TOKEN` | none | App/operator route compatibility variable. |
| `META_AD_LIBRARY_TOKEN` | none | Legacy alias still accepted by supervisor and operator validation. |
| `HERMES_META_OFFICIAL_API_ENABLED` | enabled unless `false` and a token exists | Kill switch for official API capture. |
| `HERMES_META_OFFICIAL_API_VERSION` | `v20.0` | Falls back from `META_AD_LIBRARY_API_VERSION`. |
| `META_AD_LIBRARY_API_VERSION` | none | Legacy official API version alias. |
| `HERMES_META_OFFICIAL_AD_TYPE` | `HOUSING_ADS` | Ad library ad type. |
| `HERMES_META_OFFICIAL_PAGE_LIMIT` | `100` | Capped to 100 by supervisor. |
| `HERMES_META_OFFICIAL_MAX_PAGES_PER_CAPTURE` | `25` | Capped to 100 by supervisor. |

## Apify Fallback

Apify is a paid fallback. It must remain capped and circuit-breaker protected.

| Variable or setting | Default | Notes |
| --- | --- | --- |
| `APIFY_TOKEN` | none | Preferred token variable. |
| `APIFY_API_TOKEN` | none | Legacy alias accepted by supervisor and Apify helper. |
| `apify_enabled` | runtime setting | Enables/disables fallback at runtime. |
| `apify_state` | runtime setting | Runtime state flag. |
| `apify_circuit_open_until` | runtime setting | Circuit breaker timestamp. |
| `apify_monthly_cap_usd` | `25` in helper defaults | Monthly cap. |
| `apify_per_run_cap_usd` | `1` in helper defaults | Per-run cap. |
| `apify_account_limit_usd` | `30` in helper defaults | Account-level cap. |
| `apify_actor_id` | runtime setting | Selected actor. `apify/facebook-ads-scraper` is banned. |
| `apify_result_limit` | `250` in helper defaults | Result cap. |
| `apify_canary_max_results` | runtime setting | Canary result cap. |
| `apify_canary_per_run_cap_usd` | runtime setting | Canary per-run cap. |
| `apify_canary_page_id` | runtime setting | Canary Meta page target. |

## Removed From Active Runtime

Do not configure these for the active reset runtime:

1. `ORCHESTRATOR_*`
2. `AD_COLLECTOR_PROVIDER`
3. `SELF_HOSTED_META_COLLECTOR_URL`
4. `META_AD_LIBRARY_COLLECTOR_URL`
5. `META_COLLECTOR_*`
6. `SEARCHAPI_*`
7. `AD_COLLECTOR_*`
