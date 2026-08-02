## Dimension 3: Replacement Architecture & Daily Refresh Design

**Date:** 2026-07-25
**Scope:** Eliminate Apify dependency while maintaining live Ad Radar data refreshed daily.
**Current Apify Spend:** ~$25 USD/month (capped), circuit-breaker protected.

---

### Key Findings

1. **Blockwise already has three capture paths**, and Apify is already the *fallback* — not the primary. The supervisor (`supabase-supervisor.mjs`) attempts capture in this order:
   - **Official Meta Ad Library API** (`META_OFFICIAL_SOURCE_PROVIDER`) — free, token-based, paginated
   - **Configured fallback** — either Apify, HTTP JSON endpoint, or Steel Browser
   - **Apify** only runs when `metaOfficialApiEnabled=false` OR when the official API fails AND the fallback is set to Apify

2. **The existing Steel Browser is production-ready** but hits Meta bot challenges under load. The code already has a challenge cooldown mechanism (`metaBrowserChallengeCooldownMs = 15 min`) and falls back to local Chromium if the remote Steel instance fails.

3. **The queue/worker/supervisor pattern is fully deterministic** and operates on `research.work_queue` with `claim_work_queue_jobs` RPC using `FOR UPDATE SKIP LOCKED`. No additional queue infrastructure (Redis, RabbitMQ, etc.) is needed.

4. **Trigger.dev v3 already runs scheduled tasks** (`weeklyAdRadarAccuracyAuditTask`). Adding a daily refresh task is a straightforward extension using `schedules.task({ id, cron, run })`.

5. **Data quality is already guarded** by:
   - `reconcileMissingObservedAds()` — marks ads inactive after 2 consecutive missed checks
   - `watchdog_record_zero_ad_anomalies` — reports zero-ad successes
   - `watchdog_record_provider_failures` — reports provider failure thresholds
   - Coverage defects in `research.coverage_defects` with auto-resolution on success

6. **OpenRouter LLM classification costs** are capped at `$HERMES_DAILY_SPEND_LIMIT_USD=25` and use environment-driven model selection.

---

### Recommended Architecture

**Goal:** Remove Apify entirely while maintaining equivalent or better capture coverage.

**Recommended Stack:**

```
┌─────────────────────────────────────────────────────────────┐
│  PRIMARY: Meta Official Ad Library API (free)                 │
│  ├── HERMES_META_OFFICIAL_API_ENABLED=true                  │
│  ├── HERMES_META_AD_LIBRARY_ACCESS_TOKEN=<token>            │
│  └── Rate limit: 200 calls/hour/app, 100 results/page       │
├─────────────────────────────────────────────────────────────┤
│  FALLBACK 1: Steel Browser (self-hosted, VPS)               │
│  ├── HERMES_REMOTE_BROWSER_CDP_URL=http://blockwise-steel:9223 │
│  ├── CDP-based headless Chromium                            │
│  └── Challenge cooldown: 15 min auto-backoff                │
├─────────────────────────────────────────────────────────────┤
│  FALLBACK 2: Local Chromium (bundled with Hermes)            │
│  ├── HERMES_META_BROWSER_EXECUTABLE=chromium                │
│  └── Spawns per-job, kills after capture                    │
├─────────────────────────────────────────────────────────────┤
│  ELIMINATED: Apify paid actors                              │
│  ├── APIFY_TOKEN removed from env                           │
│  ├── apify_enabled=false in runtime_settings                │
│  └── Code path left for rollback but never called           │
└─────────────────────────────────────────────────────────────┘
```

**Configuration Changes Required:**

```bash
# .env / docker-compose.research.yml
HERMES_META_OFFICIAL_API_ENABLED=true
HERMES_META_AD_LIBRARY_ACCESS_TOKEN=<valid_meta_token>
HERMES_META_OFFICIAL_PAGE_LIMIT=100
HERMES_META_OFFICIAL_MAX_PAGES_PER_CAPTURE=25
HERMES_META_CAPTURE_PROVIDER=hermes_browser
HERMES_REMOTE_BROWSER_CDP_URL=http://blockwise-steel:9223

# Disable Apify
APIFY_TOKEN=""
apify_enabled=false  # via research.runtime_settings
```

