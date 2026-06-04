# blockwise-agent-census

## Purpose

Own the verified real-estate roster for a single postcode. This is the only
skill allowed to set or request `research.agencies.is_real_estate = true`.

## Input

```json
{
  "postcode": "6008",
  "state": "WA",
  "maxAgeDays": 7,
  "forceRefresh": false
}
```

## Sources

- WA licence/register sources.
- REIWA public suburb pages and embedded structured data.
- Public agency websites and team pages.
- Domain/REA public profiles where needed for corroboration.

Use plain HTTPS first. Use Browserbase only when a public source needs browser
rendering. Do not use Meta Ad Library providers for roster discovery.

## Output Rules

- Write agencies, agents, service areas, source documents, and decisions through
  the signed ingestion API.
- Mark an agency real-estate verified only when evidence clears the keep bar:
  licence-register match, confirmed agency listing, or equivalent public
  real-estate proof.
- Every verified agency or agent needs an `agent_decisions` row with rationale,
  confidence, evidence URLs, and `source_documents.id` values.
- Failed fetches do not downgrade existing rows.
- Ambiguous names or duplicate candidates create coverage defects instead of
  forced merges.
- Queue `blockwise-page-resolver` only for verified roster subjects.

## Forbidden

- Creating `Discovered <state>` placeholder agencies.
- Searching Meta Ad Library by postcode, suburb, state, radius, or broad query
  to create agencies or pages.
- Setting `is_real_estate = true` without source evidence and a decision row.

## Tools

- `hermes/tools/research-runtime`
- plain HTTPS fetch
- `browserbase.session`
- `mem0.search`
- `blockwise.ingest.upsert_agency`
- `blockwise.ingest.upsert_agent`
- `blockwise.ingest.open_defect`
- `hermes.write_decision`
