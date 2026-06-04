# Hermes Research Engine — Fix All Gaps + National Postcode Expansion

You are working on the Blockwise codebase. Your job is to fix 16 identified gaps in the Hermes ad research pipeline and expand it to cover every postcode in Australia. **You must use multiple subagents working in parallel.** Read `CLAUDE.md` and `hermes/README.md` before starting.

## Architecture recap (read this before touching anything)

Hermes is a Node.js daemon (`hermes/tools/research-runtime/bin/supabase-supervisor.mjs`) running on a VPS via Docker/Coolify. It polls a Supabase `research.work_queue` table every 60s and processes jobs in a 5-stage pipeline:

1. **blockwise-agent-census** — scrapes REIWA to find real-estate agents/agencies per postcode, writes to `research.agencies`, `research.agents`, `research.agent_service_areas`, `research.agent_decisions`
2. **blockwise-page-resolver** — finds the Meta/Facebook page ID for a verified agency/agent
3. **blockwise-ad-collector** — fetches ads from Meta Ad Library for a resolved page ID
4. **blockwise-media-collector** — downloads ad images/videos to Supabase Storage
5. **blockwise-ad-classifier** — classifies each creative as a real-estate ad type

The file `hermes/data/au-postcodes.json` now contains all 2,845 Australian postcodes (extracted from the Australia Post official file, March 2026). Each entry: `{ postcode, state, suburbs[] }`.

## SSH access — connect to VPS first

Before any deployment or env var verification, SSH into the VPS:

```bash
# Get SSH details from .env or ask the operator — key is typically at ~/.ssh/id_rsa or ~/.ssh/blockwise
# The VPS runs Coolify with Docker. Hermes container is named something like hermes-research or blockwise-hermes
ssh <VPS_USER>@<VPS_HOST>

# Once connected, check the running container and its env:
docker ps | grep hermes
docker exec <container_name> env | grep HERMES
docker logs <container_name> --tail 100

# Verify the current capture provider is actually set (not disabled):
docker exec <container_name> env | grep HERMES_META_CAPTURE_PROVIDER
```

Check `.env`, `infra/hermes/hermes.toml`, `infra/coolify/docker-compose.research.yml`, and `infra/hermes/Dockerfile` for the actual SSH host, user, and key path. If not found, check `docs/research-engine/hermes-vps-deployment.md`.

---

## Spawn these subagents IN PARALLEL

Launch all 6 agents simultaneously. Each is fully independent.

---

### AGENT 1 — Fix: `missing_successive_checks` never increments + ad inactivity logic

**File to edit:** `hermes/tools/research-runtime/bin/supabase-supervisor.mjs`

**The bug:** `handleAdCollector` upserts only the ads it *sees* in the current run. Ads that disappear from Meta results are never marked inactive — `missing_successive_checks` is never incremented. The schema says an ad only goes inactive after 2 consecutive missed checks, but that counter stays at 0 forever.

**Fix required:**

After ingesting all ads from a capture run (inside `handleAdCollector`, after the `for (const ad of outcome.items)` loop), add a reconciliation step:

1. Query `research.observed_ads` for all rows where `advertiser_page_id = payload.advertiserPageId AND active_status = 'active'`
2. Build a Set of `external_ad_id` values from the current run's `outcome.items`
3. For every previously-active ad NOT in the current run's results:
   - PATCH `research.observed_ads` to increment `missing_successive_checks = missing_successive_checks + 1`
   - If `missing_successive_checks >= 2`: also set `active_status = 'inactive'`, `ad_delivery_stopped_at = now()`
