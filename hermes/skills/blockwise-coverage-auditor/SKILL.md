# blockwise-coverage-auditor

**Status:** stub — to be implemented in Phase 7.

## Purpose

Weekly per-postcode "did we miss anyone" audit. This is what makes the
"if we miss agents you're fucked" SLA defensible — the auditor finds
the gaps before customers do.

## Inputs

```json
{
  "postcode": "6008",
  "state": "WA",
  "method": "sampled_manual_browse" | "license_register_diff" | "provider_cross_check"
}
```

## Outputs

- `research.coverage_audits` — one row per audit per postcode.
- `research.coverage_defects` — one row per agent/ad we know we missed.
- `research.agent_decisions` — one `coverage_audit` decision per audit.

## Methods

### `sampled_manual_browse` (default, weekly)

1. Open Meta Ad Library, filter by Country=Australia and free-text the
   postcode + suburb + "real estate".
2. Take the first 20 advertiser Pages that appear in the result.
3. For each, check whether we have a matching
   `research.advertiser_pages` row.
4. For each unknown Page, open a `coverage_defect` with reporter='auditor'.
5. For each known Page, compare active-ad count we've recorded vs ads
   actually visible. Mismatch > 10% → defect.

### `license_register_diff` (monthly)

1. Pull the latest WA licence register.
2. Diff against `research.agents` where `status='licensed_verified'`.
3. New names → defect (this means the census skill missed them).
4. Names removed from the register → mark our agent `inactive`.

### `provider_cross_check` (ad hoc)

1. For a postcode, run the Apify primary AND Scrapling verifier in the
   same window.
2. Compare the union of ads found.
3. Either side missing >5% of the other's findings → defect.

## Scoring

```
score = 100
  - 5  per known agent missing an advertiser_page
  - 10 per advertiser_page with ad-count discrepancy > 10%
  - 15 per unknown competitor seen in Ad Library
  - 20 per licence-register addition we missed
```

`status='covered'` if score >= 85
`status='watch'`   if 60 <= score < 85
`status='needs_work'` if score < 60

## Tools

- `browserbase.session` — for Ad Library browsing (stealth needed)
- `scrapling.fetcher` — for licence register, REIWA
- `supabase.query` — for our-side counts
- `blockwise.ingest.open_audit`
- `blockwise.ingest.open_defect`
- `hermes.write_decision`
