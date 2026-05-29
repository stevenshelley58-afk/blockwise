# blockwise-agent-census

**Status:** stub — to be implemented in Phase 6 (post-VPS deployment).

## Purpose

Discover every real-estate agency and agent operating in a given Australian
postcode and reconcile them into `research.agencies` and `research.agents`.

This is the upstream of everything else. If we miss an agent here, we will
never check their Meta page and we will never collect their ads. So this
skill's recall (false-negative rate) is the SLA that matters most for the
"can't miss agents" promise.

## Inputs

```json
{
  "postcode": "6008",
  "state": "WA",
  "max_age_days": 7,
  "force_refresh": false
}
```

## Outputs

Writes rows to:

- `research.source_documents` — the raw HTML/JSON of each register, REIWA
  page, Domain agent page, etc.
- `research.agencies` — upsert by `(normalized_name, state)`.
- `research.agents` — upsert by `(normalized_name, agency_id)`.
- `research.agent_service_areas` — postcode coverage rows with
  `match_type='office_postcode' | 'agent_profile_listing'`.
- `research.agent_decisions` — one decision per agent/agency the skill
  added or modified, including a confidence score and the
  `source_documents.id` cites.
- `research.coverage_defects` — when the skill spots an agent it can't
  resolve (no website, no licence number, ambiguous name).

## Sources crawled

1. **WA Real-Estate Licence Register** (Department of Energy, Mines,
   Industry Regulation and Safety) — authoritative, licensed agents only.
2. **REIWA member directory** — agencies + agents.
3. **Domain.com.au /find-agent** — public agent profiles by suburb.
4. **realestate.com.au /find-agent** — same.
5. **Google Business Profile (Maps)** — confirms a physical office exists.
6. **Agency website /our-team pages** — discovered via the agency's
   site, parsed for full names + photo URLs.

For non-WA states in Phase 2, swap (1) for the relevant register
(NSW Fair Trading, CAV Victoria, OFT QLD, etc.).

## Confidence scoring

```
licensed_verified           = 95  (licence reg confirms name + agency)
market_seen_unverified      = 60  (Domain/REA agent profile, no licence match)
licensed_unresolved         = 30  (licence number found, but agency unclear)
single_source_only          = 20  (one source, low corroboration)
```

The skill MUST NOT mark an agent `licensed_verified` from a single source.
At least two corroborating sources are required, with one of them being
the WA licence register.

## Tools the skill uses

- `scrapling.stealthy_fetcher` — for the licence reg + REIWA + Domain + REA
- `mem0.search` — "have we seen this name in this postcode before?"
- `hermes.write_decision` — append to research.agent_decisions
- `blockwise.ingest.upsert_agency` — calls the ingestion worker
- `blockwise.ingest.upsert_agent` — calls the ingestion worker
- `blockwise.ingest.open_defect` — calls the ingestion worker for unresolved cases

## Cadence

- **Scheduled:** weekly per postcode, off-peak hours.
- **On demand:** operator triggers from `/operator` for one postcode.
- **Driven by:** `research.refresh_policies.priority`.

## Failure modes the skill must handle

| Symptom                                  | Required behaviour                                                    |
| ---------------------------------------- | --------------------------------------------------------------------- |
| Licence register is unreachable          | Mark run `failed`; do NOT downgrade existing agents to `inactive`     |
| One agent appears twice with different names | Open a `coverage_defect` with reporter='auditor', do NOT auto-merge |
| Two REIWA records have the same licence #  | Treat as a single agent; record alternative names in metadata        |
| New agency with no licence number        | Set status=`market_seen_unverified`, confidence<=40                  |