4. For every ad that IS in the current run: reset `missing_successive_checks = 0` (it's still active)

This must only run when `outcome.status === 'SUCCEEDED'` and `outcome.metadata?.confirmed_absence !== true` — do not penalise ads during a provider failure.

Also update `last_checked_at = now()` on `advertiser_pages` only on successful runs (it currently does this, verify it's correct).

---

### AGENT 2 — Fix: 50-ad cap + no pagination

**File to edit:** `hermes/tools/research-runtime/bin/supabase-supervisor.mjs`

**The bug:** `resultsLimit` is hardcoded at 50 in `enqueueCollectorForPage`. There is no pagination. Agencies with 50+ ads silently lose the rest.

**Fix required:**

1. Increase the default `resultsLimit` to 250 (the max the schema allows — see `metaCaptureInputSchema`).

2. Add a new env var `HERMES_META_CAPTURE_RESULTS_LIMIT` (default 250, max 250) read at startup alongside the other env vars.

3. After a successful collect run, check: if `outcome.itemCount >= resultsLimit`, log a warning and open a coverage defect:
```js
await insertCoverageDefect({
  platform: 'facebook',
  notes: `Ad collector hit resultsLimit (${resultsLimit}) for page ${payload.metaPageId} — there may be more ads. Consider paginated collection.`,
  reported_by: 'system',
  reporter_identity: workerId,
  status: 'open',
  resolution: { advertiser_page_id: payload.advertiserPageId, meta_page_id: payload.metaPageId, item_count: outcome.itemCount, results_limit: resultsLimit },
  resolved_advertiser_page_id: payload.advertiserPageId,
});
```

4. In `captureInput()`, use `HERMES_META_CAPTURE_RESULTS_LIMIT` env value instead of hardcoded 50.

---

### AGENT 3 — Fix: Unresolved pages never retried + refresh policy not bumped on census failure

**File to edit:** `hermes/tools/research-runtime/bin/supabase-supervisor.mjs`

**Bug A — Unresolved pages:** When a page resolver finds a Facebook link but can't get a numeric page ID, it writes `status: 'verified_real_estate_unresolved'` and stops forever. No retry, no escalation.

**Fix A:**
Add a new watchdog function `watchdog_requeue_unresolved_pages` (alongside the existing watchdogs in `runWatchdogs()`):

```js
async function watchdogRequeueUnresolvedPages() {
  // Find advertiser_pages where status='verified_real_estate_unresolved'
  // AND no pending/claimed page-resolver job exists for that subject
  // AND last_seen_at (or updated_at) was more than 24 hours ago
  // Re-enqueue blockwise-page-resolver for those subjects
  const stale = await rest(
    'research',
    `advertiser_pages?select=id,agent_id,agency_id,resolution_decision_id&status=eq.verified_real_estate_unresolved&last_seen_at=lt.${encode(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())}&limit=20`
  );
  let requeued = 0;
  for (const page of stale) {
    const subjectKind = page.agent_id ? 'agent' : 'agency';
    const subjectId = page.agent_id || page.agency_id;
    if (!subjectId) continue;
    const dedupeKey = `page-resolver:${subjectKind}:${subjectId}`;
    const existing = await rest('research', `work_queue?select=id&dedupe_key=eq.${encode(dedupeKey)}&status=in.(pending,claimed)&limit=1`);
    if (existing.length) continue;
    await rest('research', 'work_queue', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: json({
        queue_name: 'research',
        job_type: 'blockwise-page-resolver',
        dedupe_key: dedupeKey,
        priority: 25,
        payload: {
          subjectKind,
          subjectId,
          censusDecisionId: page.resolution_decision_id,
          sourceDocumentIds: [],
          forceRevisit: true,
          location_search_allowed: false,
        },
        status: 'pending',
        max_attempts: 3,
      }),
    });
    requeued++;
  }
  return requeued;
}
```

Call it in `runWatchdogs()` alongside the existing watchdogs.

**Bug B — Refresh policy not bumped on census failure:**
In `handleAgentCensus`, the `refresh_policies` PATCH that bumps `next_refresh_at` only runs inside the `if (found.length)` branch. If the census finds nothing (REIWA down, zero results), the policy isn't updated and the same postcode gets re-queued every tick.

Fix: Move the `refresh_policies` PATCH outside the `if (found.length)` block so it always runs, but use a shorter interval on failure:

```js
const nextRefreshMs = found.length > 0 ? 12 * 60 * 60 * 1000 : 60 * 60 * 1000; // 12h success, 1h failure
await rest('research', `refresh_policies?postcode=eq.${encode(payload.postcode)}&state=eq.${encode(payload.state || 'WA')}`, {
  method: 'PATCH',
  body: json({
    last_refreshed_at: now(),
    next_refresh_at: new Date(Date.now() + nextRefreshMs).toISOString(),
  }),
});
```

---

### AGENT 4 — Fix: Media CDN expiry + classifier uses correct display_state

**File to edit:** `hermes/tools/research-runtime/bin/supabase-supervisor.mjs`

**Bug A — Media CDN expiry:** Meta CDN URLs for ad images/videos expire within hours. If a `media_assets` row is in `capture_status='pending'` or `capture_status='failed'` and the source URL is now dead, the asset is permanently unrecoverable. There's no mechanism to go back to the source ad and get a fresh URL.

**Fix A:**
In `handleMediaCollector`, after `captureMediaAsset` throws for an asset, check whether the failure looks like a dead URL (4xx response). If so, attempt to fetch a fresh URL from the `observed_ads.raw_payload` before giving up:

```js
async function getFreshMediaUrl(asset) {
  // Load the observed_ad raw_payload for this creative
  const rows = await rest('research', `ad_creatives?select=observed_ad_id&id=eq.${asset.ad_creative_id}&limit=1`);
  if (!rows?.[0]?.observed_ad_id) return null;
  const ads = await rest('research', `observed_ads?select=raw_payload&id=eq.${rows[0].observed_ad_id}&limit=1`);
  const raw = ads?.[0]?.raw_payload;
  if (!raw) return null;
  // Re-extract media URLs from the stored raw payload using the same normalisation logic
  const ad = normaliseHostedMetaAd(raw, '');
  const creative = creativeFromMetaAd(ad);
  const allUrls = [...creative.image_urls, creative.video_url, creative.video_thumbnail_url].filter(Boolean);
  // Return first URL that matches the asset kind
  return allUrls.find(url => url && url !== asset.source_url) || null;
}
```

In the catch block inside `handleMediaCollector`:
```js
} catch (error) {
  // If URL looks dead (4xx), try getting a fresh URL from raw_payload
  if (/failed 4\d\d|404|403|410/i.test(error.message)) {
    const freshUrl = await getFreshMediaUrl(asset).catch(() => null);
    if (freshUrl) {
      await patchMediaAsset(asset.id, { source_url: freshUrl, capture_status: 'pending', last_error: `URL refreshed from raw payload: ${error.message}` });
      // Don't count as failed — it'll be retried next run
      continue;
    }
  }
  await patchMediaAsset(asset.id, { capture_status: 'failed', last_error: error.message });
  failed++;
}
```

**Bug B — Classifier: text-only ads should be displayable without media:**
Currently `displayState` is `'hidden'` if `requiresMedia && !mediaReady`. But `format='unknown'` ads (text-only) have `requiresMedia=true` which incorrectly hides them.

Fix in `handleAdClassifier`:
```js
const requiresMedia = ['image', 'video', 'carousel'].includes(creative.format);
// Unknown format = likely text-only, treat as not requiring media
```

This is already correct — verify the condition is exactly `['image', 'video', 'carousel']` and not accidentally including `'unknown'`.

---

### AGENT 5 — Fix: National postcode expansion + census source expansion

**Files to edit:**
- `hermes/tools/research-runtime/bin/supabase-supervisor.mjs`
- `hermes/data/au-postcodes.json` (already exists — do not modify, read it)
- New migration file in `supabase/migrations/`

**Context:** `hermes/data/au-postcodes.json` contains all 2,845 Australian postcodes with their suburbs and states, extracted from the official Australia Post file (March 2026).

The current system:
- Hardcodes 25 Perth metro postcodes in `DEFAULT_POSTCODES`
- Only uses REIWA as a census source (WA only)
- Has no `refresh_policies` rows for non-WA postcodes

**Fix 1 — Remove the hardcoded postcode list:**

Replace the `DEFAULT_POSTCODES` constant and the `POSTCODE_ROSTER_SOURCES` hardcoded map in the supervisor with a dynamic loader:

```js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Path relative to bin/ → ../../data/au-postcodes.json
const AU_POSTCODES = JSON.parse(
  readFileSync(join(__dirname, '../../data/au-postcodes.json'), 'utf8')
);

// Build postcode → suburbs lookup
const POSTCODE_SUBURB_MAP = new Map(
  AU_POSTCODES.map(entry => [entry.postcode, entry])
);
```

Update `reiwaRosterSources(payload)` to use `POSTCODE_SUBURB_MAP` instead of the hardcoded `POSTCODE_ROSTER_SOURCES`:

```js
function reiwaRosterSources(payload) {
  const entry = POSTCODE_SUBURB_MAP.get(payload.postcode);
  if (!entry || entry.state !== 'WA') return [];
  return entry.suburbs
    .filter(suburb => suburb && !suburb.includes('GPO') && !suburb.includes('DC') && !suburb.includes('MC'))
    .slice(0, 3)  // max 3 suburbs per postcode
    .map(suburb => ({
      source: 'reiwa_agent_finder',
      suburb: toTitleCase(suburb),
      url: `https://reiwa.com.au/real-estate-agents/${slugify(suburb)}/`,
    }));
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function toTitleCase(name) {
  return name.split(/\s+/).map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
}
```

**Fix 2 — Add census sources for non-WA states:**

Create a `CENSUS_SOURCES_BY_STATE` config that maps state → URL template generators. Start with what's publicly accessible:

```js
const CENSUS_SOURCES_BY_STATE = {
  WA: (postcode, suburbs) => suburbs.map(suburb => ({
    source: 'reiwa_agent_finder',
    suburb,
    url: `https://reiwa.com.au/real-estate-agents/${slugify(suburb)}/`,
  })),
  NSW: (postcode, suburbs) => suburbs.slice(0, 2).map(suburb => ({
    source: 'domain_suburb_agents',
    suburb,
    url: `https://www.domain.com.au/real-estate-agents/${slugify(suburb)}-nsw-${postcode}/`,
  })),
  VIC: (postcode, suburbs) => suburbs.slice(0, 2).map(suburb => ({
    source: 'domain_suburb_agents',
    suburb,
    url: `https://www.domain.com.au/real-estate-agents/${slugify(suburb)}-vic-${postcode}/`,
  })),
  QLD: (postcode, suburbs) => suburbs.slice(0, 2).map(suburb => ({
    source: 'domain_suburb_agents',
    suburb,
    url: `https://www.domain.com.au/real-estate-agents/${slugify(suburb)}-qld-${postcode}/`,
  })),
  SA: (postcode, suburbs) => suburbs.slice(0, 2).map(suburb => ({
    source: 'domain_suburb_agents',
    suburb,
    url: `https://www.domain.com.au/real-estate-agents/${slugify(suburb)}-sa-${postcode}/`,
  })),
  TAS: (postcode, suburbs) => suburbs.slice(0, 2).map(suburb => ({
    source: 'domain_suburb_agents',
    suburb,
    url: `https://www.domain.com.au/real-estate-agents/${slugify(suburb)}-tas-${postcode}/`,
  })),
  ACT: (postcode, suburbs) => suburbs.slice(0, 2).map(suburb => ({
    source: 'domain_suburb_agents',
    suburb,
    url: `https://www.domain.com.au/real-estate-agents/${slugify(suburb)}-act-${postcode}/`,
  })),
  NT: (postcode, suburbs) => suburbs.slice(0, 2).map(suburb => ({
    source: 'domain_suburb_agents',
    suburb,
    url: `https://www.domain.com.au/real-estate-agents/${slugify(suburb)}-nt-${postcode}/`,
  })),
};
```

Update `reiwaRosterSources()` → rename to `rosterSourcesForPostcode(payload)` and use `CENSUS_SOURCES_BY_STATE`:

```js
function rosterSourcesForPostcode(payload) {
  const entry = POSTCODE_SUBURB_MAP.get(payload.postcode);
  if (!entry) return [];
  const state = entry.state;
  const suburbs = entry.suburbs
    .filter(s => !s.includes('GPO') && !s.includes('DC') && !s.includes('MC') && !s.includes('PO'))
    .slice(0, 3)
    .map(toTitleCase);
  const fn = CENSUS_SOURCES_BY_STATE[state];
  return fn ? fn(payload.postcode, suburbs) : [];
}
```

Also update `agencyFromHtml()` to parse Domain's agent listing JSON-LD (it uses `@type: "RealEstateAgent"` or `@type: "LocalBusiness"`).

**Fix 3 — Seed `refresh_policies` for ALL Australian postcodes:**

Write a new Supabase migration `supabase/migrations/202606020001_seed_national_postcodes.sql`:

```sql
-- Seed refresh_policies for all Australian postcodes
-- WA postcodes: priority 1 (already running, keep high)
-- Other states: priority 5 (lower priority, phased rollout)
-- All seeded with next_refresh_at = now() so they're eligible immediately
-- but actual cadence is controlled by priority ordering

