# Mobile Home pilot release evidence, 8 September 2026

Application candidate: `5d23e7368bdd1b5ddcabbdba6194aa9a1565e476`, immutable image `blockwise-app:5d23e7368bdd1b5ddcabbdba6194aa9a1565e476`.
Documentation/test-only successor: `229e4d422`. This does not change the compiled app.

## Scope
Signed-in `/self-serve` Home pilot only: flat mobile sections, single title, House tab icon, 48px primary action with 10px radius, inline real metrics, feature-filtered library rows, completed milestones and workspace administration disclosures. Existing read-model and activation contracts retained. Other routes and public marketing design unchanged.

## Verification before deployment
- NUL scan, full canonical tests and typecheck passed (`CHECK_EXIT:0`). Full tests: 1,084 total, 1,082 passed, two environment-dependent skips.
- Exact-SHA production Docker build passed.
- Controlled canary Home browser suite: seven passed at 320/375/390/414/768/1440, including keyboard disclosures and zoom.
- Populated read-model browser fixture: one passed at320. Synthetic metrics were fulfilled only inside the browser, not written to customer data. Full values accessible; display values127/$1.2K/98.8K fit their columns.
- Computed mobile dimensions: white main surface; header56px; account44px; primary48px; radius10px; document width320px with no overflow.
- Separate customer-navigation suite: five passed, one expected market-fixture skip. Initial combined run omitted the explicit storage-state variable and skipped that suite; the separate corrected run is the acceptance evidence.
- Manual design detector returned no findings. Independent visual review identified square CTA, gray surface, duplicate arrow, over-wide desktop action; final confirmation screenshots verified their corrections.
- Customer UI remains light-only. Sidebar theme support is not full-page dark mode. Early screenshots misnamed dark were not accepted as dark-mode evidence.

Evidence directory: `/srv/blockwise/e2e-runs/home-mobile-pilot-20260908/`. Canonical checks logs `npm-test-5d23e73.log`, `typecheck-final.log`, `check-nul-final.log`; browser logs `final-canary.log`, `final-navigation.log`; screenshots `final-canary/`, `final-navigation/`.

## Protection
Previous serving revision `cdc4de9c40f8d92ff3a61cf93d2a141acea15b0b` and its immutable image are retained for rollback. Source remains `/projects/blockwise-ux-swarm-20260908` on `feat/mobile-home-pilot-20260908`. Public deployment and post-deploy acceptance are recorded below once verified. Provider writes remain disabled; worker activation, real publishing, billing and email delivery are not accepted by these UI checks.

## Public release acceptance
Public `/api/health` and the exact-SHA health script verified `5d23e7368bdd1b5ddcabbdba6194aa9a1565e476` after app-only deployment. Public browser checks with normal TLS: **13 passed, one expected market-fixture skip**, `PUBLIC_QA_EXIT:0`. Evidence: `public-final.log`, `public-final/`, `public-health.log` in the Home pilot evidence directory. No real provider writes were exercised.

Protected previous environment (mode600): `/srv/blockwise/e2e-runs/ux-swarm-20260908/evidence/release/product.env.before-5d23e7368bdd1b5ddcabbdba6194aa9a1565e476`. Operational release log: `/srv/blockwise/e2e-runs/ux-swarm-20260908/evidence/release/public-release-5d23e736.log`. These paths belong to the same retained task workspace. The old cdc4de9 image remains the rollback; no database, auth, storage, edge or worker recreation was required.

The task-owned canary was retired after public acceptance; immutable serving and rollback images, source and evidence retained. Home is a pilot awaiting customer design feedback, not approval to redesign other routes.
