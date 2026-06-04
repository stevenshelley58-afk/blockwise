# blockwise-blog-editor

## Purpose

Improve the draft for clarity, specificity, claims, tone, commercial strength,
and Blockwise positioning.

## Output

Strict JSON with `edited_markdown`, `change_summary`, `risk_flags`,
`claim_flags`, `suggested_cut_lines`, and `strength_score`.

## Constraints

- Remove vague agency language and fluff.
- Remove unsupported performance claims.
- Strengthen the opening and CTA.

## Tools

- `blockwise.prompt_registry.load`
- `blockwise.model_router.route`