INSERT INTO research.refresh_policies (postcode, state, active, priority, refresh_cadence_minutes, next_refresh_at)
SELECT
  postcode,
  state,
  true AS active,
  CASE state
    WHEN 'WA' THEN 1
    WHEN 'NSW' THEN 2
    WHEN 'VIC' THEN 2
    WHEN 'QLD' THEN 3
    WHEN 'SA' THEN 3
    WHEN 'TAS' THEN 4
    WHEN 'ACT' THEN 4
    WHEN 'NT' THEN 5
    ELSE 5
  END AS priority,
  CASE state
    WHEN 'WA' THEN 720    -- 12h
    WHEN 'NSW' THEN 1440  -- 24h
    WHEN 'VIC' THEN 1440
    WHEN 'QLD' THEN 2880  -- 48h
    WHEN 'SA' THEN 2880
    ELSE 4320             -- 72h
  END AS refresh_cadence_minutes,
  now() AS next_refresh_at
FROM (VALUES
```

Then generate the VALUES list programmatically from `hermes/data/au-postcodes.json`. Write a script `scripts/generate-postcode-migration.mjs` that reads the JSON and writes the SQL VALUES rows. Run it and include the output in the migration file. After inserting, add:

```sql
ON CONFLICT (postcode, state) DO UPDATE SET
  active = true,
  priority = LEAST(research.refresh_policies.priority, EXCLUDED.priority);
```

**Fix 4 — Update DEFAULT_POSTCODES:**

Replace the hardcoded `DEFAULT_POSTCODES` fallback with all WA postcodes from `au-postcodes.json` (filter `state === 'WA'`). This is the `HERMES_RESEARCH_TARGET_POSTCODES` default.

The operator can override via env to run a specific state:
- `HERMES_RESEARCH_TARGET_POSTCODES=` (empty) = all postcodes from au-postcodes.json
- `HERMES_RESEARCH_TARGET_STATE=WA` = filter by state (new env var)

Add `HERMES_RESEARCH_TARGET_STATE` env var support in the config loader.

---

### AGENT 6 — Fix: Coverage auditor jobs, ingest_events schema gaps, stale verified agencies

**Files to edit:** `hermes/tools/research-runtime/bin/supabase-supervisor.mjs`, new migration

**Bug A — `blockwise-coverage-auditor` and `blockwise-defect-investigator` return "unsupported_job_type":**

Both are defined in `researchJobKinds` but `handleJob()` just returns `unsupported_job_type`. Implement minimal handlers:

```js
async function handleCoverageAuditor(job) {
  // For each postcode in target list, check:
  // 1. Does it have any verified agencies? (research.agencies where primary_postcode=X and is_real_estate=true)
  // 2. Does it have any active ads? (research.observed_ads via advertiser_pages)
  // 3. When was it last checked?
  // Write a research.coverage_audits row with the results
  const postcode = job.payload?.postcode;
  const state = job.payload?.state || 'WA';
  
  const [agencies, activeAds, lastRun] = await Promise.all([
    rest('research', `agencies?select=id&primary_postcode=eq.${encode(postcode)}&is_real_estate=eq.true&limit=100`),
    rest('research', `observed_ads?select=id&active_status=eq.active&advertiser_page_id=in.(${
      /* subquery not possible via REST — use RPC or join via advertiser_pages */
      'select_via_rpc'
    })&limit=1`),
    rest('research', `build_runs?select=completed_at&status=eq.complete&order=completed_at.desc&limit=1`),
  ]);
  
  await rest('research', 'coverage_audits', {
    method: 'POST',
    body: json({
      postcode,
      state,
      verified_agency_count: agencies.length,
      active_ad_count: 0, // simplified — extend later
      audit_status: agencies.length > 0 ? 'covered' : 'uncovered',
      audited_at: now(),
      notes: `Hermes coverage audit: ${agencies.length} verified agencies found.`,
    }),
  });
  
  return { status: 'complete', result: { handler: 'blockwise-coverage-auditor', postcode, verified_agencies: agencies.length } };
}

async function handleDefectInvestigator(job) {
  // Load the defect, check if it's still valid, attempt auto-resolution
  const defectId = job.payload?.defect_id;
  if (!defectId) return { status: 'blocked', blocked_reason: 'missing_defect_id', result: {} };
  
  const defects = await rest('research', `coverage_defects?select=*&id=eq.${defectId}&limit=1`);
  const defect = defects?.[0];
  if (!defect) return { status: 'blocked', blocked_reason: 'defect_not_found', result: {} };
  
  // If defect is already resolved, mark job complete
  if (defect.status === 'resolved') {
    return { status: 'complete', result: { handler: 'blockwise-defect-investigator', defect_id: defectId, already_resolved: true } };
  }
  
  // Otherwise log the investigation attempt and leave for human review
  await rest('research', `coverage_defects?id=eq.${defectId}`, {
    method: 'PATCH',
    body: json({ notes: (defect.notes || '') + `\nHermes investigator checked at ${now()} — no auto-resolution available, needs human review.` }),
  });
  
  return { status: 'complete', result: { handler: 'blockwise-defect-investigator', defect_id: defectId, outcome: 'needs_human_review' } };
}
```

Add both to `handleJob()`:
```js
if (job.job_type === 'blockwise-coverage-auditor') return handleCoverageAuditor(job);
if (job.job_type === 'blockwise-defect-investigator') return handleDefectInvestigator(job);
```

**Bug B — `ingest_events` silently drops fields:**

The try/catch in `recordEvent` strips `work_queue_id`, `agent_decision_id`, `source_document_id` etc. when it hits a schema mismatch. This breaks the audit trail.

Write a migration to ensure these columns exist:

```sql
-- supabase/migrations/202606020002_ingest_events_columns.sql
ALTER TABLE research.ingest_events
  ADD COLUMN IF NOT EXISTS work_queue_id uuid,
  ADD COLUMN IF NOT EXISTS agent_decision_id uuid,
  ADD COLUMN IF NOT EXISTS source_document_id uuid,
  ADD COLUMN IF NOT EXISTS build_run_id uuid,
  ADD COLUMN IF NOT EXISTS ad_fetch_run_id uuid,
  ADD COLUMN IF NOT EXISTS payload_hash text,
  ADD COLUMN IF NOT EXISTS diff jsonb;
```

After writing this migration, simplify `recordEvent` to remove the try/catch fallback — it should just throw on real errors.

**Bug C — Stale verified agencies:**

Add a new watchdog `watchdog_recheck_stale_agencies` that runs weekly (check: has the agency's `last_seen_at` been more than 30 days ago?). For stale agencies, re-enqueue a census job for their postcode (not a downgrade — just triggers a fresh roster check that will either re-verify or fail to find them).

```js
async function watchdogRecheckStaleAgencies() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const stale = await rest(
    'research',
    `agencies?select=id,primary_postcode,state&is_real_estate=eq.true&last_seen_at=lt.${encode(thirtyDaysAgo)}&limit=50`
  );
  let requeued = 0;
  const seen = new Set();
  for (const agency of stale) {
    const key = `${agency.state}:${agency.primary_postcode}`;
    if (seen.has(key) || !agency.primary_postcode) continue;
    seen.add(key);
    const dedupeKey = `census:${agency.state}:${agency.primary_postcode}`;
    const existing = await rest('research', `work_queue?select=id&dedupe_key=eq.${encode(dedupeKey)}&status=in.(pending,claimed)&limit=1`);
    if (existing.length) continue;
    await rest('research', 'work_queue', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: json({
        queue_name: 'research',
        job_type: 'blockwise-agent-census',
        dedupe_key: dedupeKey,
        priority: 8,
        payload: { postcode: agency.primary_postcode, state: agency.state, verified_roster_first: true, location_search_allowed: false, legacy_discovery_allowed: false, trigger: 'stale_agency_recheck' },
        status: 'pending',
        max_attempts: 3,
      }),
    });
    requeued++;
  }
  return requeued;
}
```

Run this watchdog only once per hour by checking `Date.now() % (60 * 60 * 1000) < intervalMs` inside the tick.

---

## After all agents complete — integration steps

Once all 6 agents are done, do these in order:

1. **Run the migration scripts:**
   ```bash
   node scripts/generate-postcode-migration.mjs  # generates SQL from au-postcodes.json
   npx supabase db push  # or apply via Supabase dashboard
   ```

2. **SSH to VPS and deploy:**
   ```bash
   ssh <VPS_USER>@<VPS_HOST>
   cd /path/to/blockwise
   git pull
   docker compose -f infra/coolify/docker-compose.research.yml up -d --build hermes
   docker logs hermes --tail 50 -f  # watch for errors
   ```

3. **Verify env vars on VPS:**
   ```bash
   docker exec hermes env | grep HERMES_META_CAPTURE_PROVIDER
   # Must NOT be 'disabled'. Should be 'http_json' or 'hermes_browser'
   ```

4. **Run the test suite:**
   ```bash
   npx playwright test e2e/meta-ad-library-card.spec.ts
   ```

5. **Check the operator research dashboard** at `/operator/research` — coverage status should now show all national postcodes.

## Key constraints — do not violate

- `location_search_allowed` must stay `false` in all job payloads
- Never search Meta Ad Library by postcode, suburb, radius, or broad keyword to discover agencies
- Only collect ads for pages that came through the full census → resolver chain
- The `is_real_estate = true` flag may only be set by `blockwise-agent-census`
- All writes use service role key; no direct table access from anon/authenticated roles
- Do not break existing tests in `e2e/`
