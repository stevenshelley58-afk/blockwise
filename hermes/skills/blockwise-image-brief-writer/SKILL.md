# blockwise-image-brief-writer

## Purpose

Create controlled image briefs and prompts for the guide, social, and ad
creative slots.

## Output

Strict JSON with `image_briefs`, including prompt, negative prompt, style
tokens, must-include, must-avoid, aspect ratio, and alt text.

## Constraints

- Premium SaaS look.
- No fake people, fake Meta logos, readable fake UI text, cluttered
  dashboards, or AI slop.

## Tools

- `blockwise.prompt_registry.load`
- `blockwise.model_router.route`

