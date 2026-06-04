# blockwise-operator-chat

**Status:** stub — to be implemented in Phase 9 once the operator console
is wired.

## Purpose

Natural-language interface from Blockwise `/operator` over the
`research.v_*` curated views. Lets you (the operator) ask things like:

- "show me everyone in 6020 running ads this week"
- "what are the top hooks in Cottesloe right now"
- "did we lose anyone on Acton's roster this month"
- "find ads similar to this one"

## Inputs

```json
{
  "query": "show me ads similar to ad_creative <uuid>",
  "operator_session_id": "<uuid>",
  "view_scope": ["v_active_ads_by_postcode", "v_recent_creative_patterns"]
}
```

## Outputs

- A streaming response back to `/operator`.
- One `research.agent_decisions` row of type `operator_chat` per query,
  capturing what views were queried and what answer was given.

## Constraints

- This skill reads from `research.v_*` views ONLY. It cannot write to
  any research.* table, nor can it bypass the views to query raw
  research.* tables.
- It can call the embedding service to find "similar" creatives once
  pgvector is enabled (Phase 8+).
- It cannot trigger paid actions or Browserbase sessions
  without operator confirmation in the chat.

## Tools

- `supabase.query` — read-only against `research.v_*`
- `pgvector.similarity_search` — once embeddings are wired
- `hermes.write_decision` — log the chat turn
