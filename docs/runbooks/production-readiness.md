# Blockwise production readiness

Status: controlled production is health-ready. Serving application revision
`1b50a52f74a7c31ece3cdc02e6a066aae751ccf5` (image `blockwise-app:1b50a52f74a7c31ece3cdc02e6a066aae751ccf5`,
image ID `sha256:4d28b9c5bd10...`), deployed app-only on 2026-09-05 from the
cleanup that started at live revision `6f2f92eadc9d7d3b502917d0f59c11c1ed01b1e7`.
This is not sign-off for provider writes, SMTP, billing, Meta App Review, or
data migration.

## Release evidence (2026-09-05)

- Repository gates: `npm run check:nul`, `npm run typecheck` exit 0; full
  `npm test` 908 tests, 908 pass, 0 fail (833 root + 54 + 11 + 10 package
  suites), 0 skips. Logs under `/srv/blockwise/e2e-runs/cleanup-20260905/`.
- Canary: `blockwise-app:1b50a52f...` built from the exact committed SHA,
  served at the loopback-only `https://blockwise.sale:19443` with an internal
  certificate; `/api/health` reported the compiled revision.
- Authenticated Playwright QA (`e2e/customer-navigation.spec.ts`, chromium):
  5 tests passed, 0 failed, 0 skipped, on the canary (controlled-certificate
  exceptions) and again on the public route with normal TLS. Workspace PATCH
  and country-change requests remained mocked; no real data was mutated.
  Desktop, 390px, and 320px screenshots inspected under
  `/srv/blockwise/e2e-runs/cleanup-20260905/canary-qa/`.
- Public verification: `BLOCKWISE_PRODUCT_ENV_FILE=/srv/blockwise/product/.env
  scripts/vps/product-health.sh 1b50a52f74a7c31ece3cdc02e6a066aae751ccf5`
  passed, and `https://blockwise.sale/api/health` serves that revision.
- Rollback reference: previous image `blockwise-app:6f2f92ea`
  (`sha256:46747c11fa666df18af2794df464c68b67bccbe666b9bda9a21353ca5bd86e6b`),
  retained source `/projects/blockwise-release-6f2f92ea`, protected-env backup
  `release/product.env.before-1b50a52f74a7` in
  `/srv/blockwise/e2e-runs/cleanup-20260905/`. See [rollback](rollback.md).
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
