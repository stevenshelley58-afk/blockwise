# Hermes Research Engine — Runbook

The research engine is the system that builds and maintains a database of
every Australian real-estate advertiser, agent, and ad, and makes it
searchable from inside Blockwise.

This document is the source of truth for what the engine is, how data
flows, and what to do when something breaks. If anything in here drifts
from the code, fix the code or fix the doc — never both at once.

---

## Product SLA

Two promises:

1. **Coverage.** If a real-estate agent in our covered geography is
   running active Meta ads, we know about them within the cadence
   configured for their postcode.
2. **Accuracy.** Every ad in our database is traceable to the provider
   run that surfaced it, the raw payload we received, and the
   point-in-time we observed it.

When either promise breaks, the failure is **loud** — coverage defects
get filed, alerts fire, and the operator console reflects "stale" or
"needs work" status. We never silently report zero ads.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│ Blockwise (Next.js on Vercel)                                      │
│  ├─ /operator       control panel (you only)                       │
│  ├─ /research       customer search UI (rebuilds Phase 9)          │
│  └─ /api/research/* server-side ingestion + control routes         │
│                                                                    │
│  Reads from research.v_*    Writes via service-role only           │
└────────────┬───────────────────────────────────────────────────────┘
             │
             │ HTTPS + signed                Supabase service role
             ▼                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ Supabase Postgres                                                  │
│  schema: research.*                                                │
│    agencies, agents, agent_service_areas, advertiser_pages,        │
│    source_documents, ad_fetch_runs, observed_ads, ad_snapshots,    │
│    ad_creatives, ad_area_matches, coverage_audits,                 │
│    coverage_defects, refresh_policies, agent_decisions,            │
│    ingest_events                                                   │
│  views: research.v_* (the only thing Blockwise reads)              │
│  storage: research-raw-evidence, research-ad-creatives,            │
│           research-screenshots                                     │
└────────────▲───────────────────────────────────────────────────────┘
             │
             │ ingest worker writes
             │
┌────────────┴───────────────────────────────────────────────────────┐
│ VPS (Hostinger + Coolify, behind Cloudflare Access)                │
│                                                                    │
│  Hermes Agent (24/7)                                               │
│   ├─ blockwise-agent-census         weekly per postcode            │
│   ├─ blockwise-page-resolver        on demand                      │
│   ├─ blockwise-apify-orchestrator   every 5 min, picks due pages   │
│   ├─ blockwise-ad-classifier        triggered by new creatives     │
│   ├─ blockwise-coverage-auditor     weekly                         │
│   ├─ blockwise-defect-investigator  triggered by /operator         │
│   └─ blockwise-operator-chat        NL queries over views          │
│                                                                    │
│  Scrapling worker          self-hosted browser (verifier + Hermes) │
│  AionUi (optional)         visual cockpit                          │
│  Uptime Kuma               monitoring                              │
└────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
            Apify (Meta Ad Library actor)
            Browserbase (managed browser fallback)
            mem0 (fuzzy memory layer)
```

---

## The eight integrity rules

These are baked into the schema, the ingestion core, and the skill specs.
None of them are optional.

1. **Provenance.** Every `observed_ads` row links back through
   `ad_snapshots → ad_fetch_runs → source_documents` to a raw payload
   sitting in Supabase Storage. We can always show what we saw.

2. **Idempotency.** `observed_ads` is unique on
   `(advertiser_page_id, external_ad_id)`. Re-ingesting the same payload
   upserts; it never duplicates. `ad_snapshots` is unique on
   `(observed_ad_id, payload_hash)` so unchanged ads do not produce new
   snapshot rows.

3. **Absence confirmation.** An ad flips to `active_status='inactive'`
   only when `missing_successive_checks >= 2`. One bad fetch never silently
   removes an ad. The threshold is configurable per call site for
   defensive testing.

4. **Provider failure is loud.** `ad_fetch_runs` with `status='failed'`
   write NO observations and trigger NO absence increments. The postcode's
   coverage status becomes `stale`/`refresh_overdue`, surfaced in
   `research.v_coverage_status`.

5. **Append-only history.** `ad_snapshots` rows are never updated or
   deleted. Every change to an ad's payload writes a new row. Storage
   cost is bounded by the hash-uniqueness rule.

6. **Configurable cadence.** `research.refresh_policies` is the only
   source of truth for how often each postcode is re-checked. The operator
   console writes to this table; Hermes reads it.

7. **Agent decisions are first-class.** Hermes' page resolutions, agent
   matches, defect investigations, and classifications are all stored
   in `research.agent_decisions` with rationale, confidence, evidence,
   model, and cost. `mem0` runs alongside for fuzzy recall but is NOT
   the system of record.

8. **Service-role writes only.** RLS is restrictive by default. The
   ingestion worker writes via service role. Blockwise customers read
   through `research.v_*` views, which is the stable contract between
   the engine and the app.

---

## Data flow: one ad observation

```
Apify actor                              research.observed_ads
   │
   ▼
ad_fetch_runs (running)
   │                                          ┌─ if payload_hash matches,
   ▼                                          │  no new snapshot, last_seen
source_documents (raw JSON in bucket)         │  + last_checked advance
   │                                          │
   ▼                                          ▼
normaliseApifyAd  ───── ObservedAdIngestInput ──── applyObservation
   │                                          │
   ▼                                          ├─ if no row exists, insert
ingest worker                                 │  + insert snapshot + creative
 POST /api/research/ingest/observation         │  + ingest_event 'insert'
   │                                          │
   ▼                                          ├─ if payload differs, update
research.observed_ads + ad_snapshots +        │  + insert snapshot + diff
ad_creatives + ad_area_matches                │  + ingest_event 'update'
   │                                          │
   ▼                                          ▼
ad_fetch_runs.status='success'         applyAbsence (only on success)
   │                                          │
   ▼                                          ▼
research.v_active_ads_by_postcode      research.observed_ads
                                       missing_successive_checks ++
                                       and inactive when >= 2
```

---

## Where things live

| Concern                            | Location                                                              |
| ---------------------------------- | --------------------------------------------------------------------- |
| Schema migrations                  | `supabase/migrations/202605280002_*.sql`, `_research_engine.sql`, etc. |
| Zod schemas                        | `src/lib/research/schemas/`                                           |
| Canonical hashing / normalisation  | `src/lib/research/hash.ts`, `src/lib/research/normalise.ts`           |
| Pure ingestion core                | `src/lib/research/ingest.ts`                                          |
| In-memory test writer              | `tests/research-engine/in-memory-writer.ts`                           |
| Phase 1 unit tests                 | `tests/research-engine/*.test.ts`                                     |
| Hermes skill specs                 | `hermes/skills/*/SKILL.md`                                            |
| Customer-facing research page      | `src/app/(customer)/research/page.tsx` (stubbed until Phase 9)        |
| Stubbed reader for old `/research` | `listResearchSignals` in `src/lib/product/live-data.ts`               |
| Env vars for this engine           | `.env.example` (`APIFY_API_TOKEN`, `HERMES_*`, `MEM0_*`, etc.)        |

---

## Provider plan

**Primary (v1):** Apify. Cheapest credible Meta Ad Library scraping.
$0.65–$1.50 per 1,000 ads. WA daily refresh is ~$400/month all-in.

**Verifier (v1):** Scrapling on the same VPS. Samples 10–20% of priority
postcodes daily and cross-checks Apify. Discrepancies open coverage
defects. Marginal cost ~$0.

**Fallback browser (v1):** Browserbase, used by skills when Scrapling
gets blocked or for high-stakes one-offs. Pay-per-session.

**Historical depth (Phase 2):** Metapi.io. Adds 2+ years of historical
including removed ads for the "generate new ideas from existing ads"
surface.

**Self-hosted heavy scraping:** revisited only when Apify spend would
exceed ~$15k/month.

---

## Refresh cadence

Operator-editable, per postcode, via `research.refresh_policies`. v1
defaults seeded in the schema migration:

- Subiaco (6008) — priority 1, every 12h (demo postcode)
- Other Perth metro postcodes — priority 2, daily
- Everything else — added by operator as scope expands

The orchestrator skill runs every 5 minutes and picks up whichever
advertiser pages are due, scoped to their postcode's policy.

---

## What's done in Phase 1

- `research.*` schema migration (`202605280003_research_engine.sql`)
- Legacy rip migration (`202605280002_research_drop_legacy.sql`)
- Curated `v_*` views migration (`202605280004_research_views.sql`)
- All zod schemas
- Canonical hashing + Apify normaliser
- Pure ingestion core with full integrity rule enforcement
- In-memory writer + deterministic test harness
  (idempotency, change-detection, absence-confirmation,
  cross-page counter independence, outcome summarisation)
- Hermes skill stubs (7 skills, each with SKILL.md)
- Env scaffolding in `.env.example`

## What's next

- **Phase 2** — pick Apify actor(s), test pull, sign up, paste API token.
- **Phase 3** — Hostinger VPS + Coolify + Cloudflare Access bootstrap.
- **Phase 4** — Hermes deployed with first skills loaded.
- **Phase 5** — orchestrator runs against first WA postcode end-to-end.

See the parent chat for the full 10-phase plan and the
[credential shopping list](#).

---

## Common failures and what to do

### "A postcode shows zero ads but the customer says agents are running ads"

1. Check `research.v_coverage_status.health` for that postcode. If it
   says `refresh_overdue` or `audit_overdue`, the cadence stopped firing.
2. If health is `healthy` but ads are still zero, check
   `research.ad_fetch_runs` for that postcode's pages. Failed runs?
3. If runs succeeded and we still see zero, open a defect — this is
   exactly what `blockwise-defect-investigator` is for.

### "Hermes seems to have made a bad page-resolution decision"

Find the decision in `research.agent_decisions WHERE decision_type =
'page_resolution'`. Override by inserting a new decision row with
`superseded_by = <prev id>` and update the `advertiser_pages` row
accordingly (or trigger `blockwise-page-resolver` with `force_revisit`).

### "Apify spend spiked"

Look at `research.ad_fetch_runs.cost_usd` sum for the last 24h grouped
by `target_value`. The orchestrator's cost guards should have triggered;
if they didn't, that's a bug to fix in the skill.

### "I want to add a new postcode"

Insert into `research.refresh_policies`. The operator console will have
a button for this in Phase 9; until then, do it manually via SQL.

### "I want to demote a postcode to manual-only"

Set `active=false` on its `refresh_policies` row, or set `priority=5`.

---

## Glossary

- **observed_ad** — our canonical record of one ad. Identified by
  `(advertiser_page_id, external_ad_id)`.
- **snapshot** — point-in-time copy of an observed_ad's payload.
- **creative** — the headline/body/image/video/cta extracted from an ad.
- **ad_fetch_run** — one call to a provider; the audit log of "did we
  ask, did it work."
- **source_document** — a raw payload we fetched, stored in Supabase
  Storage with a content hash.
- **agent_decision** — a Hermes decision row. Why we did what we did,
  with evidence and cost.
- **coverage_defect** — a known gap. Opened by auditor or operator,
  closed by investigator.
- **refresh policy** — per-postcode cadence config.
