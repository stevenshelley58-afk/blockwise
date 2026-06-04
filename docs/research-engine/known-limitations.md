# Research Engine Known Limitations

Date: 2026-06-04

## Meta Coverage

The main risk is data coverage, not normalization. The official Meta Ad Library
API validation endpoint exists to test AU real-estate and `HOUSING_ADS`
coverage before any API-only ingestion commitment.

If validation returns no useful AU real-estate samples, keep ingestion on the
existing page-first public-library capture path for resolved advertiser pages.

## Public Capture

Blockwise captures only publicly visible Meta Ad Library data. The runtime must
not bypass login walls, CAPTCHAs, checkpoints, access controls, account
restrictions, or private data boundaries.

Collection remains page-first. Broad postcode, suburb, radius, or ad-first
discovery is intentionally out of scope for active ad collection.

## Video Media

Some public ads expose only a thumbnail or snapshot URL. In that case Blockwise
stores the thumbnail and source URL rather than treating the record as failed.

## Source Provider Names

Hermes writes normalized source providers:

1. `structured_meta_page_provider` for the hosted HTTP JSON capture path.
2. `hermes_meta_page_capture` for the public browser capture path.

The legacy runtime labels `http_json` and `hermes_browser` should not be used
for new rows.

## Saved Swipe Handoff

The saved swipe file stores an Ad Studio inspiration payload, but it does not
automatically create or overwrite a campaign. Campaign creation remains an
explicit Ad Studio action.
