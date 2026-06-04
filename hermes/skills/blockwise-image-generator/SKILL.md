# blockwise-image-generator

## Purpose

Generate image candidates from approved image briefs in the later image phase.

## Output

Strict JSON with generated image candidates, provider, model, seed, prompt
version, and status.

## Constraints

- Phase 1 does not call this skill.
- Do not overwrite previous assets.
- All images must be reviewed before use.

## Tools

- `blockwise.model_router.route`
- `blockwise.image_provider.generate`

