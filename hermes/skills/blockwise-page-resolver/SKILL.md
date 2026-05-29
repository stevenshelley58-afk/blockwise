# blockwise-page-resolver

**Status:** stub — to be implemented in Phase 6.

## Purpose

For an agent or agency that we know exists, find their real Meta Business
Page (Facebook Page ID + Instagram account, where applicable).

This is the second SLA-critical skill. If we resolve the wrong page, we
collect ads from the wrong account — looks like accurate data, is wrong.

## Inputs

```json
{
  "subject_kind": "agent" | "agency",
  "subject_id": "<uuid>",
  "force_revisit": false
}
```

## Outputs

- `research.advertiser_pages` — upsert by `(platform, page_id)`.
- `research.agent_decisions` — one `page_resolution` decision per attempt
  with confidence + rationale + evidence URLs.
- `research.coverage_defects` — when no candidate clears the confidence bar.

## Algorithm sketch

1. Query Meta Ad Library search UI for the agent/agency name (via
   browserbase or scrapling).
2. Visit the agency website; look for OG/Twitter/social meta tags pointing
   to Facebook/Instagram.
3. For each candidate Page:
   - Compare Page name to known agent/agency name (normalized).
   - Look for the agent's licence number, address, or phone on the Page's
     About section.
   - Check whether the Page has run real-estate ads recently.
4. Score candidates 0–100. Take the highest if >=80. Else open a defect.

## Confidence floor

- **>= 80** → status='resolved'.
- **60–79** → status='needs_review'. Operator must confirm via /operator.
- **< 60** → open `coverage_defect`. Do NOT write `advertiser_pages`.

## Disambiguation cases

- Multiple Pages for the same agency (e.g. "Acton Cottesloe" vs
  "Acton Belmont"): each gets its own row keyed on `page_id`.
- A franchise Page that doesn't belong to a specific agent: tie to
  `agency_id` only; leave `agent_id` null.
- A personal Page for a principal that's actually run by the agency:
  tie to both `agent_id` and `agency_id`.

## Tools

- `browserbase.session` — for the Meta Ad Library search (their stealth
  is better than ours for this surface).
- `scrapling.fetcher` — for the agency website OG tag lookup.
- `mem0.search` — prior resolutions for similar names.
- `blockwise.ingest.upsert_advertiser_page`
- `blockwise.ingest.open_defect`
- `hermes.write_decision`
