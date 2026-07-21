# Meta Capture Rebuild (Crawlee, no Apify) + Hermes Model Cutover (Kimi/Qwen)

**Date:** 2026-07-20
**Status:** approved by operator, in implementation
**Scope:** VPS Hermes research runtime only. Vercel app code never scrapes; it keeps
reading research state from Supabase. Image-generation models are explicitly out of
scope until the operator finishes testing them.

---

## Part 0 — Why this replaces the pasted spec

The pasted spec ("Master Build Specification: Meta Ad Library Scraper") has the right
architecture and wrong details. Verified corrections:

| Pasted spec | Correction (verified) |
|---|---|
| `@crawlee/fingerprint-suite` npm package | Does not exist (npm 404). Use Crawlee's built-in fingerprints (`browserPoolOptions.useFingerprints`, default `true`). No manual injection — a second random fingerprint on top creates UA/JS mismatches that are themselves a bot signal. |
| `@crawlee/fingerprint-generator` import | Not a package; not needed. |
| `page.on('response')` inside `requestHandler` | Crawlee navigates *before* `requestHandler`; the listener misses the initial GraphQL responses. Register interception in `preNavigationHooks` and let Crawlee do the (single) navigation. |
| extra `page.goto()` in handler | Double navigation doubles proxy traffic and Meta hits. Delete. |
| `waitUntil: 'networkidle'` | Never reliably fires on facebook.com (long-lived connections). Use `domcontentloaded` + waiting on intercepted GraphQL responses. |
| parser shape `data.ads_library.edges` | Guessed; extracts nothing. Real shape: `data.ad_library_main.search_results_connection.edges[].node.collated_results[]` (defensive traversal, see Part 2). |
| `log.warning` | Does not exist; `log.warn`. Crashed the exact no-ads path. |
| PM2 ecosystem (`cron_restart`, `pm2 validate`) | Wrong process model for us. The Hermes supervisor already schedules captures via `research.work_queue`; there is no standalone PM2 app. `pm2 validate` is not a real command. |
| `ads.jsonl` local file as the sink | Breaks the pipeline. The sink is the existing supervisor ingest into `research.observed_ads` / `ad_snapshots` / `ad_creatives` / `media_assets` via `ingestMetaAd`. JSONL is kept only as per-run debug evidence. |
| no dedupe | Required: dedupe by `ad_archive_id` inside a run; Supabase upsert keys handle cross-run dedupe. |
| DoD: "fires without syntax errors" | Useless. DoD requires N>0 parsed ads from a live page plus unit tests against a captured GraphQL fixture. |

Scale model (Perth metro → WA → all capitals): coverage breadth comes from the
existing queue (census → page resolver → `blockwise-ad-collector` jobs, plus gated
`blockwise-location-ad-search` suburb/keyword scans), not from the scraper. The
scraper is the fetch engine. At concurrency 1 with residential proxy rotation expect
~1–3k ads/hour unblocked; Perth metro is an overnight job, all capitals is several
nights. To go faster, shard *queries* across workers on *different* residential
exits — never raise concurrency on one IP.

---

## Part 1 — Architecture

```
research.work_queue jobs (existing, unchanged)
  blockwise-ad-collector        { metaPageId, country=AU, activeStatus, resultsLimit, realEstateGate, ... }
  blockwise-location-ad-search  { query, suburb, postcode, state, country, location_search_allowed, realEstateGate, ... }
        │
        ▼  supervisor dispatch (supabase-supervisor.mjs)
  1. official Meta Ad Library API  (if HERMES_META_AD_LIBRARY_ACCESS_TOKEN set) — keep, unchanged
  2. hermes_browser  →  spawn child process:
        node /app/meta-library-capture/bin/capture.mjs --input '<json>'
        │
        ▼  stdout: MetaCaptureOutcome JSON (contract in src/lib shape, see types)
  ingestMetaAd (existing, unchanged) → observed_ads / ad_snapshots / ad_creatives /
  media_assets / ad_fetch_runs / area matches / classifier+media queue jobs
```

The capture tool is a **standalone CLI** (child process), not an import. This keeps
Crawlee's dependency tree out of the supervisor and lets a hung browser be killed by
timeout without taking the supervisor down.