**Rationale:** The official API is free, stable, and returns structured JSON. The Steel browser is already deployed and handles the edge cases (pages without API access, challenge pages). Local Chromium is the final safety net. Removing Apify eliminates the $25/month spend and the circuit-breaker complexity without losing capture capability.

> **Source:** `hermes/tools/research-runtime/bin/supabase-supervisor.mjs:2955-2991` (capture priority logic)

---

### Daily Refresh Pipeline

**Current Flow (already exists):**

```
build_run (daily) ──► refresh_policies ──► work_queue jobs ──► worker claims ──► capture ──► ingest
```

**The supervisor `tick()` does this every `intervalMs` (default 10-60s):**

1. `ensureBuildRun()` — creates/uses a running build_run for today
2. `ensureSourceBackedRefreshPolicies()` — seeds `research.refresh_policies` from postcode data
3. `enqueueDueCensusJobs()` — queues `blockwise-agent-census` for overdue postcodes
4. `enqueueDueAdPageRefreshJobs()` — queues `blockwise-ad-collector` for stale pages
5. `enqueueDueLocationAdSearchJobs()` — queues `blockwise-location-ad-search` for area coverage
6. `processClaimedJobs()` — workers claim and execute jobs
7. `runWatchdogs()` — requeues stale jobs, records anomalies, backfills classification

**Ad Page Refresh Config (Maintain Mode):**

```bash
HERMES_AD_PAGE_REFRESH_ENABLED=true
HERMES_AD_PAGE_REFRESH_INTERVAL_MINUTES=360    # 6 hours between checks
HERMES_AD_PAGE_REFRESH_BATCH_SIZE=16           # 16 pages per tick
HERMES_AD_PAGE_REFRESH_MAX_ACTIVE=80             # max 80 concurrent collectors
HERMES_AD_PAGE_REFRESH_MAX_CONSECUTIVE_FAILURES=3
```

**Location Ad Search Config:**

```bash
HERMES_LOCATION_AD_SEARCH_ENABLED=true
HERMES_LOCATION_AD_SEARCH_INTERVAL_MINUTES=720   # 12 hours
HERMES_LOCATION_AD_SEARCH_BATCH_SIZE=12            # 12 searches per tick
HERMES_LOCATION_AD_SEARCH_MAX_ACTIVE=40
HERMES_LOCATION_AD_SEARCH_PROVIDER=hermes_browser  # NOT apify
```

**Optimization Opportunities:**

1. **Shorten refresh interval** from 360 min to 180 min in maintain mode for fresher data:
   ```bash
   HERMES_AD_PAGE_REFRESH_INTERVAL_MINUTES=180
   HERMES_AD_PAGE_REFRESH_BATCH_SIZE=24
   HERMES_AD_PAGE_REFRESH_MAX_ACTIVE=120
   ```
   This keeps the same daily throughput (~80 pages × 4 refreshes = 320 page-checks/day) but spreads load more evenly.

2. **Add "fast lane" for recently-active pages** — pages with ads seen in the last 7 days should refresh every 60 minutes instead of 360. This requires a small SQL change to `enqueueDueAdPageRefreshJobs` to use a tiered cutoff.

3. **Batch official API calls** — the official API supports up to 100 results per page. Increase `HERMES_META_OFFICIAL_PAGE_LIMIT=100` and `HERMES_META_OFFICIAL_MAX_PAGES_PER_CAPTURE=50` to reduce total API calls per page.

> **Source:** `hermes/tools/research-runtime/bin/supabase-supervisor.mjs:6151-6174` (tick loop), `:638-700` (ad refresh logic)

---

