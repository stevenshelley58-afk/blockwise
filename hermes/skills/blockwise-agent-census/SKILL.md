# blockwise-agent-census

## Purpose

Discover real-estate agencies and agents for a postcode and reconcile them into
`research.agencies`, `research.agents`, and `research.agent_service_areas`.

## Inputs

```json
{
  "postcode": "6008",
  "state": "WA",
  "max_age_days": 7,
  "force_refresh": false
}
```

## Sources

- REIWA public suburb pages and embedded structured data.
- WA licence/register sources.
- Public agency/team pages.
- Domain/REA public profiles where needed for corroboration.

Use plain HTTPS fetches first. Use Browserbase only when a public source needs
browser rendering. Do not use paid ad-collection providers for the census.

## Output Rules

- Source evidence is mandatory.
- Failed fetches do not downgrade existing rows.
- Licensed verification requires at least two corroborating sources including a
  register source.
- Ambiguous matches create coverage defects rather than forced merges.

## Tools

- plain HTTPS fetch
- `browserbase.session`
- `mem0.search`
- `hermes.write_decision`
- `blockwise.ingest.upsert_agency`
- `blockwise.ingest.upsert_agent`
- `blockwise.ingest.open_defect`
