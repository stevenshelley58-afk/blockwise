# Research Engine Operator Runbook

Date: 2026-06-04

This runbook reflects the hard-reset runtime. Commands are for the operator on
the target host; this cleanup agent did not run them.

## Normal State

Expected active containers:

1. `blockwise-hermes`
2. `blockwise-uptime-kuma`

Unexpected active containers:

1. `research-orchestrator`
2. `meta-ad-library-collector`

## Daily Checks

1. Confirm Hermes is healthy.
2. Confirm uptime monitor is healthy.
3. Review failed research runs or defects.
4. Confirm no legacy worker containers are running.
5. Confirm no broad location sweep has produced displayable ads.
6. Review `/operator/research` failed jobs and retry only bounded page-first jobs.
7. Check the latest official API validation result before assuming Meta API
   coverage is useful for AU real-estate ads.

## Official Meta API Validation

The official Ad Library API is a validation source first, not the committed
primary ingestion source. Run the spike with an operator session and a configured
`META_AD_LIBRARY_ACCESS_TOKEN` or `META_AD_LIBRARY_TOKEN`:

```bash
curl -X POST "$BLOCKWISE_URL/api/operator/research/meta-api-validation" \
  -H "Content-Type: application/json" \
  -d '{"country":"AU","adType":"HOUSING_ADS","searchTerms":["real estate appraisal"],"limit":20}'
```

Treat `usefulForAuRealEstate=false` as fail-closed. Keep Hermes page-first
public-library capture for resolved advertiser pages until validation shows
useful Australian real-estate coverage.

## Failed Collection

When collection fails:

1. Record the failure reason.
2. Do not mark ads inactive from that run.
3. File or update a coverage defect.
4. Retry only within the configured budget.
5. Escalate repeated login walls or checkpoints to manual review.

Operator endpoints:

```bash
# List failed or blocked queue items.
curl "$BLOCKWISE_URL/api/operator/research/jobs?status=failed"

# Inspect one queue item and its ingest events.
curl "$BLOCKWISE_URL/api/operator/research/jobs/$WORK_QUEUE_ID"

# Retry a failed or blocked queue item.
curl -X POST "$BLOCKWISE_URL/api/operator/research/jobs/$WORK_QUEUE_ID/retry"

# Inspect raw fetch-run snapshots and source-document metadata.
curl "$BLOCKWISE_URL/api/operator/research/runs/$AD_FETCH_RUN_ID/raw"
```

Do not retry jobs that repeatedly hit login walls, checkpoints, CAPTCHAs, or
provider access controls. Mark those for manual review instead.

## Media Dedupe

Hermes stores captured creative media in `research-ad-creatives` and records a
global SHA-256 content hash in `research.media_blobs`. Repeated assets reuse the
existing object path and update `research.media_assets.content_hash`.

If media capture fails:

1. Inspect the media collector queue item.
2. Check `last_error` on `research.media_assets`.
3. Retry the media job only when the source URL is still public and accessible.
4. Keep thumbnail-only video records when the video file is not publicly
   downloadable.

## Swipe File and Ad Studio Handoff

Customer users can save research ads from `/research`, review them at
`/research/swipe-file`, and send a saved ad as an Ad Studio inspiration payload.
Saved ads live in `public.research_saved_ads` with workspace RLS.

The handoff marks `handoff_status=sent_to_adstudio` and stores the payload in
`handoff_payload`. It does not mutate the original research observation.

## Bad Records

Operators can archive a bad ad from `/operator/research`. This updates
`research.ad_creatives.display_state` and records an `ingest_events` audit row.
It does not delete observations, snapshots, creative versions, or media blobs.

## Rebuilding Coverage

Use build mode only for bounded rebuilds:

1. Set `HERMES_RESEARCH_MODE=build`.
2. Keep `BLOCKWISE_RESEARCH_RUNTIME_ENABLED=false` until the operator is ready.
3. Run census for a specific state, postcode, or agency set.
4. Resolve pages for verified entities.
5. Collect only from resolved verified pages.
6. Return to `HERMES_RESEARCH_MODE=maintain`.

## Emergency Stop

Operator-only sequence:

```bash
cd /opt/blockwise
docker compose -f infra/coolify/docker-compose.research.yml stop hermes
```

Do not stop or alter database services from this runbook.

## Rollback Boundary

Rollback to legacy workers is not automatic. If rollback is required, use the
archive manifest, reintroduce services explicitly, and validate all old
environment variables in a separate change.
