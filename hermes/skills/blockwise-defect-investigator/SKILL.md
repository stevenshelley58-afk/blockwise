# blockwise-defect-investigator

## Purpose

Operator-triggered investigation for an open coverage defect. It determines
whether the issue belongs to census, page resolution, collection, provider
quality, classification, or stale public data.

## Input

```json
{
  "coverageDefectId": "<research.coverage_defects.id>",
  "operatorDecisionId": "<optional agent_decisions.id>"
}
```

## Investigation Flow

1. Mark the defect `investigating`.
2. Read the defect, linked evidence, roster subject, advertiser page, fetch run,
   and source documents.
3. Replay only the scoped failing path:
   - Missing or unverified agency: queue `blockwise-agent-census`.
   - Known subject without a page: queue `blockwise-page-resolver`.
   - Resolved page with failed or stale fetch: queue `blockwise-ad-collector`.
   - Captured creative with weak labels: queue `blockwise-ad-classifier`.
4. Use Browserbase/manual Meta Ad Library browsing only for evidence capture.
5. Resolve or dismiss the defect with a decision row and source evidence.

## Output Rules

- Update `coverage_defects.status`, `resolution`, and
  `resolution_decision_id` through the ingestion API.
- Supersede bad page-resolution decisions when a replacement is found.
- Do not ingest public browsing samples as ads. Hand off to the owning skill.
- If the collector missed a visible ad on a resolved page, record a provider
  quality issue and queue collector work for that exact page.

## Model Config

If an LLM is needed for evidence summarisation, use OpenRouter through
`hermes/tools/research-runtime`. Model names must come from
`HERMES_DEFAULT_MODEL`, `HERMES_ESCALATION_MODEL`, or
`HERMES_OPENROUTER_MODELS_JSON`.

## Tools

- `hermes/tools/research-runtime`
- `browserbase.session`
- scoped read-only research queries
- `blockwise.ingest.update_defect`
- `blockwise.ingest.skill_handoff`
- `blockwise.ingest.open_defect`
- `hermes.write_decision`
