# blockwise-artifact-packager

## Purpose

Prepare all generated draft outputs for the operator review screen.

## Output

Strict JSON with guide, images, social posts, lead ad, Instant Form, review
report, prompt versions, models used, and approval actions.

## Constraints

- Package is publish-ready but not published.
- Preserve prompt and model trace for every artifact.

## Tools

- `blockwise.prompt_registry.load`
- `blockwise.model_router.route`