Deleted providers: `apify` (adapter + benchmark + budget guard + capture_actors),
and the inline CDP DOM-dump meta-capture path (`browserDumpDom`/`captureDomOverCdp`
stay only where used for non-meta research DOM dumps — audited during surgery).
`http_json` provider is removed: nothing runs it and it existed as an Apify-era
adapter. `meta_capture_mode` setting becomes `hermes_browser | disabled`
(matches the operator console zod enum that already only allows those two).

### Capture tool internals (`hermes/tools/meta-library-capture/`)

Rewrite as plain `.mjs` (matches research-runtime style; no TS build step in the
container). Old `.ts` scaffold (`capture.ts`, `clients.ts`, `config.ts`,
`normalise.ts`, `types.ts`, `index.ts`, untracked `scraper.ts`) is deleted; its
contract shape moves into the `.mjs` tool and the contract tests are updated to
match (they currently regex-pin `src/*.ts`).

```
hermes/tools/meta-library-capture/
├── package.json            # crawlee + playwright-core ONLY (system chromium, no browser download)
├── package-lock.json
├── bin/capture.mjs         # CLI entry: --input '<json>' | stdin → MetaCaptureOutcome on stdout
└── src/
    ├── crawler.mjs         # Crawlee PlaywrightCrawler setup (fingerprints, proxy, sessions)
    ├── graphql.mjs         # response interception + ad_library_main extraction
    ├── map-ad.mjs          # collated_result node → MetaAdLibraryAd
    └── outcome.mjs         # MetaCaptureOutcome builder (SUCCEEDED/FAILED, confirmed_absence)
```

**CLI input** (JSON):
```json
{
  "url": "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=AU&view_all_page_id=<id>&media_type=all",
  "kind": "page | location_search",
  "metaPageId": "<id|null>",
  "country": "AU",
  "activeStatus": "active | inactive | all",
  "resultsLimit": 250,
  "timeoutMs": 120000
}
```
The supervisor already builds both URL shapes (`metaAdLibraryPageUrl`,
`metaAdLibraryLocationSearchUrl`) — reuse them verbatim.

**CLI output** = existing `MetaCaptureOutcome`:
`{ runId, provider: "hermes_browser", status: "SUCCEEDED"|"FAILED"|"TIMED_OUT", startedAt, finishedAt, costUsd: 0, itemCount, items: MetaAdLibraryAd[], rawDatasetId: null, errorMessage, metadata: { confirmed_absence, blocked_reason?, pages_loaded, scrolls } }`.
`confirmed_absence: true` only when the page loaded cleanly, no bot challenge, and
zero results — the supervisor's trusted-zero path depends on this distinction.

**Crawler rules (hard requirements):**
1. `PlaywrightCrawler` with `maxConcurrency: 1`, `maxRequestRetries: 2`,
   `requestHandlerTimeoutSecs` from input timeout. Session pool ON; fingerprints ON
   (default). System chromium via `launchOptions.executablePath` from
   `HERMES_META_BROWSER_EXECUTABLE` (default `chromium`); never download browsers
   (`playwright-core`, not `playwright`).
2. Proxy: `ProxyConfiguration` from `RESIDENTIAL_PROXY_URL` when set. If unset, run
   direct but log a loud warning (datacenter IP will be challenged often).
3. GraphQL interception registered in `preNavigationHooks` (page exists,
   navigation has not happened yet). Collect every POST to a URL containing
   `/api/graphql/` whose parsed JSON contains `ad_library_main`. Buffer parsed ads
   per request; dedupe by `ad_archive_id` across the whole run.
4. Navigation: Crawlee default (it uses `domcontentloaded`-class waits); then in
   `requestHandler`: cookie-consent dismissal (existing helper logic from
   `scraper.ts` may be reused), then a scroll loop: scroll ~1 viewport, wait
   1.5–3s jitter, stop when `resultsLimit` reached OR 5 consecutive scrolls yielded
   no new ads OR 90% of timeout budget consumed.