### Queue & Supervisor Flow

**Table:** `research.work_queue`

**Schema (simplified):**
```sql
id uuid PRIMARY KEY
queue_name text
job_type text -- blockwise-agent-census, blockwise-ad-collector, etc.
dedupe_key text UNIQUE
priority int
payload jsonb
status text -- pending, claimed, complete, failed, blocked, archived
claim_token uuid
claimed_by text
claim_expires_at timestamptz
attempts int
max_attempts int
available_at timestamptz
```

**Claim Mechanism:**
```sql
-- research.claim_work_queue_jobs RPC
SELECT ... FROM research.work_queue
WHERE status = 'pending'
  AND available_at <= now()
ORDER BY priority ASC, available_at ASC, created_at ASC
FOR UPDATE SKIP LOCKED
LIMIT n;
-- Then UPDATE SET status='claimed', claim_token=gen_random_uuid(), claim_expires_at=now()+ttl
```

**Supervisor Cadence:**
- The supervisor runs continuously in a loop (`while(true)`), sleeping `intervalMs` between ticks
- Each tick is lightweight: mostly SQL queries and job enqueuing
- Actual heavy work (browser capture, API calls) happens inside claimed jobs
- A single supervisor instance can handle the entire workload; the queue handles parallelism via `claimLimit` and `maxJobsPerTick`

**Worker Concurrency:**
- Build mode: `claimLimit=4`, `maxJobsPerTick=4`
- Maintain mode: `claimLimit=1`, `maxJobsPerTick=1` (default)
- For daily refresh with only official API + Steel, maintain mode at `claimLimit=2` is sufficient since the official API is fast and Steel has built-in concurrency limits via challenge cooldown

**Watchdogs (run every tick, some hourly):**
1. `watchdog_requeue_stale_jobs` — reclaims expired claims
2. `watchdog_record_provider_failures` — flags providers with ≥3 failures in 24h
3. `watchdog_record_zero_ad_anomalies` — flags successful captures with 0 ads
4. `watchdog_record_missing_media` — flags creatives without captured media
5. `watchdog_record_unclassified_creatives` — flags missing classifications
6. `watchdogArchiveStaleBlockedJobs` — archives blocked jobs older than 7 days
7. `watchdogRecheckStaleAgencies` — hourly, rechecks agencies unseen for 30 days
8. `watchdogRequeueUnresolvedPages` — hourly, retries unresolved pages

> **Source:** `supabase/migrations/202606030000_research_work_queue_functions.sql`, `supabase-supervisor.mjs:843-871` (watchdog invocation)

---

### Trigger.dev Integration

**Current State:**
- `trigger.config.ts` defines the project with `dirs: ["./trigger"]`
- `weeklyAdRadarAccuracyAuditTask` runs at `0 8 * * 1` (Monday 8am Perth)

**New Daily Refresh Task:**

```typescript
// trigger/daily-ad-radar-refresh.ts
import { schedules } from "@trigger.dev/sdk/v3";
import * as Sentry from "@sentry/nextjs";
import { createSupabaseServiceClient } from "../src/lib/supabase/service.ts";

export const dailyAdRadarRefreshTask = schedules.task({
  id: "research.ad-radar.daily-refresh",
  cron: {
    pattern: "0 6 * * *",  // 6:00 AM UTC daily (2pm Perth, 4pm Sydney)
    timezone: "Australia/Perth",
  },
  run: async () => {
    const supabase = createSupabaseServiceClient();
    
    // Trigger a fresh build_run by ensuring the supervisor sees a new day
    // The supervisor already auto-creates build_runs, so this task
    // can force a "build mode" refresh by inserting a high-priority
    // refresh policy trigger
    const { data, error } = await supabase.rpc("trigger_ad_radar_daily_refresh", {
      p_target_states: ["WA"],  // or all enabled states
      p_refresh_mode: "maintain",
    });
    
    if (error) {
      Sentry.captureException(error);
      throw error;
    }
    
    return {
      status: "completed",
      refreshPoliciesTriggered: data?.policies_triggered || 0,
      pagesQueued: data?.pages_queued || 0,
      locationSearchesQueued: data?.location_searches_queued || 0,
    };
  },
});
```

