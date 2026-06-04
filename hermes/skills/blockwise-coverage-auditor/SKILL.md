# blockwise-coverage-auditor

## Purpose

Audit postcode coverage so missing competitors become visible defects rather
than silent zero-ad results.

## Input

```json
{
  "postcode": "6008",
  "state": "WA",
  "method": "resolved_roster_sample",
  "sampleSize": 5
}
```

## Method

1. Read verified census roster entries and resolved advertiser pages for the
   postcode.
2. Sample known pages and recent fetch runs for stale or suspicious results.
3. Use Browserbase/manual Meta Ad Library browsing only as an independent
   audit signal.
4. Compare what is visible publicly with the verified roster and collected ads.
5. File `research.coverage_defects` for missing agents, unresolved pages,
   stale checks, provider failures, or visible ads missing from our database.

## Output Rules

- The auditor writes audit records and defects only.
- Public browsing results must not create agencies, advertiser pages, observed
  ads, snapshots, or creatives.
- If browsing finds a real competitor missing from the roster, queue
  `blockwise-agent-census`.
- If browsing finds a likely page for a known roster subject, queue
  `blockwise-page-resolver`.
- Provider failure is never absence. Login walls, blocks, and timeouts leave the
  coverage status unknown or stale.

## Tools

- `hermes/tools/research-runtime`
- `browserbase.session`
- scoped read-only research queries
- `blockwise.ingest.open_audit`
- `blockwise.ingest.open_defect`
- `blockwise.ingest.skill_handoff`
- `hermes.write_decision`
