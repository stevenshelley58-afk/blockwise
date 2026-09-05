# Blockwise production readiness

## Current release (6 September 2026)

The public app serves `3b2770eb4dec62217589b074be999ae9fa9fda06` from
`blockwise-app:3b2770eb4dec62217589b074be999ae9fa9fda06` (image ID
`sha256:f787e10b3dc8cbf8e4213393a9e96907d3f30c2b8c0fc54c30d436c4b5c0689a`).
This app-only release combines the focused lead-first usability cleanup with
the coordinated template-editor fixes. The hero and design system are unchanged.

Integrated checks passed: 924 tests, NUL check, typecheck and production build;
the final test-only locator correction was rebuilt and passed six canary and
six public browser tests with no skips. See the [release record](../releases/2026-09-06-template-editor.md)
for evidence, the retained d39771a9 rollback image/environment, and limitations.
Provider writes remain disabled and the worker remains omitted. This is not
acceptance of real Meta publishing, SMTP, billing, or a template's quality.

Earlier records below are historical, not the current deployment identity.

## Historical: template font release (5 September 2026)

That release served revision
`d39771a94134c28081185bcf93a8d5e1947a39a4`, built with the protected
environment's public build configuration (not placeholder login keys).
Template-declared fonts use authenticated asset URLs, template/file-scoped
font families, and retryable loading. Every Design/Feed/Story/detail canvas
receives the same asset declarations. Blockwise's existing styling is unchanged.

Checks: typecheck passed; nine focused editor/font tests passed; authenticated
customer-navigation Playwright passed five tests on the isolated canary and
five on production, none skipped. Product health verified the exact serving SHA.
This is editor/runtime acceptance, not visual approval of a generated template.
Previous app `7af704c66343cd53e580e306b5d7fbf4b6657bc9` remains the rollback.

### Historical cleanup deployment

That cleanup served application revision
`7af704c66343cd53e580e306b5d7fbf4b6657bc9` (image
`blockwise-app:7af704c66343cd53e580e306b5d7fbf4b6657bc9`, image ID
`sha256:16b2c6f5b50d77f47f3cf2d81ab12948d2330e2ba543cbb59e872a942d52ac0b`),
deployed app-only on 2026-09-05 from the cleanup that started at live revision
`6f2f92eadc9d7d3b502917d0f59c11c1ed01b1e7`.
This is not sign-off for provider writes, SMTP, billing, Meta App Review, or
data migration.

## Historical cleanup evidence (2026-09-05)

- Repository gates: `npm run check:nul`, `npm run typecheck` exit 0; full
  `npm test` 908 tests, 908 pass, 0 fail (833 root + 54 + 11 + 10 package
  suites), 0 skips. Logs under `/srv/blockwise/e2e-runs/cleanup-20260905/`.
- Mobile layout fix: `/self-serve` clipped cards/text at 320–390px because a
  truncated quick-action subtitle inflated template-less auto grid tracks to
  418px inside `<main>` (`overflow-x: clip` hid it from
  `documentElement.scrollWidth`). Fixed with explicit `minmax(0, 1fr)` tracks
  and a shrinkable quick-action link.
- Canary: `blockwise-app:7af704c6...` built from the exact committed SHA,
  served at the loopback-only `https://blockwise.sale:19443` with an internal
  certificate; `/api/health` reported the compiled revision.
- Authenticated Playwright QA (`e2e/customer-navigation.spec.ts`, chromium):
  5 tests passed, 0 failed, 0 skipped, on the canary (controlled-certificate
  exceptions) and again on the public route with normal TLS. Workspace PATCH
  and country-change requests remained mocked; no real data was mutated.
