# blockwise-content-run-orchestrator

## Purpose

Own a draft-only Content-to-Lead run from operator trigger through packaged
review. The orchestrator validates inputs, loads the active prompt set, routes
each step through `blockwise-model-router`, executes skills in order, saves
partial artifacts, and blocks all publishing until operator approval.

## Input

```json
{
  "content_run_id": "<uuid>",
  "from_step": null
}
```

## Output

Updates `content_runs`, `content_artifacts`, `prompt_runs`,
`content_reviews`, and `operator_approvals`.

## Constraints

- Do not write content directly.
- Do not publish guides, social posts, or Meta campaigns.
- Continue only when downstream inputs are available.
- Failed steps must be visible and rerunnable.

## Tools

- `blockwise.content_engine.run`
- `blockwise.prompt_registry.load`
- `blockwise.model_router.route`

