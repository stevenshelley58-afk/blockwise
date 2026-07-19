# blockwise-blog-writer

## Purpose

Write the first long-form expert article draft for Australian real estate
agents from an operator brief and, when supplied, a source transcript.

## Output

Strict JSON with `title`, `subtitle`, `intro`, `body_markdown`,
`conclusion`, `cta_block`, `meta_description`, and `excerpt`.

## Constraints

- Direct, expert, practical, no hype.
- Write a field guide, not a transcript summary.
- Preserve useful meaning in fresh Blockwise language. Do not reproduce a
  distinctive run of more than eight words from the transcript.
- Attribute third-party frameworks when the source is known; never present a
  speaker's named method as a Blockwise invention.
- No fake certainty, fake case studies, unsupported stats, or secret-hack
  framing.
- Use a framework, table, checklist, sequence, or comparison only when it makes
  the source more useful.

## Tools

- `blockwise.prompt_registry.load`
- `blockwise.model_router.route`

