# blockwise-operator-chat

**Status:** live operator research chat. The `/operator/research` console calls
the shipped chat route and records a decision row for each answered query.

## Purpose

Natural-language interface from Blockwise `/operator/research` over curated
research summaries and safe `research.v_*` views. Lets you (the operator) ask
things like:

- "show me everyone in 6020 running ads this week"
- "what are the top hooks in Cottesloe right now"
- "did we lose anyone on Acton's roster this month"
- "find ads similar to this one"
- "where do we have useful coverage for seller lead ads"

## Inputs

```json
{
  "query": "show me ads similar to ad_creative <uuid>",
  "operator_session_id": "<uuid>",
  "view_scope": ["v_active_ads_by_postcode", "v_recent_creative_patterns"],
  "coverage": [{ "postcode": "6020", "suburb": "Carine", "active_ads": 12 }]
}
```

## Outputs

- A JSON chat response back to `/operator/research`.
- One `research.agent_decisions` row of type `operator_chat` per query,
  capturing what views were queried and what answer was given.

## Constraints

- This skill reads from safe research summaries and `research.v_*` views only.
  It cannot write to any `research.*` table, nor can it bypass the views to
  query raw research tables.
- Similar-creative answers must use the shipped research data available to the
  route. Do not promise vector search unless embeddings are actually available.
- It cannot trigger paid actions or browser-rendered sessions without operator
  confirmation in the chat.

## Tools

- `supabase.query` - read-only against safe research views and summaries
- `hermes.write_decision` - log the chat turn
