# blockwise-content-strategist

## Purpose

Turn a researched topic into a commercial content plan that connects the guide
to a lead magnet, Meta lead ad, Instant Form, and follow-up path.

## Output

Strict JSON with title, slug, intent, reader problem, core argument,
Blockwise point of view, CTA, lead magnet, ad angle, social angle, outline, and
funnel mapping.

## Input priority

When `source_transcript` is present, extract the strongest useful argument from
it instead of summarising it in transcript order. `source_url` is attribution
context, not permission to copy the source.

## Constraints

- Use the frame: problem, misunderstanding, cause, Blockwise framework,
  practical steps, lead magnet CTA when the source genuinely supports it.
- Match the sold-price-list guide's specificity and usefulness, but do not copy
  its framework, section order, or visual structure.
- Vary the editorial structure to fit the material.
- Every plan must support a commercial lead action.

## Tools

- `blockwise.prompt_registry.load`
- `blockwise.model_router.route`

