# Homepage hero preview — 7 September 2026

- Preview: https://blockwise.sale/homepage-preview/concept
- Compiled application revision: `61f25a4f5b75e4b5e6c4ae4f74929e5bcde30125`.
- Container/image: `blockwise-homepage-preview-61f25a4f5b75` / `blockwise-homepage-preview:61f25a4f5b75`.
- Source: `/srv/blockwise/e2e-runs/hero-integrated-20260907`, branch `codex/hero-preview-integrated-20260907`.
- Prior preview base: `c22d3a36d131`; concurrent process, reporting, FAQ and motion changes preserved. Hero-only net code changes are the concept component and scoped concept CSS.

## Delivered

Existing approved headline, blue prompt, subheading and trial action retained. Reusable Feed/Story stack uses existing example fixtures and creative assets; no dependency or live integration added. A roughly three-second illustration plays on entry and settles, with keyboard-accessible replay and complete reduced-motion/no-JavaScript states. Trial links use the existing mock form and do not create accounts or submit advertising.

## Verification

- Required no-NUL, full test suite, typecheck and production preview build passed after integration.
- Public HTTPS Chromium checks passed at 320, 375, 390, 430, 768, 1366 and 1440px.
- No horizontal overflow or browser errors; images loaded. Measured cumulative layout shift was 0 for every checked viewport.
- At 1366×768 the complete hero is 759px tall. Phone headings are 36–40px with 20px side spacing; trial CTA is above the fold in every checked phone viewport.
- Replay restarts the illustration; keyboard Enter on the hero trial link reaches the mock form. Reduced motion and disabled JavaScript show the finished composition. No hero animation remains running after the sequence.
- Full Feed image aspect ratio retained to avoid cutting off embedded branding.
- Public revision metadata and noindex response header match this release.
- The product app was independently updated during this task; readiness/provenance passed for its running revision `df08571156b43967124885327233529a6e74d141`. This task changed only the preview route, not the product app or provider services.

Evidence on VPS: `/tmp/hero-public-qa.log`, `/tmp/hero-integrated-test-final.log`, `/tmp/hero-integrated-build-release.log`, `/tmp/hero-integrated-typecheck.log`, `/tmp/hero-final-1366.png`, `/tmp/hero-final-390.png`, `/tmp/hero-final-320.png`.

Implementation used a Luna worker; parent handled focused final corrections, integration and release verification. No live advertising, email, authentication, billing or data connection was added.

## Preview-only rollback

Run `python3 scripts/vps/homepage-preview-route.py --upstream blockwise-homepage-preview-c22d3a36d131:3000 --apply` from this checkout after checking the current preview route. Do not restore an old full router configuration over concurrent changes.