- Mobile layout regression evidence: at 320px and 390px the spec asserts
  `main.scrollWidth <= main.clientWidth` and that every visible card/control
  rectangle fits inside `main` (elements in designed horizontal scroll
  containers exempt), with fonts/hydration/count-up settled, consent chosen
  via "Essential only", and the bottom mobile nav visible and tappable.
  Screenshots (authenticated Home + Settings at 320px, 390px, desktop) are
  under `/srv/blockwise/e2e-runs/cleanup-20260905/canary-qa/`; pixel-edge
  analysis shows content ending exactly at the 16px page padding on mobile.
  Note: the agent-side image viewer was unavailable (WASM defect) during the
  release, so screenshots were verified by DOM-rectangle assertions,
  pixel-edge analysis, and OCR text checks; the reviewing agent subsequently
  inspected all six screenshots directly and confirmed the previous mobile
  clipping is resolved.
- Public verification: `BLOCKWISE_PRODUCT_ENV_FILE=/srv/blockwise/product/.env
  scripts/vps/product-health.sh 7af704c66343cd53e580e306b5d7fbf4b6657bc9`
  passed, and `https://blockwise.sale/api/health` serves that revision.
- Rollback reference, in order:
  - Immediate previous release `1b50a52f74a7c31ece3cdc02e6a066aae751ccf5`
    (image `blockwise-app:1b50a52f74a7c31ece3cdc02e6a066aae751ccf5`,
    `sha256:4d28b9c5bd10ac343bb48744a77818969e9a86456e500c2ea9b7374df9a90281`);
    its protected-env backup is `release/product.env.before-7af704c66343` in
    `/srv/blockwise/e2e-runs/cleanup-20260905/`.
  - Older baseline fallback `6f2f92eadc9d7d3b502917d0f59c11c1ed01b1e7`
    (image `blockwise-app:6f2f92ea`,
    `sha256:46747c11fa666df18af2794df464c68b67bccbe666b9bda9a21353ca5bd86e6b`),
    retained source `/projects/blockwise-release-6f2f92ea`; its protected-env
    backup is `release/product.env.before-1b50a52f74a7`.
  See [rollback](rollback.md).
- The serving checkout `/projects/blockwise-cleanup-20260905` is committed and
  clean; its HEAD is a docs-only evidence commit directly after the serving
  SHA, not a new application build. `main` remains deliberately divergent from
  live (customer-ops work and migrations on main; newer AdStudio changes on
  live); reconciliation is not part of this release.

## Current runtime

The live target is the self-hosted VPS Compose stack behind the shared Frank
Caddy edge: Next standalone app, PostgreSQL, PostgREST, GoTrue, Storage API,
optional Realtime, and a separately gated durable worker. The worker stays
omitted while `BLOCKWISE_ENABLE_PROVIDER_WRITES=false`. Supabase client
packages are protocol clients pointed at the product Caddy origin.

Frank template packs and Hermes research remain separate systems. The main
branch contains divergent customer-ops work and is not an automatic deployment
source. Release provenance must identify the exact full Git SHA and image.

## Health gate

Run from the committed VPS checkout:

    export BLOCKWISE_PRODUCT_ENV_FILE=/srv/blockwise/product/.env
    scripts/vps/product-health.sh <expected-full-git-sha>

Use the full SHA of the candidate release. The script checks the
Compose state, Caddy ingress, JSON `/api/health` readiness, and compiled
revision. Releases before this cleanup do not expose the compiled revision;
for those rollback images, verify the container image ID and retained source
SHA explicitly instead. A no-argument invocation checks readiness only and is not provenance
evidence.

Repository gates are `npm run check:nul`, `npm run test`, `npm run typecheck`,
and `npm run build`. All project work runs on the VPS. Dev-server checks are not release acceptance.

## Separate gates

- Provider writes and worker activation require explicit approval and a tested
  publish path; health-ready does not prove either.
- SMTP/recovery, OAuth callbacks, billing, webhooks, scheduler, and DNS changes
  require their own evidence.
- Migration requires source exports, Auth/object manifests, rehearsal receipts,
  row-count reconciliation, and rollback retention. The repository alone is
  not a production backup.
- Tenant isolation, RLS, storage paths, queue scope, deletion, and provider
  token-vault boundaries remain release requirements.

See [docs/README.md](../README.md), [VPS SSH](vps-ssh.md), and [rollback](rollback.md).
