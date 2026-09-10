# Customer app UX release (8 September 2026)

This app-only release served
`cdc4de9c40f8d92ff3a61cf93d2a141acea15b0b` from immutable image
`blockwise-app:cdc4de9c40f8d92ff3a61cf93d2a141acea15b0b` (image ID
`sha256:e9427e9b963673843baa22b2c51103ad3f0cf675396c3e6dca0aae0d1dccff07`).
It started from live baseline `674b512139961927191f3659a64737a2e0db1cdd`.
This is dated historical evidence, not a permanently current revision claim.

## Customer changes

- Unified customer navigation and names around Ads, Results, Leads and More on
  desktop and mobile, without changing the public homepage.
- Reworked Ads into a compact starting point; templates and inspiration remain
  browseable libraries. Missing or failed data now has honest recovery states.
- Reworked Brand Pack around the live preview and next blocker. Logo, colours,
  fonts, voice, identity and compliance details expand only when needed.
- Kept the editor focused on the creative, with compact Photos, Content, Style,
  Layers and Preview controls and a bounded mobile layout.
- Split publishing into four clear stages with stage-specific validation,
  persistent values and recoverable Feed/Story downloads.
- Put Ad Radar search and filters before results, preserve query/back state, and
  use focused detail views and reliable image fallbacks.
- Made Results truthful when Meta is disconnected. Example data is explicit;
  live reporting leads with three key numbers, priority results and one
  switchable chart. Reporting and campaign controls are collapsed by default.
- Kept Leads connection-aware and simplified Settings to a category index with
  deep links, browser back behavior and focus restoration.
- Put optional Meta setup detail behind disclosure while keeping the essential
  connection step visible.
- Removed duplicate main-content landmarks from customer loading states.

## Safety boundaries

- No public homepage redesign, database migration, pricing, credits, billing
  data, provider gates or deletion safeguards were changed.
- Existing palette, fonts, shadcn patterns, navigation restrictions, and focused
  editor behavior remain the design baseline.
- Browser acceptance used the controlled authenticated fixture and blocked
  non-read-only requests. No real saves, invites, connections, publishing or
  deletion requests were performed.
- `BLOCKWISE_ENABLE_PROVIDER_WRITES=false`; the product worker remained omitted.
  SMTP, billing and real Meta publishing were not enabled or accepted here.

## Verification

- Repository gates: NUL check, typecheck and production build passed; full test
  suites reported **1,082 passed**, **0 failed**, with two documented
  environment-dependent skips.
- Controlled canary browser acceptance: **29 passed**, **0 failed**, one
  market-bound fixture skip. It covered 320, 375, 390, 414, 768 and 1440 pixel
  widths, double-size zoom, navigation, Ads, templates, libraries, Brand Pack,
  editor, publishing, Radar, Results, Leads, Settings and Meta setup.
- Public normal-TLS browser acceptance on the final revision: **29 passed**, **0
  failed**, one market-bound fixture skip. The suite included the canonical
  read-only creative preview, both-format download recovery and page-fit checks.
- Public health verified the exact compiled revision
  `cdc4de9c40f8d92ff3a61cf93d2a141acea15b0b` after app-only replacement.

Evidence, logs, screenshots, the approved review and candidate/rollback records
are retained under `/srv/blockwise/e2e-runs/ux-swarm-20260908/`.

## Release and rollback

Only `product-app` was recreated. Database, Auth, REST, Storage and Caddy stayed
running. The protected environment backup immediately before the final app is
`release/product.env.before-cdc4de9c40f8`; the original live-baseline backup is
`release/product.env.before-b56816d5a308`. The prior immutable app images are
retained for app-only rollback through the active rollback runbook.

The release branch may contain a later documentation-only commit. The serving
application identity remains the compiled revision above.
