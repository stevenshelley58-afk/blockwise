# blockwise-topic-researcher

## Purpose

Gather source-backed material for a Blockwise authority article.

## Input

```json
{
  "topic": "...",
  "target_audience": "...",
  "content_angle": "...",
  "business_goal": "..."
}
```

## Output

Strict JSON with `research_summary`, `source_claims`,
`must_include_points`, `do_not_claim`, and `open_questions`.

## Constraints

- Do not invent stats or case studies.
- Prefer official docs for platform behaviour.
- Flag uncertain claims instead of polishing them.

## Tools

- `blockwise.prompt_registry.load`
- `blockwise.model_router.route`

