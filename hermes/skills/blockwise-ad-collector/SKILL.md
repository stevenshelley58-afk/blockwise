# blockwise-ad-collector

## Purpose

Collect Meta Ad Library ads only for resolved, real-estate-gated advertiser
pages. The collector never discovers agencies or pages by location.

## Input

```json
{
  "advertiserPageId": "<research.advertiser_pages.id>",
  "metaPageId": "<Meta page id>",
  "resolverDecisionId": "<agent_decisions.id>",
  "realEstateGate": {
    "verified": true,
    "verifiedBySkill": "blockwise-agent-census",
    "decisionId": "<agent_decisions.id>",
    "sourceDocumentIds": ["<source_documents.id>"]
  },
  "country": "AU",
  "activeStatus": "active",
  "resultsLimit": 250
}
```

## Capture Config

The capture tool is disabled by default in the hard-reset runtime. Operators
must explicitly configure a Hermes-owned adapter before live capture:

```bash
HERMES_META_CAPTURE_PROVIDER=disabled
HERMES_META_CAPTURE_ENDPOINT=<operator-configured-resolved-page-capture-endpoint>
HERMES_META_CAPTURE_TIMEOUT_MS=30000
HERMES_META_CAPTURE_RESULTS_LIMIT=250
```

Do not use legacy worker-specific collector or hosted-provider environment
variables in the active reset runtime.

## Method

1. Validate the input with `hermes/tools/research-runtime`.
2. Refuse any request that lacks a census real-estate gate or resolver decision.
3. Call `hermes/tools/meta-library-capture` for the exact resolved Meta page id.
4. Store raw evidence and write observed ads, snapshots, and creatives through
   the ingestion API.
5. Queue `blockwise-ad-classifier` for each new or updated creative.

## Output Rules

- Failed provider runs mark the fetch failed and may open a coverage defect.
- A zero-item successful run is absence only if the provider explicitly confirms
  no results for the resolved page.
- Hosted providers that do not confirm absence must not mark ads inactive.
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