**Required Supabase RPC:**
```sql
CREATE OR REPLACE FUNCTION research.trigger_ad_radar_daily_refresh(
  p_target_states text[] DEFAULT ARRAY['WA'],
  p_refresh_mode text DEFAULT 'maintain'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_policies_triggered int := 0;
  v_pages_queued int := 0;
  v_location_searches int := 0;
BEGIN
  -- Force all refresh_policies to be due immediately
  UPDATE research.refresh_policies
  SET next_refresh_at = NOW()
  WHERE state = ANY(p_target_states)
    AND active = true;
  
  GET DIAGNOSTICS v_policies_triggered = ROW_COUNT;
  
  -- Force all resolved_collectable pages to be due immediately
  UPDATE research.advertiser_pages
  SET last_checked_at = NULL
  WHERE status = 'resolved_collectable'
    AND active = true;
  
  GET DIAGNOSTICS v_pages_queued = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'policies_triggered', v_policies_triggered,
    'pages_queued', v_pages_queued,
    'location_searches_queued', v_location_searches
  );
END;
$$;
```

**Why Trigger.dev for this?**
- The supervisor already runs continuously on the VPS, so "daily refresh" is mostly about **forcing a comprehensive sweep** rather than starting the pipeline
- Trigger.dev gives observability, retry logic, and alerting integration (Sentry) that a simple cron job lacks
- It also serves as a **health check** — if the task fails to trigger policies, the team gets alerted

> **Source:** `trigger/ad-radar-accuracy.ts` (existing pattern), `trigger.config.ts` (project config)

---

### Data Quality & Validation

**The current system has multiple validation layers that must be preserved:**

1. **Capture Validation:**
   - `normaliseHostedMetaItems()` validates against `metaAdLibraryDatasetSchema` (Zod)
   - `looksLikeAdId()` ensures ads have 8+ digit IDs
   - Duplicate detection via `seen` Set in ingestion

2. **Zero-Ad Trust Rules:**
   - Official API zero-ad results are trusted (no cost, no bot interference)
   - Browser zero-ad results are **NOT trusted** if the page has prior observed ads (`isTrustedConfirmedZeroAdCapture`)
   - This prevents Meta bot challenges from falsely marking pages as "no ads"

3. **Reconciliation (Ad Lifecycle):**
   - `reconcileMissingObservedAds()` tracks `missing_successive_checks`
   - After 2 misses, an ad is marked `inactive` with `ad_delivery_stopped_at`
   - This is the primary mechanism for knowing when ads stop running

4. **Media Quality Gates:**
   - `assessCapturedImageQuality()` rejects images that are too small or low resolution
   - `hasUsableCapturedMedia()` ensures classification only runs when media is ready

5. **Coverage Defects:**
   - Every failure path opens a `coverage_defects` row
   - Defects auto-resolve when coverage is restored
   - `blockwise-defect-investigator` replays and verifies fixes

**Validation Needed for the New System:**

| Check | Method | Frequency |
|-------|--------|-----------|
| Official API token valid | Test call to `/ads_archive` | Daily via Trigger.dev |
| Steel browser reachable | CDP health check | Every supervisor tick |
| Capture rate vs Apify baseline | Compare `ad_fetch_runs` counts | Weekly |
| Classification coverage | `watchdog_record_unclassified_creatives` | Every tick |
| Media capture completeness | `watchdog_record_missing_media` | Every tick |
| Zero-ad anomaly rate | `watchdog_record_zero_ad_anomalies` | Every tick |

> **Source:** `supabase-supervisor.mjs:4493-4538` (reconciliation), `:2855-2923` (browser capture with zero-ad trust)

---

### Migration Path

