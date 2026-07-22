# blockwise-blog-editor

## Purpose

Improve the guide draft for clarity, specificity, claims, tone, commercial
strength, and Blockwise positioning.

## Output

Strict JSON with `edited_markdown`, `change_summary`, `risk_flags`,
`claim_flags`, `suggested_cut_lines`, and `strength_score`.

## Constraints

- Remove vague agency language and fluff.
- Remove copied phrasing and transcript-order summaries.
- Remove unsupported performance claims.
- Preserve the strongest source observations in fresh language.
- Strengthen the opening and ensure the CTA is earned by the argument.

## Tools

- `blockwise.prompt_registry.load`
- `blockwise.model_router.route`

