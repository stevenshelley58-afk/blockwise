# Research Engine Environment Variables

Date: 2026-07-28

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
| `HERMES_DEFAULT_MODEL` | Hermes resolver | Default non-image model slug. Defaults to `kimi-k2.6` (Moonshot/Kimi). Slugs route by prefix: `kimi-*`/`moonshot-*` -> Moonshot, `qwen-*` -> Alibaba DashScope. |
| `MOONSHOT_API_KEY` | LLM resolver | Required. Authenticates Kimi/Moonshot models (`kimi-*`/`moonshot-*`) used for page resolution, classification, audits, investigations, and content generation. |
| `DASHSCOPE_API_KEY` | LLM resolver | Required when any configured model is a `qwen-*` slug (e.g. `best_json`/`critic_review` defaults route here). |
| `HERMES_RESEARCH_DB_PASSWORD` | VPS Postgres and PostgREST | URL-safe password for the private `blockwise_research` database. |
| `HERMES_RESEARCH_JWT_SECRET` | VPS PostgREST | At least 32 random bytes used only to verify private research API JWTs. |
| `HERMES_RESEARCH_SERVICE_ROLE_KEY` | VPS PostgREST and Hermes | JWT signed by `HERMES_RESEARCH_JWT_SECRET` with `role=service_role`. |
| `SUPABASE_URL` | Customer app and publisher | Blockwise customer Supabase only. Never use another product's project. |
| `SUPABASE_SECRET_KEY` | Customer app and publisher | Preferred customer Supabase server credential. |
| `SUPABASE_SERVICE_ROLE_KEY` | Customer app and publisher | Legacy customer Supabase service-role fallback. |

Vercel and Trigger use `RESEARCH_API_URL=https://hermes.blockwise.sale/research`
and `RESEARCH_API_SERVICE_KEY=<the VPS service-role JWT>` for authenticated
operator-only research access. Browser clients never receive either value.

## Default Model Routing

All non-image models are OpenAI-compatible and route by slug prefix. Image
generation models are configured separately and are unaffected by this cutover.

| Task / policy slot | Default model | Provider | Key required |
| --- | --- | --- | --- |
| `page_resolution` | `qwen3.5-plus` | DashScope | `DASHSCOPE_API_KEY` |
| `ad_classification` | `kimi-k2.5` (vision) | Moonshot | `MOONSHOT_API_KEY` |
| `vision_classification` | `kimi-k2.5` (vision) | Moonshot | `MOONSHOT_API_KEY` |
| `coverage_audit` | `qwen3.5-plus` | DashScope | `DASHSCOPE_API_KEY` |
| `defect_investigation` | `kimi-k2.6` | Moonshot | `MOONSHOT_API_KEY` |
| `best_copywriting` | `kimi-k2.6` | Moonshot | `MOONSHOT_API_KEY` |
| `best_reasoning` | `kimi-k2.6` | Moonshot | `MOONSHOT_API_KEY` |
| `best_json` | `qwen3.5-plus` | DashScope | `DASHSCOPE_API_KEY` |
| `critic_review` | `qwen3.5-plus` | DashScope | `DASHSCOPE_API_KEY` |
| `code_generation` | `kimi-k2.7-code` | Moonshot | `MOONSHOT_API_KEY` |
| `best_image_prompting` | `kimi-k2.5` | Moonshot | `MOONSHOT_API_KEY` |
| (fallback) | `kimi-k2.6` | Moonshot | `MOONSHOT_API_KEY` |

`HERMES_MODELS_JSON` and `HERMES_CONTENT_MODELS_JSON` overrides always win over
these built-in defaults. Unknown model slugs (anything not starting with
`kimi`/`moonshot`/`qwen`) are a hard configuration error — there is no OpenAI
fallback.

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
| `HERMES_MODELS_JSON` | `{}` | Optional per-task model map for `page_resolution`, `ad_classification`, `vision_classification`, `coverage_audit`, and `defect_investigation`. Overrides always win over the built-in Kimi/Qwen defaults. |
| `HERMES_CONTENT_MODELS_JSON` | `{}` | Optional content policy-slot map (`best_copywriting`, `best_reasoning`, `best_json`, `critic_review`, `code_generation`, `best_image_prompting`) plus per-skill overrides. Wins over built-in defaults. |
| `HERMES_MOONSHOT_BASE_URL` | `https://api.moonshot.ai/v1` | Override the Moonshot/Kimi OpenAI-compatible base URL. |
| `HERMES_DASHSCOPE_BASE_URL` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | Override the Alibaba DashScope (Qwen) OpenAI-compatible base URL. |
| `HERMES_AGENT_BASE_URL` | `https://api.moonshot.ai/v1` | Base URL written into the agent-core `config.yaml` by `main-wrapper.sh`. |
| `MEM0_API_KEY` | none | Passed through to Hermes when configured. |
| `MEM0_PROJECT_ID` | `blockwise-research` | Passed through to Hermes. |
| `RESEND_API_KEY` | none | Optional notification email provider key. |

