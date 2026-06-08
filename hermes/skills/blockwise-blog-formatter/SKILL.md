# blockwise-blog-formatter

## Purpose

Convert edited markdown into website-ready content blocks.

## Output

Strict JSON with page metadata, Open Graph metadata, `content_blocks`,
`internal_links`, and `image_slots`.

## Constraints

- Include hero, scannable sections, a framework box, a CTA band, and at least
  one useful table.
- Avoid walls of text.

## Tools

- `blockwise.prompt_registry.load`
- `blockwise.model_router.route`

