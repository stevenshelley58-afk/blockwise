# blockwise-page-builder

## Purpose

Prepare a draft blog page package from formatted content, approved assets, SEO
data, and CTA mapping.

## Output

Strict JSON with `page_path`, `page_component_path`, `preview_url`, `status`,
and `build_notes`.

## Constraints

- Phase 1 creates draft page data only.
- Do not publish public pages automatically.
- Prefer content-driven page data over one hardcoded React page per blog.

## Tools

- `blockwise.prompt_registry.load`
- `blockwise.model_router.route`

