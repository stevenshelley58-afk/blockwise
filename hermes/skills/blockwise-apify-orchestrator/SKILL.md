# blockwise-apify-orchestrator

**Status:** stub — first skill to implement in Phase 5. The pure ingestion
core (`src/lib/research/ingest.ts`) and Apify normaliser are already in place
in the Blockwise repo and unit-tested.

## Purpose

The workhorse ad collector. Reads `research.refresh_policies` and
`research.advertiser_pages.last_checked_at` to figure out which pages need
re-checking, calls the configured Apify actor for each, hands the results
to the Blockwise ingestion worker (HTTP, signed), and reconciles the
output.

## Inputs

```json
{
  "scope": "postcode" | "advertiser_page" | "all_due",
  "value": "<postcode or page_id>",
  "actor": "apify/facebook-ads-scraper",
  "dry_run": false
}
```

`scope=all_due` is the default scheduled mode; it picks all advertiser
pages whose `last_checked_at` is older than their postcode's
`refresh_cadence_minutes`.

## Outputs

For each advertiser page in scope:

1. Open an `ad_fetch_runs` row with status='running' via the ingestion
   worker. Hash the input.
2. Call the Apify actor; persist the raw response as a
   `source_documents` row (raw JSON in `research-raw-evidence` bucket).
3. Normalise each ad with `normaliseApifyAd` (already in the repo).
4. For each normalised ad, call `POST /api/research/ingest/observation`
   on the worker. The worker enforces:
   - idempotent upsert keyed on (advertiser_page_id, external_ad_id)
   - append-only snapshot history
   - reset of `missing_successive_checks`
5. After all observations, call
   `POST /api/research/ingest/run-complete` with the list of seen
   external_ad_ids. The worker runs `applyAbsence` to increment the
   counter for ads that were not seen, marking them inactive at >= 2.
6. Close the `ad_fetch_runs` row with status='success' and the
   summary returned by the worker.

## Failure handling

- **Apify returns 4xx/5xx**: do NOT call run-complete. Close the run
  with status='failed' and the error string. NO observed_ads writes.
  NO absence increments. Postcode coverage stays as it was.
- **Apify returns 0 results when prior run returned >0**: treat as
  "suspicious zero." Run a verifier fetch via Scrapling. If verifier
  also returns 0, proceed normally. If verifier returns >0, close the
  Apify run as 'partial' and open a `coverage_defect`.
- **Single normalisation failure**: log a warning to result_summary,
  continue with the rest. Don't fail the whole run.
- **Network timeout to ingestion worker**: retry 3x with exponential
  backoff. If still failing, close the run as 'failed' and DO NOT
  mark any ads inactive.

## Cadence

Driven entirely by `research.refresh_policies`. The orchestrator runs
every 5 minutes and picks up whichever pages are due.

## Cost guards

- Maximum spend per run: $5 (configurable per postcode in policy notes).
- Maximum spend per day across all pages: $50 in v1 (WA scope).
- If spend would exceed, the skill skips low-priority postcodes and
  records a warning, but never silently truncates a high-priority page.

## Tools

- `apify.run_actor`
- `blockwise.ingest.open_fetch_run`
- `blockwise.ingest.close_fetch_run`
- `blockwise.ingest.observation`
- `blockwise.ingest.run_complete`
- `blockwise.ingest.open_defect`
- `scrapling.stealthy_fetcher` — for the verifier path
- `supabase.storage.upload` — for raw payload archival
- `hermes.write_decision`
