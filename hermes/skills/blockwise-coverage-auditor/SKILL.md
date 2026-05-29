# blockwise-coverage-auditor

## Purpose

Audit postcode coverage so missing competitors become visible defects rather
than silent zero-ad results.

## Inputs

```json
{
  "postcode": "6008",
  "state": "WA",
  "method": "sampled_manual_browse"
}
```

## Method

1. Use the self-hosted collector for known advertiser pages in the postcode.
2. Use Browserbase/manual browsing for a small independent Meta Ad Library
   sample.
3. Compare known agents/pages against collected ads.
4. File `research.coverage_defects` for unresolved pages, stale checks,
   suspicious zero-ad results, or visible ads missing from our database.

Provider failure is never absence. Login walls, blocks, and timeouts leave the
coverage status unknown/stale.

## Tools

- `meta-ad-library-collector`
- `browserbase.session`
- `supabase.query`
- `blockwise.ingest.open_audit`
- `blockwise.ingest.open_defect`
- `hermes.write_decision`
