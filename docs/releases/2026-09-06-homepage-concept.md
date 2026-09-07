# Homepage concept preview — updated 7 September 2026

## Delivered

- Public, unlisted/noindex preview: https://blockwise.sale/homepage-preview/concept
- Application revision: `7bbe60b7bb4827fbebe981741dbcd2f4702512ad`.
- Image: `blockwise-homepage-preview:7bbe60b7bb48`.
- Image ID: `sha256:3fa87878f0080cd5168aebe25a41fe013e076832d5967f28246f8185d6c1fc83`.
- Healthy container: `blockwise-homepage-preview-7bbe60b7bb48`, read-only, non-root, 1 GB memory limit, no host port, separate internal Docker network, no production environment or credentials.
- Branch: `codex/homepage-mobile-mockup-20260906`; source worktree `/projects/blockwise-homepage-mockup-20260906`.

The latest update replaces the previous explainer animation with one continuous, legible workflow. It browses several templates, selects one, carries that creative into a smaller editor, visibly updates both post copy and text on the creative, moves the finished ad into campaign review, fills audience/budget/duration, presses approval, and finishes with a green `Approved` state. Choose, Customise and Review remain keyboard-operable manual controls.

The owner requested a mockup, not a live homepage replacement. The production product was not deployed by this change. Its independent exact production-health gate passed at the then-current served revision `447d05568b22bfb4ae138b70b083d74c12d67b6c`. No product app, database, auth, billing, email or Meta service was changed.

## Checks

- `npm run check:nul`: passed.
- `npm run test`: all tests passed with one existing root-only permission-semantics skip; no test was weakened.
- `npm run typecheck`: passed.
- `npm run build`: passed with `BLOCKWISE_HOMEPAGE_PREVIEW=true`, `NEXT_PUBLIC_BASE_PATH=/homepage-preview`, and the exact application revision above.
- Impeccable detector completed once after the UI implementation. Its findings were advisory design-token drift; the new explainer's stray literal colours were replaced with the established palette where applicable.
- Git whitespace checks passed.

## Public browser acceptance

Verified in Chromium through the real HTTPS preview:

- Compiled revision metadata equals the application revision above.
- At 1440, 768 and 390 px, page width equals viewport width with no horizontal overflow.
- The complete template → copy → creative → review → approval sequence reaches the green `Approved` state at every tested width.
- Choose, Customise and Review respond to pointer and keyboard activation. Pause, resume and replay remain available for ordinary motion preferences.
- Reduced-motion visitors receive the completed static state and the playback control is hidden.
- Network observation across fresh loads and interactions contained GETs only. No product API, analytics, email or other write request was made.
- No browser console errors or failed page resources were observed.
- Public preview GET returns 200 with noindex headers; POST returns 405.

These are responsive Chromium checks, not a claim of testing every physical phone or a measured conversion uplift. The form remains intentionally disconnected from lead storage, authentication, email delivery and analytics.

## Routing and reapplication

The existing product router has one narrow preview route. Shared Frank edge configuration and the mounted production product Caddyfile remain unchanged. Runtime route changes have backups under `/srv/blockwise/previews/homepage/`.

After a product-router restart or configuration reload, reapply only if this preview is still required:

```sh
cd /projects/blockwise-homepage-mockup-20260906
python3 scripts/vps/homepage-preview-route.py --upstream blockwise-homepage-preview-7bbe60b7bb48:3000 --apply
```

Remove only the preview route with `--remove --apply`; do not restore an old full router backup over other work. The previous routed and intermediate containers were stopped after final acceptance and retained for rollback.

## Integration seam

The email demo adapter is `src/lib/homepage-concept/mock-trial.ts`; replace it with an approved signup or lead-capture service only when live integration is requested. Ad examples and FAQs remain isolated in `content.ts`; reusable components and route CSS do not require backend credentials.

The explainer motion follows Emil Kowalski's interaction principles: one purposeful sequence, shared-element continuity, fast exits, eased movement, visible manual controls, offscreen pausing and a reduced-motion path. Impeccable guided the visual and responsive quality pass.
