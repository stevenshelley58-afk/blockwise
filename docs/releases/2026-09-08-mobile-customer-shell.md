# Mobile customer release (8 September 2026)

## Delivered

Application revision `77a89d270f65ca0561ebc90214cb401700ce3825` was deployed
app-only to `https://blockwise.sale`. This is dated release evidence, not a
permanently current revision claim. Verify current health before operating.

- Persistent Home, Ads, Results, Leads and More navigation across self-serve
  routes, including templates, saved editors and review. Monitor access remains
  restricted to its permitted reporting routes.
- Shared accessible More sheet, focus restoration and correct active destination.
- Mobile Settings index with one focused section, retained unsaved form data,
  preserved deep links and browser-history navigation.
- Task-first Home, collapsed completed setup, compact truthful status values.
- Compact Ads hub with New ad, recent ads and reusable library/template links.
- Two-row editor header and five reachable tools above the global menu.
- Consent reserves space and yields to dialogs without changing consent choices.
- DESIGN.md records Steven's established preferences and mobile rules. The
  primary checkout's guide was updated only after its expected hash matched;
  unrelated source and its untracked adstudio folder were not changed.

## Acceptance

- NUL check, typecheck and immutable production image build passed.
- Full repository tests: 1,072 passed, zero failed, two existing skips.
- Authenticated controlled canary: nine browser checks passed, zero skips.
- Public route with normal TLS: the same nine checks passed, zero skips.
- Separate visual/geometry captures passed at 360 and 390 px phone widths and
  1440 px desktop. First-load editor consent leaves all five editor tools and
  all five global destinations hit-testable; tools are at least 44 px high.
- Parent visually reviewed Home, Settings index/account, Ads and editor phone
  captures plus desktop Ads. No horizontal overflow was observed.
- At 390 x 844 in the same sparse test workspace: Home document height moved
  from 2,061 to 1,756 px; Settings index from 5,315 to 844 px; Ads from 1,386
  to 844 px. This measures the default view, not removal of form information.
  At 360 x 800 Settings index is 820 px, so a small scroll remains.
- Live health verified the exact compiled application revision above. Protected
  configuration fingerprint excluding the three release-provenance fields
  matched before and after deployment. No Caddy or worker restart was performed.

The first browser run exposed two test locator errors, not application failures:
Radix deliberately hides the page behind its open modal from accessibility-role
queries, and desktop Templates exists in both the sidebar and hub. The corrected
selectors retain the original assertions, include hidden background only for
modal-state inspection, and scope the desktop link to its sidebar. They were
run against the exact immutable application image, then committed with this
record as a test/documentation-only follow-up. No application rebuild was needed.

## Editor safety and limits

Ordinary in-app same-origin links and the editor Back control ask before
leaving unsaved work. Cancelling preserves URL and state; accepting navigates
once through the client router without a duplicate confirmation. Modified
clicks, downloads, external links, new windows and anchors remain browser-native.
The hard-unload prompt, revision-conflict handling and saved-revision publish
requirement are preserved.

This release does not intercept client-side browser Back/Forward traversals.
Save before using those browser controls; the in-app exit protection does not
cover every browser-history exit.

Browser acceptance used only the dedicated fixture and blocked all mutating
requests, service workers and provider writes. It does not verify real payments,
Meta publishing, generation, all subscription states, native-phone keyboards,
or successful rendered creative output. Blocked preview POST requests can show
Updating preview or Failed to fetch, and fixture thumbnails were unavailable.
Those are not presented as successful preview-rendering acceptance.

## Provenance, evidence and rollback

- Source: `/projects/blockwise-mobile-app-20260908`, branch
  `feat/mobile-app-20260908`. Its follow-up HEAD may be newer than the serving
  application SHA because of this record and selector corrections only.
- Image: `blockwise-app:77a89d270f65ca0561ebc90214cb401700ce3825`.
- Image ID: `sha256:a0d5ca02de38afc0e5538cc3ba1b3cf54935ff4e97ff2f3e10496c98dd071280`.
- Checks, canary/live browser evidence and geometry screenshots:
  `/srv/blockwise/e2e-runs/mobile-app-implementation-20260908/`.
- Guarded release helpers: `/srv/blockwise/mobile-app-release-20260908/`.
- Retained immediate rollback image:
  `blockwise-app:f972e44d4ee1a47c1602e1427883835512240fce`.
- Protected pre-release environment backup:
  `/srv/blockwise/mobile-app-release-20260908/product.env.before-77a89d270f65`.
- The task-owned loopback canary is retired after acceptance. Source, release
  evidence, protected backup and live/rollback images are retained.
