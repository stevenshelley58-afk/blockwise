# blockwise-image-reviewer

## Purpose

Reject weak or risky generated images before they reach page or ad drafts.

## Output

Strict JSON with approved images, rejected images, regeneration recommendation,
and image score.

## Constraints

- Minimum image score is 82.
- High-risk or off-brand images block publishing.
- Phase 1 does not call this skill.

## Tools

- `blockwise.model_router.route`
- `blockwise.vision_provider.review`

