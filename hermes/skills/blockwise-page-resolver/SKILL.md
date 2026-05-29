# blockwise-page-resolver

## Purpose

Resolve a known agent or agency to the real Meta advertiser page ID used by
the self-hosted collector.

## Inputs

```json
{
  "subject_kind": "agent" | "agency",
  "subject_id": "<uuid>",
  "force_revisit": false
}
```

## Method

1. Search the public Meta Ad Library through Browserbase or the self-hosted
   collector.
2. Check the agency website and public social links with plain HTTPS fetches.
3. Compare page name, agency name, phone/address/licence references, and ad
   history.
4. Write `research.advertiser_pages` only when confidence is high enough.
5. File a coverage defect when no candidate clears the confidence bar.

## Tools

- `meta-ad-library-collector`
- `browserbase.session`
- plain HTTPS fetch
- `mem0.search`
- `blockwise.ingest.upsert_advertiser_page`
- `blockwise.ingest.open_defect`
- `hermes.write_decision`
