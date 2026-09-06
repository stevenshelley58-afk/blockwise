# Homepage concept preview — 6 September 2026

## Delivered

- Public, unlisted/noindex preview: https://blockwise.sale/homepage-preview/concept
- Application revision: `7d1274483feaeb5f053940844182ecf62e45f211`.
- Image: `blockwise-homepage-preview:7d1274483fea`.
- Image ID: `sha256:dee82b6154cabbb5c6a450ecef3ec997288e037501c409f5fca9742918e14fd1`.
- Healthy container: `blockwise-homepage-preview-7d1274483fea`, read-only, non-root, 1 GB memory limit, no host port, separate internal Docker network, no production environment or credentials.
- Branch: `codex/homepage-mobile-mockup-20260906`; source worktree `/projects/blockwise-homepage-mockup-20260906`.

The owner requested a mockup, not a live homepage replacement. The existing product remains at `bc2b1f3ba681727c9f4261ddce90466cb170fc41`. Its exact production-health gate passed after preview routing. No product app, database, auth, billing, email or Meta service was deployed or changed.

## Checks

- `npm run check:nul`: passed.
- `npm run test`: 932 tests; 931 passed, zero failures, one existing skip. The skipped unwritable-directory test explicitly skips under root because root bypasses chmod permissions; no test was weakened.
- `npm run typecheck`: passed after the final responsive-disclosure change.
- `npm run build`: passed with `BLOCKWISE_HOMEPAGE_PREVIEW=true`, `NEXT_PUBLIC_BASE_PATH=/homepage-preview`, and the exact application revision above.
- Scoped/final Git whitespace checks passed.
- Fresh `npm ci --ignore-scripts` audit reported zero vulnerabilities in the installed dependency set; no dependencies were added.

## Public browser acceptance

Verified in Chromium through the real HTTPS preview, not just a local dev server:

- Compiled revision metadata equals the application revision above.
- Layout measurements at 320, 360, 390, 430, 768 and 1440 px found no off-screen controls, cards or preview panels. Desktop visual review also used the browser's default 1536 px width.
- At 390 × 844, the opening sections measured 787, 650 and 858 px: the complete app introduction occupies about 2.7 phone screens. Additional examples, details, FAQs and the form remain below (about 5389 px total before optional details are opened).
- Phone hero animation is disabled and email input is 16 px. Reduced-motion emulation reduces desktop entrance duration to 0.00001 seconds.
- Example controls change ad imagery/copy with pointer or keyboard. All four controls are visible in a phone grid.
- Mobile ad details default closed, can be opened, and return to an open/readable desktop presentation across the breakpoint. Native FAQs expand and collapse.
- Trial links reach the email form. Empty and malformed emails produce validation errors. Valid demo submission shows a disabled pending state and explicit success saying the address was not sent or saved.
- Network observation spanning fresh load and demo submission contained 35 GETs and no non-GET request. No product API, analytics or email request was made; unrelated browser-extension resources and standard favicon GETs were present.
- No browser console errors. All creative/logo assets loaded from the preview path.
- Public preview GET returns 200 with noindex headers; preview product API returns 404; POST to the preview returns 405.

These are responsive Chromium checks, not a claim of testing every physical phone or a measured conversion uplift. The form is intentionally not connected to a lead store, authentication, email delivery or analytics.

## Routing and reapplication

The existing product router has one narrow preview route. Shared Frank edge configuration and the mounted production product Caddyfile remain unchanged. Runtime route changes have backups under `/srv/blockwise/previews/homepage/`.

After a product-router restart or configuration reload, reapply if this preview is still required:

```sh
cd /projects/blockwise-homepage-mockup-20260906
python3 scripts/vps/homepage-preview-route.py --upstream blockwise-homepage-preview-7d1274483fea:3000 --apply
```

Remove only the preview route with `--remove --apply`; do not restore an old full router backup over other work. The initial draft container was stopped after final acceptance; the validated container remains running.

## Integration seam

The email demo adapter is `src/lib/homepage-concept/mock-trial.ts`; replace it with an approved signup/lead-capture service only when live integration is requested. Ad examples and FAQs are isolated in `content.ts`; reusable components and route CSS do not require backend credentials.

Implementation used Sol for the cohesive frontend; Astra coordinated isolation, final browser checks and deployment. No reviewer-agent gate was added.
