# Complete homepage preview, 7 September 2026

## Delivered

- URL: https://blockwise.sale/homepage-preview/concept
- Compiled application revision: `f899d6815131138172f1bac90b07a8f0cc7dcb93`.
- Image/container: `blockwise-homepage-preview:f899d6815131` / `blockwise-homepage-preview-f899d6815131`.
- Source: `/projects/blockwise-homepage-complete-20260907`, branch `codex/homepage-complete-20260907`, pushed to origin.
- Scope: preview only. Root homepage, product image, data, provider gates and other routes were not changed.

The consolidation retains the latest clean Feed/Story hero, exact hero copy,
removed playback controls, reporting curves, complete axes, replay timing,
requested email sentence and revised FAQ answers. The separate editing
iteration is adapted into the existing examples section without restoring the
superseded process explainer. Four objective controls switch distinct mock ad
content. A single shared clock selects and types the overlay text, then rests;
fixed text geometry prevents layout shifts and repeated cycles cannot drift.

Removed the redundant example explanation, duplicate control accordion, FAQ
introduction, trial feature list and unused static ad component/styles. Pricing
and guides link to their current independently maintained pages. No new
library, product integration, artificial performance claim or auto-approval was
introduced. See [the consolidated direction](../design/homepage-concept.md)
for the revision-by-revision decisions.

## Verification

- NUL scan and whitespace checks passed.
- Full suite: 939 tests, 938 passed, zero failed, one existing root-only permission skip.
- Focused homepage/animation fixture tests passed after integration; tests cover
  repeatability over 100 cycles, typing phases, fixture asset existence, image
  separation from the hero, mock isolation and the no-JavaScript form guard.
- TypeScript and both production builds passed. Final CSS readability and
  two-column choice refinements were rebuilt with the exact final revision.
- Browser review covered 1440 CSS-pixel desktop, 768 tablet, 390 and 320 phones.
  All four objective choices and native FAQ expansion were exercised with
  keyboard activation. Editing samples showed selection, progressive text,
  rest and reset while overlay height stayed constant.
- Reporting range switching updated figures and labels; the shared clip
  progressed from partial to complete when visible. Reduced motion showed
  static finished content. Existing offscreen/hidden-page pausing was retained.
- Empty email validation and mock success passed. No network request was made
  during form submission. Without JavaScript the form stays disabled and the
  finished ad remains visible, so the demo cannot accidentally submit an email
  through a native GET request.
- Final public revision, healthy container, noindex headers and image loads
  verified. A fresh final load had no failed requests, no non-GET requests and
  no site JavaScript errors. An earlier blocked preload occurred during the
  intentional JavaScript-disabled check, not the clean final load.
- No document horizontal scrolling at the tested sizes. The hero's intentional
  clipped background ad stack is not treated as page overflow.
- Preview POST returned 405 and preview application API returned 404.
- Product readiness separately passed at then-current
  `c02b11e452203a2d54bd278b913f410588ce6ff4`. Every non-preview route compared
  identically immediately before/after each switch. The concurrent beta-readiness
  task was notified that this does not promote the production homepage.

Logs and temporary verification files remain in the ignored/uncommitted
worktree `work/` directory, not in source history. Browser viewport, scripting
and reduced-motion test overrides were restored before handoff.

## Mock boundaries

- Hero examples remain in the existing `META_SHOWCASE_ADS` fixture.
- Editable ad fixtures/timing: `src/lib/homepage-concept/creative-edit.ts`.
- Reusable visual: `src/components/homepage-concept/creative-edit-preview.tsx`.
- Reporting fixture: `src/lib/homepage-concept/reporting.ts`.
- FAQ fixture: `src/lib/homepage-concept/content.ts`.
- Email adapter: `src/lib/homepage-concept/mock-trial.ts`. Replace only with an
  approved real lead/signup integration when separately requested.

## Rollback and reapplication

The original preview container remains available. To restore the pre-task
preview, first verify it is healthy, then update only its narrow route:

```sh
python3 scripts/vps/homepage-preview-route.py --upstream blockwise-homepage-preview-bac4d1372543:3000 --apply
```

After a product-router reload, reapply this complete preview, if still required:

```sh
python3 scripts/vps/homepage-preview-route.py --upstream blockwise-homepage-preview-f899d6815131:3000 --apply
```

The utility snapshots current configuration and preserves other route objects.
Never restore an old complete router backup over concurrent work. Hosting stays
non-root, read-only, capability-dropped, secret-free, internally networked, with
no host port and a 1 GB memory limit.
