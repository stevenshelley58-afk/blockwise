# blockwise-ad-collector

## Purpose

Scan Meta Ad Library by Page ID and ingest ads, media, creatives and search
documents. `research.advertiser_pages.page_id` is the entire acquisition
spine: agent/agency records are optional metadata and never gate a scan.
The collector never discovers agencies or pages by location.

## Input

```json
{
  "advertiserPageId": "<research.advertiser_pages.id>",
  "metaPageId": "<Meta page id>",
  "scanMode": "initial_fill | refresh | manual",
  "country": "AU",
  "activeStatus": "all",
  "resultsLimit": 250
}
```

`advertiserPageId` + `metaPageId` are the only required fields. A scan runs
when a real Page row exists with `scan_enabled = true`. Resolver decisions
and real-estate gates are descriptive metadata only: pass them if available,
never require them.

## Capture Config

Capture providers, in configured order (ScrapingBee primary when enabled):

```bash
HERMES_SCRAPINGBEE_ENABLED=true
HERMES_SCRAPINGBEE_API_KEY=<key>
HERMES_SCRAPINGBEE_ORDER=primary            # primary|fallback
HERMES_SCRAPINGBEE_MAX_CREDITS_PER_CAPTURE=25
HERMES_SCRAPINGBEE_MONTHLY_CREDIT_CAP=1000
HERMES_META_CAPTURE_ENDPOINT=<operator-configured-resolved-page-capture-endpoint>
HERMES_META_CAPTURE_TIMEOUT_MS=30000
HERMES_META_CAPTURE_RESULTS_LIMIT=250
```

ScrapingBee rules: Auto-Mode (`mode=auto`) capped at
`HERMES_SCRAPINGBEE_MAX_CREDITS_PER_CAPTURE`; retry only genuinely blocked
pages (403/429/challenge) once on the stealth tier; never use ScrapingBee AI
extraction; never proxy media bytes through ScrapingBee. When remaining
credits fall below the monthly cap the capture fails closed
(`scrapingbee_credit_cap_reached`).

## Method

1. Validate the input with `hermes/tools/research-runtime`.
2. Refuse any request whose `advertiserPageId` does not resolve to a real
   `research.advertiser_pages` row (blocked: `collector_unknown_advertiser_page`)
   or whose `scan_enabled` is false.
3. Stamp `last_scan_started_at` / `scan_state=scanning`, create the
   `ad_fetch_runs` row (scan_mode + idempotency key) and call the capture
   provider for the exact Meta page id.
4. Store raw evidence and write observed ads, snapshots, creatives and media
   through the ingestion API. Zero-ad confirmations are valid observations.
5. Finalize the run with coverage flags (`coverage_complete`,
   `pagination_exhausted`, `stop_reason`, Spb-cost/Spb-request-id telemetry),
   then reconcile lifecycle via `rpc/mark_missing_ads_inactive` — only
   coverage-complete runs may flip ads inactive or reactivate them.
6. Schedule the next scan from page state (24h active / 72h historical /
   7d no ads / exponential backoff on failure) via
   `research.schedule_page_after_scan` semantics; queue
   `blockwise-ad-classifier` for each new or updated creative.

## Output Rules

- Failed or partial runs never change ad lifecycle state.
- A zero-item successful run is absence only if the provider explicitly
  confirms no results for the page (and prior observations are trusted).
- Never create agencies, agents, or advertiser pages from collector output.

## Forbidden

- Inputs containing postcode, suburb, state, radius, search terms, or location
  selectors.
- Meta Ad Library sweeps that ingest every advertiser visible in an area.
- Forged tokens, account evasion, or treating login walls as no ads.

## Tools

- `hermes/tools/research-runtime`
- `hermes/tools/meta-library-capture`
- `blockwise.ingest.record_ad_fetch_run`
- `blockwise.ingest.upsert_observed_ad`
- `blockwise.ingest.upsert_ad_creative`
- `blockwise.ingest.open_defect`
- `hermes.write_decision`