**Phase 1: Configuration (Day 1)**
1. Obtain/verify `META_AD_LIBRARY_ACCESS_TOKEN` is valid and has `ads_read` permission
2. Set `HERMES_META_OFFICIAL_API_ENABLED=true` in `docker-compose.research.yml`
3. Set `apify_enabled=false` in `research.runtime_settings`
4. Deploy to VPS and verify official API calls succeed in logs

**Phase 2: Parallel Run (Week 1)**
1. Keep Apify code paths but set `HERMES_META_CAPTURE_PROVIDER=hermes_browser`
2. Monitor `ad_fetch_runs` for success rate by provider
3. Compare official API capture counts vs historical Apify counts per page
4. Run the new `dailyAdRadarRefreshTask` in Trigger.dev alongside the continuous supervisor

**Phase 3: Apify Disconnect (Week 2)**
1. Remove `APIFY_TOKEN` from environment
2. Set `apify_actor_id` to empty in runtime_settings
3. Archive `apify-capture.mjs` from active runtime (keep in repo for rollback)
4. Verify no `ad_fetch_runs` with `source_provider LIKE 'apify:%'` in the last 7 days

**Phase 4: Cleanup (Week 3)**
1. Remove Apify-related code from `supabase-supervisor.mjs` (or keep as dead code)
2. Drop `capture_actors` table if no longer needed (or keep for historical benchmarks)
3. Update documentation and runbooks

**Rollback Plan:**
1. Re-add `APIFY_TOKEN` to environment
2. Set `HERMES_META_CAPTURE_PROVIDER=apify` in runtime_settings
3. Set `apify_enabled=true` and `apify_state=ready`
4. The supervisor will immediately resume Apify fallback on the next tick

> **Source:** `docker-compose.research.yml` (env vars), `supabase-supervisor.mjs:3031-3059` (Apify enable/disable checks)

---

### Cost Analysis

| Component | Current (with Apify) | New (Official API + Steel) | Notes |
|-----------|----------------------|---------------------------|-------|
| **Apify** | $25/month | $0 | Removed entirely |
| **VPS (Hermes + Steel)** | ~$20-40/month | ~$20-40/month | Unchanged; Hostinger VPS |
| **Meta Official API** | $0 | $0 | Free for Ad Library API |
| **OpenRouter (Classification)** | ~$25/day | ~$25/day | Same cap; no change |
| **Supabase** | ~$25-50/month | ~$25-50/month | Same storage/compute |
| **Trigger.dev** | ~$0 (free tier) | ~$0 (free tier) | Scheduled tasks are lightweight |
| **Steel Browser** | $0 (self-hosted) | $0 (self-hosted) | Docker container on same VPS |
| **Total** | **~$100-140/month** | **~$75-115/month** | **~$25/month savings** |

**Note:** The main cost is not infrastructure but **OpenRouter LLM classification** at ~$25/day = ~$750/month. Removing Apify saves only ~3% of total cost. The real value is:
- **Eliminating vendor dependency** on Apify actor marketplace
- **Removing circuit-breaker complexity** and canary benchmarking
- **Predictable API behavior** vs. Apify actor changes/breakages

> **Source:** `hermes/tools/research-runtime/src/config.ts` (`HERMES_DAILY_SPEND_LIMIT_USD`), `supabase-supervisor.mjs:46` (Apify monthly cap)

---

### Failure Handling & Circuit Breakers

**Current Circuit Breakers (to be preserved):**

1. **Meta Browser Challenge Cooldown:**
   - When Meta returns a challenge page (`/__rd_verify_`, `executeChallenge`), the system sets `metaBrowserChallengeDisabledUntil = now + 15 min`
   - All browser-dependent jobs are deferred with a spread delay
   - Source: `supabase-supervisor.mjs:1417-1443`

2. **Remote Browser Failure Cooldown:**
   - If Steel CDP fails, `remoteBrowserDisabledUntil = now + 30 min`
   - Falls back to local Chromium for the cooldown period
   - Source: `supabase-supervisor.mjs:1205-1213`

