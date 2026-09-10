# Homepage workflow copy, 8 September 2026

## Approved copy

Heading (exactly two visual lines):

More leads.  
Less ad management.

Subheading: Customise a proven template and publish your lead-generating ad, all in one place.

The owner explicitly requested this subheading and then the two-line heading. Only the workflow heading, subheading, responsive typography/spacing and focused regression tests changed. The approved animation and all other sections remain unchanged. Heading size responds to its copy-column width so the second line stays intact on desktop and phones.

## Published revision and verification

- Preview: https://blockwise.sale/homepage-preview/concept#how-it-works
- Compiled revision: `02f632fe7b5edccb8bb527bfa2e83da93aa4bc4b`.
- Container/image: `blockwise-homepage-preview-02f632fe7b5e` / `blockwise-homepage-preview:02f632fe7b5e`.
- Source: `/projects/blockwise-homepage-chat-reconciled-20260907`, branch `codex/workflow-continuity-20260908`.
- `npm run check:nul`, `npm run test`, `npm run typecheck`, preview production `npm run build`, and `git diff --check`: passed.
- Public and candidate HTML matched byte-for-byte; exact revision and approved copy verified. All seven homepage sections retained.
- Final browser checks at 1440, 390 and 320 CSS pixels: exactly two heading lines, no heading clipping or document horizontal overflow. Desktop and phone screenshots reviewed. Heading/subheading gap verified at 20px. Browser error log empty; existing workflow phases continued progressing.
- Preview GET 200, no-index/no-store; POST 405 and preview API 404 checked during this copy release. All non-preview router configuration unchanged across both switches.
- Production remained ready at `77a89d270f65ca0561ebc90214cb401700ce3825`. Current main product-health gate passed for that exact revision after final preview deployment. No product deployment or provider writes.

## Rollback and retention

- Pre-copy rollback retained: `blockwise-homepage-preview-5f7226d4a9fa` / `blockwise-homepage-preview:5f7226d4a9fa` (revision `5f7226d4a9fa4770c7b118aa554b2e50ab649886`). Older documented workflow rollback also untouched.
- Final live container healthy without source bind mounts. Intermediate copy container/image `3f386a788b31` removed after verifying it had no route or remaining container consumers.
- Regenerable dependency/build directories retired after an active-consumer check. Source, Git history, and `work/workflow-copy/` check/deployment evidence retained.

Preview-only reapplication uses the maintained route installer:

`python3 scripts/vps/homepage-preview-route.py --upstream blockwise-homepage-preview-02f632fe7b5e:3000 --apply`

This is dated release evidence, not a replacement for the canonical operating guides.
