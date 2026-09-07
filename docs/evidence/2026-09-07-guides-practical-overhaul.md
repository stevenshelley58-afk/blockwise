# Guides practical overhaul — 7 September 2026

## Scope

Rebuilt the guide hub and all eight guides using three Luna workers and an integration/visual pass. Existing brand, public routes, canonical URLs and original publication dates are retained.

- Decision-grouped, text-first hub; sold-price starter link visible in the first mobile viewport.
- Decorative article imagery removed; compact headers, real text diagrams, mobile contents, readable tables, focus states and reduced-motion support.
- Seventeen downloadable CSV/text resources. Fictional examples are explicitly labelled; no fabricated client results or expert bylines.
- Copy controls preserve multiline drafts and expose a selectable fallback if clipboard access fails.
- Downsizer calculator validates missing/negative/fractional/impossible counts, preserves zero denominators, and computes observed stage rates/costs without transmitting inputs.
- Sold-price guide: sample list, exact ad/form/consent/delivery copy and worked arithmetic.
- Offer guide: two practical entry points, concrete ads and follow-up, optional recurring permission.
- Downsizer guide: genuine buyer offer, non-financial motivations, synthetic matching list and 14-day/90-day review distinction.
- Follow-up: light three-touch default, day-by-day branching, separate phone and electronic-message guidance.
- Custom lists: curation beyond portal filters, source rights, specific forms/delivery and qualified learning claims.
- CRM: report the full journey versus select an optimisation stage; Lead ID recommended rather than mandatory; matching/privacy/checklist guidance.
- Creative: readable example ads, three-card copy and spoken script with proof requirements.
- Algorithm briefing: four dated 2024–2026 systems; platform statements separated from Blockwise inference.

## Source and integration

Guide changes: `b1c9b8e27c3b625a3231512c0897425057b7ada7` and compact-browser diagram fix `eaa0fbd9516382073b34aff61b1476796dcda982`.

The release branch incorporates the serving `df08571156b43967124885327233529a6e74d141` revision, preserving the concurrent editor, analytics and transactional-email work. No unrelated release changes were reverted. Existing analytics build arguments were preserved in the private build harness.

Source-only PR: https://github.com/stevenshelley58-afk/blockwise/pull/456. It excludes the unrelated production ancestry.

## Verification

- `npm run check:nul`, `npm test`, `npm run typecheck`, `npm run build` on the integrated release.
- Test suite: 963 passed, 1 pre-existing skip, 0 failures.
- The earlier live base had an unrelated legal-source assertion failure; the concurrent serving release corrected it. No billing or legal copy was changed for this task.
- Eight focused guide contract/resource tests.
- Controlled VPS canary over isolated loopback HTTPS; no Vercel preview used as acceptance.
- Desktop 1440×1000 and mobile 390×844 browser verification of all nine routes, canonical links, contents targets, downloadable resources, calculator arithmetic/validation, clipboard success/fallback, runtime errors and document overflow.
- Visual inspection caught an invalid nested CSS `:has()` rule that left an image-sized blank row. Corrected it and added a rendered height regression assertion.
- No DB migrations, customer-data changes or provider-gate changes for the guides.

Final serving revision, browser results and health/rollback evidence follow.

## Final release evidence

- Serving revision: `7695843e252c5193d5384b9bf9733fb55eb6864a`.
- Immutable image: `blockwise-app:7695843e252c5193d5384b9bf9733fb55eb6864a`.
- App-only deployment; compiled readiness/provenance verified with `scripts/vps/product-health.sh` at the exact revision.
- Final controlled canary: 24 browser checks passed (13.6s).
- Live production route: the same 24 browser checks passed (12.9s), with 200 responses and usable resources on all nine routes.
- Desktop/mobile screenshots inspected; compact summary diagram regression confirmed fixed.
- Initial mobile hub starter link now begins at approximately 377px in the 390×844 viewport, rather than leaving the first screen without a guide entry point.
- Private test evidence and scripts: `/srv/blockwise/e2e-runs/guides-overhaul-20260907/`. No secrets or browser state are committed.
- Public entry point: https://blockwise.sale/guides.

Rollback image retained: `blockwise-app:df08571156b43967124885327233529a6e74d141`. Use the current VPS app rollback procedure and verify compiled provenance. Do not blindly restore an old complete environment file over newer configuration. The protected pre-release environment backup remains only in the private release evidence directory.
