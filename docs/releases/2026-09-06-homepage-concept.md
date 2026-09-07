# Homepage concept preview — updated 7 September 2026

## Delivered

- Public, unlisted/noindex preview: https://blockwise.sale/homepage-preview/concept
- Application revision: `bb566f8523b031f5f8a16b6a1944ec6840f85945`.
- Image: `blockwise-homepage-preview:bb566f8523b0`.
- Image ID: `sha256:c52ec08ea531a2e8224b32a234fd96d5354ea0b0526590fa036e0d2077468055`.
- Healthy container: `blockwise-homepage-preview-bb566f8523b0`, read-only, non-root, 1 GB memory limit, no host port, separate internal Docker network, no production environment or credentials.
- Branch: `codex/homepage-mobile-mockup-20260906`; source worktree `/projects/blockwise-homepage-mockup-20260906`.

The latest update moves the eight-ad Meta loop into the hero as its only product visual and removes the former standalone showcase section and heading. The four Facebook Feed and four Instagram Story examples now use clean property and agent photography without embedded promotional copy. Messaging stays in Meta's native caption, headline and CTA areas, so every placement remains legible when scaled in the moving deck. Only the front ad carries full emphasis; two quieter cards establish depth behind it.

The owner requested a mockup, not a live homepage replacement. The production product was not deployed by this change. Its independent exact production-health gate passed at the then-current served revision `f21043fff1af0a0ad63eff813f16dbf71952c87a`. No product app, database, auth, billing, email or Meta service was changed.

## Checks

- `npm run check:nul`: passed.
- `npm run test`: all tests passed with one existing root-only permission-semantics skip; no test was weakened.
- `npm run typecheck`: passed.
- `npm run build`: passed with `BLOCKWISE_HOMEPAGE_PREVIEW=true`, `NEXT_PUBLIC_BASE_PATH=/homepage-preview`, and the exact application revision above.
- Impeccable detector completed once after the UI implementation. Its relevant font and colour warnings are intentional: the ad chrome uses Meta-like system typography and interface colours rather than the surrounding Blockwise brand treatment.
- Git whitespace checks passed.

## Public browser acceptance

Verified in Chromium through the real HTTPS preview:

- Compiled revision metadata equals the application revision above.
- At 1440, 768 and 390 px, page width equals viewport width with no horizontal overflow.
- The hero contains the eight-ad deck, the former standalone section and heading are absent, and the loop alternates visibly between Facebook Feed and Instagram Story placements at every tested width.
- Clean photography remains readable in both front and scaled background cards. Pause holds the current ad; play resumes the deck. The loop pauses offscreen and while the page is hidden.
- Reduced-motion visitors receive a static composition and the playback control is hidden.
- Network observation across fresh loads and interactions contained GETs only. No product API, analytics, email or other write request was made.
- No browser console errors or failed page resources were observed.
- Public preview GET returns 200 with noindex headers; POST returns 405.

These are responsive Chromium checks, not a claim of testing every physical phone or a measured conversion uplift. The form remains intentionally disconnected from lead storage, authentication, email delivery and analytics.

## Routing and reapplication

The existing product router has one narrow preview route. Shared Frank edge configuration and the mounted production product Caddyfile remain unchanged. Runtime route changes have backups under `/srv/blockwise/previews/homepage/`.

After a product-router restart or configuration reload, reapply only if this preview is still required:

```sh
cd /projects/blockwise-homepage-mockup-20260906
python3 scripts/vps/homepage-preview-route.py --upstream blockwise-homepage-preview-bb566f8523b0:3000 --apply
```

Remove only the preview route with `--remove --apply`; do not restore an old full router backup over other work. The previously routed preview container was removed after final acceptance.

## Integration seam

The email demo adapter is `src/lib/homepage-concept/mock-trial.ts`; replace it with an approved signup or lead-capture service only when live integration is requested. Ad examples and FAQs remain isolated in `content.ts`; reusable components and route CSS do not require backend credentials.

The deck motion follows Emil Kowalski's interaction principles: one purposeful focal loop, transform/opacity movement, confident easing, visible pause control, offscreen and hidden-tab pausing, and a reduced-motion path. Impeccable guided the visual and responsive quality pass.
