# Research Engine Runbook

The research engine builds the Blockwise real-estate ad database. It discovers
agents/agencies, resolves their Meta pages, collects public Meta Ad Library ads,
stores raw evidence, and exposes searchable `research.v_*` views to the app.

Default ad collector:

```bash
AD_COLLECTOR_PROVIDER=searchapi_meta
SELF_HOSTED_META_COLLECTOR_URL=http://meta-ad-library-collector:9100
SEARCHAPI_API_KEY=<key>
META_AD_LIBRARY_API_TOKEN=<optional-official-meta-token>
META_AD_LIBRARY_COLLECTOR_URL=http://meta-ad-library-collector:9100
AD_COLLECTOR_DAILY_SPEND_LIMIT_USD=0
```

Use `searchapi_meta` as the hosted primary collector when `SEARCHAPI_API_KEY`
is configured. Keep `self_hosted_meta` as a verifier/debug path, not the
primary completeness source.

## VPS Services

- `blockwise-meta-ad-library-collector`: Playwright-based collector exposed only
  on `127.0.0.1:9100` and the private Docker network.
- `blockwise-hermes`: receives the collector URL and has the collector source
  mounted at `/opt/blockwise/meta-ad-library-collector` for inspection/refinement.
- `blockwise-orchestrator`: manual profile only; uses `AD_COLLECTOR_PROVIDER`
  and records the matching `source_provider`.

## Integrity Rules

- Failed provider runs never mean "no ads."
- Login walls, checkpoints, timeouts, and blocked pages are failed runs.
- Raw payloads are stored in `research-raw-evidence`.
- Ads are idempotent on `(advertiser_page_id, external_ad_id)`.
- Absence is applied only after a successful run and still requires repeated
  misses before an ad is marked inactive.
- The app reads through `research.v_*` views only.

## Smoke Tests

```bash
curl -s http://127.0.0.1:9100/health
docker exec blockwise-hermes /usr/bin/python3 \
  /opt/data/skills/blockwise-ad-collector/scripts/collector_client.py health
```

If a status check returns zero after prior ads existed, file a coverage defect
instead of silently treating the page as inactive.
