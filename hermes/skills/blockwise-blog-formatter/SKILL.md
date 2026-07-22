# blockwise-blog-formatter

## Purpose

Convert an edited field guide into website-ready content blocks.

## Output

Strict JSON with page metadata, Open Graph metadata, `content_blocks`,
`internal_links`, and `image_slots`.

## Constraints

- Keep one dominant reading path with a clear opening and scannable sections.
- Choose only the structures the guide earns: evidence, framework, steps,
  comparison, checklist, timeline, decision table, specimen, compliance note,
  FAQ, sources, and CTA.
- Do not force the same framework, table, FAQ, or image pattern into every
  guide.
- Avoid walls of text.

## Tools

- `blockwise.prompt_registry.load`
- `blockwise.model_router.route`

