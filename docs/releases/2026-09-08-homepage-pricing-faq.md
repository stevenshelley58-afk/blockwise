# Homepage pricing FAQ preview, 8 September 2026

Historical release evidence, not a product homepage deployment.

## Change and provenance

- Preview: https://blockwise.sale/homepage-preview/concept#faq
- Application revision: `0cb241f44bb99323b9a5c093a28003b38353d41c`.
- Worktree: `/projects/blockwise-homepage-chat-reconciled-20260907`.
- Branch: `codex/workflow-continuity-20260908`.
- Replaced the old six-question FAQ with the current public pricing FAQ: six categories and 15 question-answer pairs.
- Categories: Getting started, Plans, Costs, Billing, Ownership and support, Let’s talk.
- Category headings and nested questions use native details/summary disclosures, initially collapsed. Category headings retain H3 semantics and independent plus indicators.
- Compared every question and answer against the captured live pricing page. The only copy normalization replaces an em dash with a comma in the ownership answer.
- The preview worktree's older pricing route does not contain the current pricing FAQ. The copied public content remains isolated in `src/lib/homepage-concept/content.ts`, rather than importing stale pricing content or changing the product.
- The seven homepage sections, workflow, ad examples and reporting email selector remain unchanged outside the FAQ.
- No backend integration, email delivery, billing action or product publishing was added.

## Verification

- NUL check, full test suite, typecheck, production build and diff whitespace check passed.
- Full suite: 942 passing tests, zero failures, one existing root-permissions test skipped because root bypasses chmod restrictions. Focused homepage tests: six passed.
- Candidate and public HTML matched, including the compiled revision, six groups, 15 FAQ pairs, all seven section IDs and absence of em dashes and the removed example-data label.
- Browser verified the exact revision at the public preview URL. All six categories started collapsed. All 15 nested questions expanded.
- Keyboard Enter expanded the first category and question; a visible focus outline was present.
- Visually inspected desktop collapsed layout at 1440px and expanded mobile layouts at 390px and 320px. FAQ controls and answer rectangles had no horizontal overflow; mobile summary targets were at least 68px high.
- Browser no-script check was not completed because automation timed out with page scripting disabled. Normal browser settings were restored.
- Preview GET returned 200 with no-store and noindex headers; POST returned405 and preview API health returned404.
- Router comparison confirmed that only the isolated preview upstream changed.
- Product health before and after remained `674b512139961927191f3659a64737a2e0db1cdd`; the canonical exact-revision health gate passed.
- Evidence: `/projects/blockwise-homepage-chat-reconciled-20260907/work/homepage-pricing-faq/`.

## Retained release and rollback

- Live preview container: `blockwise-homepage-preview-0cb241f44bb9`.
- Live image: `blockwise-homepage-preview:0cb241f44bb9`.
- Immediate rollback container: `blockwise-homepage-preview-ac31fbea9058`.
- Immediate rollback image: `blockwise-homepage-preview:ac31fbea9058`.
- Rollback application revision: `ac31fbea9058a837282993efd93ada6c53da0803`.
- Both images are standalone and do not mount this worktree. Existing documented older rollbacks remain untouched.
- To restore the immediate rollback, use the retained preview-only route installer with upstream `blockwise-homepage-preview-ac31fbea9058:3000`, then verify the preview revision and unchanged product health.
- Router snapshots are retained in the evidence directory and the canonical preview installer backup directory `/srv/blockwise/previews/homepage/`.