5. Bot-challenge detection (title/body signals: "Security check", "log in to
   continue", checkpoint, empty shell with no ad_library_main after N responses):
   throw a distinct `MetaBlockedError` → crawler retires the session, retries once
   with a fresh session; if still blocked, outcome `status: "FAILED"`,
   `errorMessage: "blocked:<signal>"`, `metadata.confirmed_absence: false`.
6. Human pacing: 2–5s random pre-navigation delay; no login, ever.
7. Evidence: write raw intercepted GraphQL JSON for the first N responses to a
   temp dir; the supervisor's existing raw-evidence upload path handles persistence
   (keeps parity with the Apify-era `writeRawEvidence`).

**Parser → `MetaAdLibraryAd` mapping** (from
`ad_library_main.search_results_connection.edges[].node.collated_results[]`; every
access defensive, unknown shapes skipped not fatal):
- `adArchiveID`/`id` ← `ad_archive_id` (string; must match `/^\d{8,}$/` or skip node)
- `pageID` ← `page_id`, `pageName` ← `page_name` (fallback `snapshot.page_name`)
- `isActive` ← `is_active`; `status` ← active/inactive
- `startDate`/`endDate` ← `start_date`/`end_date` (unix seconds → ISO string)
- `publisherPlatform` ← `publisher_platform[]` lowercased, default `["facebook"]`
- `snapshot` ← pass through `snapshot{}` with: `title` ← `snapshot.title`,
  `body` ← `snapshot.body.text ?? snapshot.body`, `caption`, `ctaText` ←
  `snapshot.cta_text`, `linkUrl` ← `snapshot.link_url`, `cards[]`,
  `images[]` ← `{originalImageUrl}` from `original_image_url ?? resized_image_url`,
  `videos[]` ← `{videoHdUrl}` from `video_hd_url ?? video_sd_url`,
  `displayFormat`, `pageName`, `pageId`
- `inputUrl` ← `https://www.facebook.com/ads/library/?id=<adArchiveID>`
- `rawHostedProvider` ← the raw node (lands in `observed_ads.raw_payload`)

Parser unit tests run against a checked-in fixture
(`tests/fixtures/meta-graphql-search-results.json`) captured from a real response
during the VPS smoke test; fixture is recorded with generic/synthetic ids.

---

## Part 2 — Supervisor surgery (delete Apify, wire new tool)

In `hermes/tools/research-runtime/bin/supabase-supervisor.mjs`:

- **Delete:** the `apify-capture.mjs` import and everything that flows from it:
  `runApifyMetaPageCapture`, `runApifyCandidateBenchmarkIfNeeded`,
  `benchmarkApifyCandidateActor`, `runApifyLocationSearchCapture`,
  `resolveApifyCaptureActor`, `apifyMetaPageInput`, `apifyMetaLocationSearchInput`,
  `normaliseApifyMappedMetaItems`, the Apify budget guard/circuit recovery, the
  canary benchmark tick, `APIFY_TOKEN`/`APIFY_API_TOKEN` env reads.
  Then delete `hermes/tools/research-runtime/bin/apify-capture.mjs` itself.
- **Rewire:** the `hermes_browser` page-capture path and the location-search path
  both call the new child-process CLI (one shared helper
  `runMetaLibraryCaptureCli({ url, kind, ... })` → spawn with timeout+buffer cap →
  parse stdout JSON → validate minimal outcome shape). Provider dispatch becomes:
  official API if token → `hermes_browser` unless `meta_capture_mode=disabled`.
- **Keep untouched:** `ingestMetaAd` and everything downstream (snapshots,
  creatives, media, area matches, classifier handoff, reconciliation,
  trusted-zero semantics, coverage defects).
- `docker-compose.research.yml`: remove `APIFY_TOKEN`/`APIFY_API_TOKEN`; add
  `RESIDENTIAL_PROXY_URL: ${RESIDENTIAL_PROXY_URL:-}` and
  `HERMES_META_CAPTURE_PROXY_URL: ${HERMES_META_CAPTURE_PROXY_URL:-${RESIDENTIAL_PROXY_URL:-}}`.
- `infra/hermes/Dockerfile`: after copying `meta-library-capture`, run
  `npm ci --omit=dev` in that dir (requires committed `package-lock.json`).
- **Migration** `supabase/migrations/20260720_xxxx_drop_apify_capture.sql`:
  archive `research.capture_actors` to `legacy_archive` (row-count check first,
  per AGENTS.md destructive-change rule); delete `apify_*` rows from
  `research.runtime_settings`; set `meta_capture_mode` default/value to
  `"hermes_browser"` where it is `"apify"`; rebuild `research.v_health` without the
  Apify spend clauses; update the cutover test
  `supabase/tests/*` accordingly.
- **Tests:** delete `tests/research-engine/apify-capture.test.mjs`; rewrite the
  Apify-specific blocks in `hermes-collector-contract.test.mjs` and
  `tests/hard-reset/research-contracts.test.ts` (sourceProvider must still never
  contain "apify"); new tests: parser fixture test, CLI input validation test,
  supervisor spawn-helper test (mocked child). `tests/paid-service-watchdog.test.ts`
  Apify references removed with the watchdog Apify clauses (OpenAI spend watchdog
  is app-side; leave the watchdog itself alone).

---

## Part 3 — Hermes model cutover (non-image → Kimi + Qwen)

Both providers are OpenAI-compatible chat-completions; the runtime already sends
`max_completion_tokens`, which both accept.

| Provider | Base URL | Key env | Models (verified 2026-07) |
|---|---|---|---|
| Moonshot (Kimi) | `https://api.moonshot.ai/v1` | `MOONSHOT_API_KEY` | `kimi-k3` (always-thinking default), `kimi-k2.7-code`, `kimi-k2.6`, `kimi-k2.5` (native multimodal: image_url/video_url) |
| Alibaba (DashScope compatible mode) | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `DASHSCOPE_API_KEY` | `qwen3.5-plus` (flagship), `qwen3-max-2026-01-23`, `qwen3-coder-plus`, `qwen3.5-omni-plus` (multimodal) |

Known caveat: DashScope's compatible mode is stricter about tool-call argument
encoding (double-encoded `function.arguments` 400s). Keep the **tool-calling agent
core on Kimi**; use Qwen for plain text→JSON/text tasks.

**Routing rule** (implemented once in research-runtime, used everywhere):
model slug starts with `kimi`/`moonshot` → Moonshot endpoint+key;
starts with `qwen` → DashScope endpoint+key; anything else → config error
(fail fast, no silent OpenAI fallback).

**Default task mapping** (all overridable by the existing `HERMES_MODELS_JSON` /
`HERMES_CONTENT_MODELS_JSON`):

| Task / policy slot | Model | Why |
|---|---|---|
| `HERMES_DEFAULT_MODEL` (agent core + fallback) | `kimi-k2.6` | strong general + tool use, avoids DashScope tool-call quirk |
| `page_resolution` | `qwen3.5-plus` | cheap bulk text→JSON |
| `ad_classification` (vision input!) | `kimi-k2.5` | native multimodal, strict JSON output |
| `coverage_audit` | `qwen3.5-plus` | cheap bulk |
| `defect_investigation` | `kimi-k2.6` | reasoning-heavy |
| content `best_copywriting` / `best_reasoning` | `kimi-k2.6` | quality |
| content `best_json` / `critic_review` | `qwen3.5-plus` | cheap structured |
| content `code_generation` | `kimi-k2.7-code` | code-specialised |
| content `best_image_prompting` | `kimi-k2.5` | text prompt-writing only; image GENERATION models untouched |

**Files changed:**
- `hermes/tools/research-runtime/src/config.ts` + the `.mjs` twins the bins
  actually run: add `MOONSHOT_API_KEY` / `DASHSCOPE_API_KEY` (one required iff a
  model of that family is configured), `HERMES_MOONSHOT_BASE_URL`,
  `HERMES_DASHSCOPE_BASE_URL` with the defaults above; drop the hard
  `OPENAI_API_KEY` requirement; `modelForTask` gains `providerForModel`.
- `hermes/tools/research-runtime/src/openai.ts` → generalise to an
  OpenAI-compatible client (base URL + key from routing rule). Keep the class/API
  shape so callers barely change.
- `bin/ad-classifier.mjs`, `bin/content-engine.mjs`: replace hardcoded
  `https://api.openai.com/v1/chat/completions` + `OPENAI_API_KEY` + `gpt-5.5`
  fallbacks with the shared resolver. Classifier's multimodal `image_url` path
  unchanged (Kimi accepts the same content-parts shape).
- `infra/hermes/main-wrapper.sh`: agent-core `config.yaml` gets
  `base_url: "${HERMES_AGENT_BASE_URL:-https://api.moonshot.ai/v1}"` and the core
  process gets `OPENAI_API_KEY="${MOONSHOT_API_KEY}"` exported (base image reads
  `OPENAI_API_KEY`; this scopes the repoint to the core only).
- `infra/hermes/hermes.toml`: comment updated (provider stays `openai` =
  OpenAI-compatible protocol).
- `docker-compose.research.yml`: replace `OPENAI_API_KEY` with
  `MOONSHOT_API_KEY` / `DASHSCOPE_API_KEY`; update `HERMES_DEFAULT_MODEL` default.
- `scripts/vps/vps-runtime-cutover.sh`, `docs/research-engine/env.md`: same swap;
  remove vestigial `HERMES_ESCALATION_MODEL`.
- Skill docs mentioning `gpt-5.5` (`blockwise-ad-classifier/SKILL.md` etc.) updated
  to "model comes from env; current defaults are Kimi/Qwen".

**Out of scope (unchanged):** the Vercel app's Model Control registry
(`src/lib/ai/*`, `src/lib/adstudio/*`, `public.model_profile_versions` rows) —
that is a separate cutover with its own migration and UI whitelist. Image models
(`gemini-3.1-flash-image`, `gpt-image-2`) untouched everywhere.

---

## Part 4 — Definition of Done

Code:
- [ ] `npm run typecheck` and `npm run test` green (updated contract tests included).
- [ ] No `apify` references outside `_archive/`, historical migrations, and the
      contract test that bans it. No `gpt-`/`openai` references in Hermes runtime
      config paths outside historical docs/migrations.
- [ ] Parser fixture test passes; CLI validates bad input with exit code ≠ 0.

Deploy (VPS `blockwise-vps`, `/opt/blockwise`):
- [ ] `.env` gains `RESIDENTIAL_PROXY_URL`, `MOONSHOT_API_KEY`, `DASHSCOPE_API_KEY`
      (operator-supplied); `APIFY_*`/`OPENAI_API_KEY` removed from compose env.
- [ ] Migration applied; `capture_actors` archived; `meta_capture_mode=hermes_browser`.
- [ ] `docker compose ... up -d --build hermes` green; health endpoint OK.
- [ ] **Live smoke:** enqueue one `blockwise-ad-collector` job for a known WA
      real-estate page → supervisor logs show capture CLI `SUCCEEDED` with
      `itemCount > 0` → rows visible in `research.observed_ads` +
      `ad_creatives` with `classification_status='unclassified'` → classifier job
      runs on `kimi-k2.5` and writes a classification.
- [ ] One location-search job for a Perth suburb completes the same path.
- [ ] Supervisor logs show no Apify code paths and no OpenAI calls for a full
      15-minute window; spend watchdog silent.

Rollback: previous git ref + previous image tag (`blockwise/hermes-research:*`
before this build); migration is additive-archive only (no hard drops), so DB
rollback is not destructive.

---

## Part 5 — Explicit delete list

- `hermes/tools/research-runtime/bin/apify-capture.mjs`
- Apify sections of `supabase-supervisor.mjs` (listed in Part 2)
- `hermes/tools/meta-library-capture/src/*.ts` scaffold incl. untracked
  `scraper.ts` (superseded by the `.mjs` tool)
- `tests/research-engine/apify-capture.test.mjs`
- `infra/coolify/docker-compose.research.yml` `APIFY_*` envs (Steel/Obscura
  services stay for non-meta DOM-dump duties; re-evaluate after the smoke test —
  if nothing else uses them, they get removed in a follow-up)
- DB: `research.capture_actors` (archived), `apify_*` runtime settings
- Docs: Apify mentions in `docs/research-engine/*`, `docs/runbooks/*`,
  `AGENTS.md` (the "never executes Apify" safety line becomes "research capture
  runs only on the VPS via the hermes_browser Crawlee tool")
