# blockwise-page-resolver

## Purpose

Resolve a census-verified agent or agency to the real Meta advertiser page used
for collection.

## Input

```json
{
  "subjectKind": "agent",
  "subjectId": "<uuid>",
  "censusDecisionId": "<agent_decisions.id>",
  "sourceDocumentIds": ["<source_documents.id>"],
  "forceRevisit": false
}
```

## Method

1. Load the verified roster subject and the census evidence.
2. Check the agency website, official social links, business address, phone,
   licence references, and public profile pages.
3. Search by known brand, website, or social URL only. Do not search Meta by
   postcode, suburb, state, radius, or unrelated advertiser queries.
4. Compare candidates by page name, agency name, address, phone, website,
   licence evidence, and recent ad history.
5. Write `research.advertiser_pages` only when confidence clears the resolver
   bar and the linked agency remains real-estate verified.
6. Queue `blockwise-ad-collector` with the resolver decision and real-estate
   gate.

## Output Rules

- Every resolved page needs source evidence and a resolver decision.
- Low-confidence candidates create coverage defects rather than displayable
  advertiser pages.
- Superseded page decisions must point at the replacement decision.
- A resolved page must preserve its agent or agency relationship; do not create
  orphan advertiser pages.

## Tools

- `hermes/tools/research-runtime`
- `hermes/tools/meta-library-capture` for resolved-page verification only
- self-hosted browser session (Steel CDP, local Chromium fallback)
- plain HTTPS fetch
- `mem0.search`
- `blockwise.ingest.upsert_advertiser_page`
- `blockwise.ingest.open_defect`
- `hermes.write_decision`
