# Homepage concept refinement: 8 September 2026

Historical release evidence, not a permanently current deployment claim.

## Scope and result

Refined only https://blockwise.sale/homepage-preview/concept. The main homepage,
customer app, database, billing policy and provider-write gates were not changed.

- Lead-first hero: More leads. Less ad management.
- The previous stacked Feed and Story hero animation, clearly labelled as example ads and stripped of fabricated engagement counts.
- Three manual, functional workflow steps: Choose, Customise, Budget & review.
- Consolidated reporting, fictional lead handoff and email preview controls.
- Three-plan pricing with optional detail disclosures and consistent signup links.
- Six grouped FAQ topics retained, with nested question accordions intact.
- Responsive navigation, readable controls, explicit local-only demo state,
  keyboard/reduced-motion support and a direct final signup action.

No testimonials, case studies, performance proof or guaranteed lead claims were
added. Demonstration campaigns, contacts and metrics are labelled illustrative.
Disputed trial timing and indefinite free management are not promised. Existing
public plan prices/allowances are presentation only, not new technical entitlements.
See the task evidence register for the unresolved offer-policy discrepancies.

## Exact deployed artifact

- Compiled application SHA: `30955a24508c603e693111ae262d79936c8ec091`.
- Branch: `codex/homepage-rework-20260908`.
- Source: `/projects/blockwise-homepage-rework-20260908`.
- Container: `blockwise-homepage-preview-30955a24508c603e`.
- Image: `blockwise-homepage-preview:30955a24508c603e`.
- Image ID: `sha256:e952cb6d91d7516d0356fd3fc42b9141af82591fdc60b179f17394113267d908`.
- Secret-free standalone build on the existing internal-only preview network.
  Read-only container, no mounts or host ports, restart unless stopped.
- Public HTML revision matches both the compiled SHA and image OCI label.

The original `/projects/blockwise-homepage-chat-reconciled-20260907` worktree and
its unrelated/unfinished state were preserved. The task worktree started from
`bd9c2c33969b0399a4d09f7ab5c232298d89ba31` with five related unfinished source
files copied before refinement. This dated release note is a later docs-only commit.

## Verification

All repository gates ran from the final clean application commit:

- `npm run check:nul`: passed.
- `npm test`: 941 passed, zero failed, one environment-specific skip. The skipped
  unwritable-directory test cannot exercise chmod semantics as root.
- `npm run typecheck -- --pretty false`: passed.
- Preview-mode `npm run build`: passed with the full compiled revision.
- Frozen Chromium acceptance: 1/1 passed on the compiled internal canary and
  1/1 passed again on the public URL, no skips.
- Browser checks include widths 320/375/390/414/768/1440; real element rectangles,
  every expanded nested FAQ at 320/390, no rotated/clipped question text,
  computed pricing/chart margins, loaded images, menu/keyboard behavior,
  direct CTA targets, workflow/reporting controls, exact two-line hero geometry,
  restored light-blue headline colour, ad-deck rotation, label clearance and reduced motion.
- No signup navigation/submission, API/analytics writes, browser errors or page
  errors during the acceptance runs. No provider, payment or email acceptance
  is inferred from the mockup tests.

Public isolation checks: HTTP 200, noindex/noarchive, no-store, POST 405 and
preview API 404. Exact non-preview Caddy configuration is unchanged across the
route-only switch. Main product health stayed ready at
`f27324ca4390bf7bffa8d7093c841ee11f4f24d1` before and after the switch.

## Design review

Applied Hallmark, Impeccable and Emil to the existing-world refinement. The
hero refinement Impeccable detector pass reported 27 advisories and four Arial warnings
for the simulated ad UI, not a zero-warning certification. Definite obsolete
CSS was removed and small UI labels corrected; incumbent platform type/palette
choices were retained intentionally. No replacement-world FORM seed applies.

A fresh finish reviewer confirmed direction fidelity and requested one material
spacing fix. The final verdict scored that reset-specificity fix resolved on
readable desktop/mobile captures. This is a verdict on the scored fix, not an
unbounded claim of perfection. Browser QA separately caught and verified the
expanded-FAQ text rotation/wrapping repair.

## Evidence and retention

Evidence root: `/srv/blockwise/e2e-runs/homepage-rework-20260908`.

- `nul.log`, `tests.log`, `typecheck.log`, `build.log`, `docker-build.log`.
- `hero-animation-release-canary-qa.log`, `hero-animation-public-qa.log`, screenshots.
- `review/` readable final section/viewport captures; `baseline/` original view.
- `deployment.json`, public headers, immediate before/after router snapshots.
- `impeccable-detect.json` and the original context report.

Immediate rollback retained unchanged:
`blockwise-homepage-preview-2e3794aba68c2890`, full SHA
`2e3794aba68c289041de1462bb1f39bef7a7fad5`, image ID
`sha256:788c14aed62030b2d83da8ea1910031b9a2bcd5346ac8c1ac9c24a9f368fb7e1`.
Older protected fallbacks `blockwise-homepage-preview-6ea2231796f6da23` and
`blockwise-homepage-preview-2edfff58c68b3739` also remain.
Rollback must change only the named preview upstream, not restore a whole old
Caddy configuration. No main-app deployment or origin/main update was performed.

The superseded task canary containers/images for `acab35d3eeee6e93` and
`f075bac866d24777` were retired after confirming no live route/container used them.
Task build/dependency cleanup is recorded separately in `retention.json`.
