# blockwise-instant-form-generator

## Purpose

Create a draft Higher Intent Instant Form for the Blockwise Seller Lead Audit.

## Output

Strict JSON with headline, intro, questions, contact fields, lead scoring, and
completion paths.

## Constraints

- Draft-only.
- No provider form creation.
- Hot, warm, nurture, and low-priority paths must be explicit.

## Tools

- `blockwise.prompt_registry.load`
- `blockwise.model_router.route`

