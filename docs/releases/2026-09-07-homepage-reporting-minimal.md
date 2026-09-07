# Minimal reporting redesign — 7 September 2026

- Preview: https://blockwise.sale/homepage-preview/concept#results
- Compiled source: `60d26b84b0068dde5586c0e6a9cfe4463e92dee9`.
- Image/container: `blockwise-homepage-preview:60d26b84b006` / `blockwise-homepage-preview-60d26b84b006`.
- VPS source: `/projects/blockwise-homepage-value-20260907`; branch `codex/homepage-value-redesign-20260907`.

## Owner correction

Line graph, simpler layout, far fewer words. One dashboard now sits beside a short headline, with email frequency in its footer. Removed the second email card, campaign table, explanatory paragraphs, duplicate captions and closing slogan. Default server-rendered text drops from 205 to 55 words including interface labels: 73% fewer. A test enforces fewer than 80 words.

The SVG line represents the existing fixture series without smoothing or invented data. Period changes draw in the shared 250ms timing; SSR, keyboard and reduced-motion paths remain immediate. Daily, weekly and custom cadence remain illustrative, without delivery or persistence. The unused detailed email-summary fixture and campaign rows were removed.

## Verification

- Full suite: 937 tests, 936 passed, zero failures, one existing permissions skip. Final focused tests: 8/8.
- NUL scan, TypeScript check, production build and container image build passed.
- Desktop 1440px and phone 320px inspected. Final narrow-phone title and controls stay on one line; controls are 44px high; month spend $1,116 fits. No horizontal overflow.
- Period selection changes totals and line geometry. Daily and custom 14-day schedules work. Reduced-motion interaction and visible initial line verified. No application console errors. Browser overrides restored.
- All six surrounding sections matched compiled HTML from preview `61f25a4f5b75e4b5e6c4ae4f74929e5bcde30125`, including its latest hero changes.
- Final public GET 200, exact revision, 55-word count and noindex verified. Existing preview-only service isolation is unchanged.
- Impeccable distill/craft applied; detector findings were advisory customer-app palette/type/radius differences only. No extra dependency or global design-system rewrite.

## Hosting

Existing isolated non-root, read-only preview container configuration retained. Public revision guards ran before each route switch. Production application and provider integrations were not deployed.

Reapply with `python3 scripts/vps/homepage-preview-route.py --upstream blockwise-homepage-preview-60d26b84b006:3000 --apply`. The preceding `blockwise-homepage-preview-61f25a4f5b75` remains available for rollback through the same preview-only updater. Never restore an old full router configuration. Future homepage releases must preserve this minimal reporting revision.
