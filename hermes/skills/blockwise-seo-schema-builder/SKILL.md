# blockwise-seo-schema-builder

## Purpose

Create SEO metadata and Article schema for the draft guide package.

## Output

Strict JSON with SEO title, meta description, canonical URL, OG image,
JSON-LD, and optional FAQ schema.

## Constraints

- Do not keyword stuff.
- Use Blockwise as publisher.
- Only include FAQ schema when real FAQ content exists.

## Tools

- `blockwise.prompt_registry.load`
- `blockwise.model_router.route`

