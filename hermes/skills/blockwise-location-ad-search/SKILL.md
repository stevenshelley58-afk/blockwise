# blockwise-location-ad-search

## Purpose

Run explicit, operator-enabled Meta Ad Library location searches for public
postcode or suburb scans. This skill is separate from page collection: it may
verify advertiser pages discovered in a public search only when the payload
carries the location-search gate.

## Input

```json
{
  "postcode": "6163",
  "state": "WA",
  "suburb": "Spearwood",
  "query": "Spearwood real estate",
  "country": "AU",
  "activeStatus": "all",
  "resultsLimit": 250,
  "location_search_allowed": true,
  "realEstateGate": {
    "verified": true,
    "verifiedBySkill": "blockwise-location-ad-search",
    "verifiedAt": "<iso timestamp>"
  }
}
```

## Method

1. Validate the input with `hermes/tools/research-runtime`.
2. Refuse any job without `location_search_allowed: true` and a verified
   `blockwise-location-ad-search` gate.
3. Search the public Meta Ad Library for the exact postcode or suburb query.
4. Keep only ads with visible location evidence and real-estate signals.
5. Upsert advertiser pages and observed ads through the ingestion API.
6. Queue media and classifier follow-up jobs for accepted creatives.

## Output Rules

- Provider failures open coverage defects; they are not treated as zero ads.
- Non-location or non-real-estate results are filtered and recorded in the run
  summary, not ingested as customer-visible ads.
- Verified advertiser pages cite source evidence and the exact search query.
- Page-first collection remains owned by `blockwise-ad-collector`.

## Forbidden

- Running unless `HERMES_LOCATION_AD_SEARCH_ENABLED` allows it.
- Creating advertiser pages from broad or ambiguous searches.
- Marking advertiser pages real-estate verified without visible evidence.
- Replacing `blockwise-page-resolver` or resolved-page collection.

## Tools

- `hermes/tools/research-runtime`
- `hermes/tools/meta-library-capture`
- `blockwise.ingest.record_ad_fetch_run`
- `blockwise.ingest.upsert_advertiser_page`
- `blockwise.ingest.upsert_observed_ad`
- `blockwise.ingest.open_defect`
- `hermes.write_decision`
