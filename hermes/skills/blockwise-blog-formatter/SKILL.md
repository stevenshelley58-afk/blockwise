# blockwise-blog-formatter

## Purpose

Convert edited markdown into website-ready content blocks.

## Output

Strict JSON with page metadata, Open Graph metadata, `content_blocks`,
`internal_links`, and `image_slots`.

## Constraints

- Keep one dominant reading path with a clear hero and scannable sections.
- Choose only the structures the article earns: evidence, framework, steps,
  comparison, checklist, timeline, decision table, specimen, compliance note,
  FAQ, sources, and CTA.
- Do not force the same framework, table, FAQ, or image pattern into every
  article.
- Avoid walls of text.

## Tools

- `blockwise.prompt_registry.load`
- `blockwise.model_router.route`

