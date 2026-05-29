# blockwise-defect-investigator

**Status:** stub — to be implemented in Phase 7.

## Purpose

Operator-triggered. Picks up an open `coverage_defect` and figures out
what went wrong: was it a missing agent, an unresolved page, a wrong
provider response, or a real Meta-side change?

## Inputs

```json
{
  "coverage_defect_id": "<uuid>"
}
```

## Outputs

- Updates the defect's `status` to `investigating` while running, then
  `resolved` or `dismissed` when finished.
- Writes the resolution into `coverage_defects.resolution` (jsonb) AND
  `coverage_defects.resolution_decision_id` (the agent_decision row).
- If the root cause is a missing agent/agency, also calls
  `blockwise-agent-census` for that postcode.
- If the root cause is a wrong page resolution, supersedes the bad
  decision via `agent_decisions.superseded_by` and triggers
  `blockwise-page-resolver` for the subject.

## Investigation flow

1. Read the defect; capture context (postcode, agent_name, evidence_url).
2. Replay the failing path:
   - If the defect names an agency that isn't in `research.agencies`,
     hand off to `blockwise-agent-census`.
   - If it names an advertiser_page we don't have, hand off to
     `blockwise-page-resolver`.
   - If we have the page but didn't have the ad it mentions, replay
     the most recent `ad_fetch_runs` for that page. Inspect raw payload.
3. Decide:
   - **Genuine gap** (we never knew): resolved, with the entity now linked.
   - **Collector blind spot** (the self-hosted collector missed it; we see
     it on Meta UI): mark collector quality issue in `result_summary`;
     queue a skill improvement for `blockwise-ad-collector`; resolved with notes.
   - **Stale data** (ad just ended; we hadn't noticed): not a defect; dismissed.
   - **Mis-reported by customer**: dismissed with notes.

## Tools

- `browserbase.session` — to manually browse Meta Ad Library for proof
- `supabase.query` — read fetch run history, raw payloads
- `blockwise.ingest.update_defect`
- `blockwise.ingest.skill_handoff` (calls another skill in this directory)
- `hermes.write_decision`