3. **Apify Circuit Breaker (to be retired):**
   - Currently opens on `spend_without_ingest` or budget cap
   - Auto-recovers after 60 min cooldown if under monthly cap
   - With Apify removed, this circuit breaker can be deleted

4. **Official API Failure Handling:**
   - On HTTP error or `body.error`, the capture returns `FAILED`
   - The supervisor immediately falls back to Steel Browser
   - No circuit breaker needed because the API is free and rate limits are known
   - Source: `supabase-supervisor.mjs:3728-3741`

5. **Job Retry with Exponential Backoff:**
   - Failed jobs retry with delay: `min(60s * 2^(attempts-1), 15 min)`
   - After `max_attempts` (default 3), job is marked `blocked`
   - Source: `supabase-supervisor.mjs:6139-6146`

**Recommended Additions:**

1. **Official API Rate Limit Backoff:**
   - Meta Ad Library API rate limit: 200 calls/hour per app
   - Add a lightweight in-memory rate limiter or use `429` response header with `Retry-After`
   - If rate limited, defer jobs to the next tick

2. **Steel Resource Monitor:**
   - If Steel container memory exceeds 2GB (limit in docker-compose), restart it
   - Add a simple HTTP health endpoint to Steel and check it before CDP calls

> **Source:** `supabase-supervisor.mjs:6127-6148` (job retry logic), `:3711-3791` (official API capture)

---

### Scaling Characteristics

**Current Volume Estimates (Australian real estate, WA-focused):**

| Metric | Estimate | Source |
|--------|----------|--------|
| Resolved advertiser pages | ~500-2,000 | `advertiser_pages` table |
| Active ads observed | ~5,000-15,000 | `observed_ads` with `active_status='active'` |
| Daily ad refresh checks | ~80 pages × 4 cycles = 320 | `HERMES_AD_PAGE_REFRESH_*` config |
| Location searches per day | ~12-40 suburbs/postcodes | `HERMES_LOCATION_AD_SEARCH_*` config |
| New ads per day | ~50-200 | Ingestion rate from refresh |
| Classifications per day | ~200-500 | Classification backfill + new ads |
| Official API calls per day | ~320 page checks × 1-2 status passes = ~640 | Each check may call ACTIVE + INACTIVE |

**Scaling Limits:**

1. **Official API:** 200 calls/hour = 4,800 calls/day. At 640 calls/day, current usage is ~13% of quota. Can scale 7× before hitting limits.
2. **Steel Browser:** 2GB memory limit. Each CDP session is lightweight (~50-100MB), but concurrent sessions could exhaust memory. The current code serializes captures (one at a time per job), so memory is not a bottleneck.
3. **Supabase:** 100-500 concurrent connections. The supervisor uses long-polling REST, not persistent connections. At 2 jobs per tick, connection usage is minimal.
4. **OpenRouter:** $25/day = ~40,000-80,000 tokens/day depending on model. At 500 classifications/day, that's ~80-160 tokens per classification, which is well within limits.

**To Scale 10× (5,000 pages, 50,000 ads):**
- Increase `HERMES_AD_PAGE_REFRESH_BATCH_SIZE` to 100
- Increase `HERMES_AD_PAGE_REFRESH_MAX_ACTIVE` to 500
- Increase `HERMES_META_OFFICIAL_MAX_PAGES_PER_CAPTURE` to 50
- Run 2-3 Hermes supervisor instances (each with different `workerId`) to parallelize job claiming
- Consider adding a second Steel browser instance on a separate VPS for geographic diversity

> **Source:** `docker-compose.research.yml` (resource limits), `supabase-supervisor.mjs:74-76` (refresh config), `:3711-3791` (official API pagination)

---

### Kimi Code / WebBridge Integration