## Supervisor Cadence

| Variable | Default | Notes |
| --- | --- | --- |
| `HERMES_RESEARCH_MODE` | `maintain` | `build` raises several queue and backfill defaults. |
| `BLOCKWISE_RESEARCH_RUNTIME_ENABLED` | `true` | Global supervisor switch. Set `false` only to stop every runtime path, including content runs. |
| `HERMES_AD_RADAR_ENABLED` | `false` | Launch-safe Ad Radar switch. When `false`, Hermes still processes `blockwise-content-run-orchestrator` jobs, but does not create or claim Ad Radar work, run watchdogs/backfills, publish the customer read model, audit accuracy, or purge inactive ads. Existing rows, objects, and queue items remain untouched. |
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

## Research Database And Customer Publishing

| Variable | Default | Notes |
| --- | --- | --- |
| `HERMES_SUPABASE_URL` | `http://blockwise-research-gateway:3000` | Private VPS research REST gateway. |
| `HERMES_SUPABASE_SERVICE_ROLE_KEY` | `HERMES_RESEARCH_SERVICE_ROLE_KEY` | Private VPS service JWT. |
| `HERMES_CUSTOMER_SUPABASE_URL` | `SUPABASE_URL` | Blockwise customer Supabase used only for app-required projections and media. |
| `HERMES_CUSTOMER_SUPABASE_SECRET_KEY` | `SUPABASE_SECRET_KEY` | Preferred customer publisher/storage credential. |
| `HERMES_CUSTOMER_SUPABASE_SERVICE_ROLE_KEY` | `SUPABASE_SERVICE_ROLE_KEY` | Legacy customer publisher/storage fallback. |
| `HERMES_CUSTOMER_READ_MODEL_PUBLISH_INTERVAL_SECONDS` | `300` | Publishes the customer-safe Ad Radar projection. |
| `HERMES_RAW_EVIDENCE_DIR` | `/opt/research-raw-evidence` | Private VPS volume for raw provider/browser evidence. |
| `HERMES_RESEARCH_AD_CREATIVES_BUCKET` | `research-ad-creatives` | Customer-visible creative media retained in Blockwise Supabase Storage. |
| `HERMES_RESEARCH_SCREENSHOTS_BUCKET` | `research-screenshots` | Legacy empty bucket removed after cutover. |
| `HERMES_RESEARCH_RAW_EVIDENCE_BUCKET` | `research-raw-evidence` | Migration source only; removed after its manifest is verified on the VPS. |

The private research schema, work queue, decisions, ingest events, runtime
settings, and raw evidence stay on the VPS. Customer Supabase contains only
workspace/product tables, the denormalized `customer_ad_radar_*` read model,
and media needed to render the app.

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

Location ad search has been removed. The census → page-resolver → ad-collector
pipeline is the only discovery path; these retained variables are disabled and
have no effect in the supervisor.

| Variable | Default | Notes |
| --- | --- | --- |
| `HERMES_LOCATION_AD_SEARCH_ENABLED` | `false` | Retained deployment compatibility setting; no location-search work is queued. |
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
8. `OPENAI_API_KEY` — no longer a user-configured secret. The research runtime
   reads `MOONSHOT_API_KEY` / `DASHSCOPE_API_KEY` directly. The agent-core
   (Python Hermes) still reads `OPENAI_API_KEY`, but `main-wrapper.sh` derives it
   from `MOONSHOT_API_KEY` at exec time; do not set it in `.env`.
9. `HERMES_ESCALATION_MODEL` — removed; escalation uses the standard resolver.