**Kimi Code** (Moonshot AI's agentic coding tool) and **Kimi WebBridge** (browser control) can augment the system in several ways:

**1. Manual Validation & Edge Cases (Kimi WebBridge)**
- For pages where the official API returns 0 ads but the browser shows ads, a Kimi WebBridge agent can:
  - Navigate to the Meta Ad Library page manually
  - Screenshot and compare with the database
  - Identify if the discrepancy is due to API rate limiting, token permissions, or page privacy settings
- Trigger: `watchdog_record_zero_ad_anomalies` creates a defect → Kimi WebBridge agent investigates

**2. Ad Classification Augmentation (Kimi Code)**
- The current classifier uses OpenRouter LLMs with structured JSON output
- For edge cases (ambiguous ads, new formats, policy violations), a Kimi Code agent can:
  - Read the creative, media, and landing page
  - Apply the classification schema with reasoning
  - Write a `agent_decisions` row with the classification
- This is not a replacement but a **human-in-the-loop escalation path**

**3. Coverage Gap Analysis (Kimi Code Agent Swarm)**
- A swarm of agents can:
  - Agent 1: Search REIWA/Domain for new agencies in a postcode
  - Agent 2: Verify if each agency has a Meta page
  - Agent 3: Compare findings with `research.advertiser_pages`
  - Agent 4: Queue missing agencies for census
- This replaces manual postcode audits with automated agent swarms

**4. Steel Browser Fallback Augmentation (Kimi WebBridge)**
- When Steel hits a challenge page, Kimi WebBridge could:
  - Detect the challenge type visually
  - Attempt to solve it (if it's a simple CAPTCHA)
  - Or report the challenge type for engineering review
- This is more sophisticated than the current "cooldown and retry" approach

**Implementation Sketch:**
```typescript
// trigger/ad-radar-validation.ts
import { schedules } from "@trigger.dev/sdk/v3";

export const adRadarValidationTask = schedules.task({
  id: "research.ad-radar.validation.weekly",
  cron: "0 10 * * 3", // Wednesday 10am Perth
  run: async () => {
    // Launch Kimi WebBridge to validate 10 random active ads
    // Compare screenshots with database records
    // Report discrepancies to Sentry + coverage_defects
  },
});
```

> **Source:** Kimi for Work documentation (agent swarm + browser use capabilities), `hermes/skills/blockwise-ad-classifier/SKILL.md` (classification schema)

---

### Implementation Roadmap

| Phase | Duration | Tasks | Owner |
|-------|----------|-------|-------|
| **P0: Token Verification** | 1 day | Verify `META_AD_LIBRARY_ACCESS_TOKEN` works; test pagination | DevOps |
| **P1: Config Switch** | 1 day | Set `HERMES_META_OFFICIAL_API_ENABLED=true`, `apify_enabled=false` | DevOps |
| **P2: Parallel Validation** | 1 week | Run official API alongside existing config; monitor `ad_fetch_runs` | Engineering |
| **P3: Trigger.dev Task** | 2 days | Create `dailyAdRadarRefreshTask` + `trigger_ad_radar_daily_refresh` RPC | Engineering |
| **P4: Apify Removal** | 2 days | Remove `APIFY_TOKEN`, disable Apify code paths, update docs | Engineering |
| **P5: Optimization** | 3 days | Tune refresh intervals, add fast-lane for active pages, increase API page limits | Engineering |
| **P6: Kimi Integration** | 1 week | Add validation task using Kimi WebBridge for edge cases | Engineering |
| **P7: Monitoring** | Ongoing | Weekly accuracy audit, monthly cost review, quarterly scaling assessment | Operations |

**Acceptance Criteria:**
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes (update or delete Apify-related tests)
- [ ] No `ad_fetch_runs` with `source_provider LIKE 'apify:%'` in last 7 days
- [ ] `v_customer_meta_ad_library_cards` shows ≥95% of previously visible ads
- [ ] Zero new `coverage_defects` with `reason='ad_collector_capture_failed'` for 7 days
- [ ] Daily Trigger.dev task completes successfully for 7 consecutive days
- [ ] Monthly cost reduced by ~$25 (Apify line item removed)

---

### Sources

1. `hermes/tools/research-runtime/bin/supabase-supervisor.mjs` — Main supervisor loop, capture orchestration, job handling, watchdogs, circuit breakers, ingestion logic. Lines 1-6192.
2. `hermes/tools/research-runtime/src/config.ts` — Environment schema, model routing, OpenRouter config. Lines 1-90.
3. `hermes/tools/research-runtime/src/supervisor.ts` — TypeScript supervisor types and queue plan generation. Lines 1-112.
4. `hermes/tools/research-runtime/src/worker.ts` — Queue worker abstraction with claim/complete/handler pattern. Lines 1-28.
5. `hermes/tools/research-runtime/src/types.ts` — Zod schemas for all job payloads and research job kinds. Lines 1-124.
6. `hermes/tools/research-runtime/src/openrouter.ts` — OpenRouter client implementation. Lines 1-70.
7. `hermes/tools/meta-library-capture/src/index.ts` — Meta capture tool factory (disabled-by-default). Lines 1-38.
8. `hermes/tools/meta-library-capture/src/clients.ts` — HttpJsonMetaCaptureClient and DisabledMetaCaptureClient. Lines 1-135.
9. `hermes/tools/meta-library-capture/src/normalise.ts` — Ad payload normalisation from Meta HTML/API responses. Lines 1-191.
10. `hermes/tools/meta-library-capture/src/types.ts` — MetaAdLibraryAd schema and capture input types. Lines 1-59.
11. `hermes/tools/research-runtime/bin/apify-capture.mjs` — Apify actor capture, budget guard, circuit breaker, schema mapping. Lines 1-1117.
12. `hermes/tools/research-runtime/bin/content-engine.mjs` — Content run orchestration (separate from ad collection). Lines 1-590.
13. `supabase/migrations/202606030000_research_work_queue_functions.sql` — Queue claim RPC, watchdog functions. Lines 1-380.
14. `supabase/migrations/20260621061000_research_drain_work_queue_indexes.sql` — Performance indexes for queue draining. Lines 1-7.
15. `supabase/migrations/202606120001_archive_stale_blocked_work_queue.sql` — Archived status for blocked jobs. Lines 1-11.
16. `trigger.config.ts` — Trigger.dev v3 configuration. Lines 1-20.
17. `trigger/ad-radar-accuracy.ts` — Existing weekly accuracy audit task. Lines 1-21.
18. `trigger/provider-sync.ts` — Existing provider sync scheduled task. Lines 1-67.
19. `infra/coolify/docker-compose.research.yml` — Docker Compose with Steel, Hermes, and Uptime Kuma. Lines 1-156.
20. `hermes/skills/blockwise-ad-collector/SKILL.md` — Ad collector skill contract. Lines 1-74.
21. `hermes/skills/blockwise-ad-classifier/SKILL.md` — Ad classifier skill contract with classification schema. Lines 1-73.
22. `hermes/skills/blockwise-agent-census/SKILL.md` — Agent census skill contract. Lines 1-50.
23. `hermes/skills/blockwise-page-resolver/SKILL.md` — Page resolver skill contract. Lines 1-50.
24. `hermes/README.md` — Hermes runtime rules, skill registry, deployment notes. Lines 1-54.
25. External: Meta Ad Library API documentation — Rate limits, pagination, token requirements. Retrieved via search.
26. External: Trigger.dev v3 scheduled tasks documentation — `schedules.task`, cron patterns, timezone support. Retrieved via search.
27. External: Supabase queue system patterns — `pgmq`, `FOR UPDATE SKIP LOCKED`, custom table queues. Retrieved via search.
28. External: Kimi for Work AI agent documentation — Agent swarm, browser use, enterprise governance. Retrieved via search.
