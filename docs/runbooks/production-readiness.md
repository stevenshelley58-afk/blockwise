# Blockwise Production Readiness

Status: target implemented, live cutover gated (2026-08-29).

The owner-approved product target is the self-hosted VPS stack defined by
`infra/coolify/docker-compose.product.yml`: Caddy, the Next standalone app,
GoTrue, PostgREST, PostgreSQL, Storage API, optional Realtime, and the durable
worker. The compose foundation is present in the repository; this does not
claim that the public DNS has been cut over. Until the gates below are signed
off, the previous managed endpoint remains available only as a rollback source.

Core product readiness is intentionally independent of external AI and ad
network credentials. Login, workspace access, Ad Studio editing, rendering,
and durable saves use the self-hosted database/auth/storage services and must
boot with `OPENAI_API_KEY`, `META_APP_ID`, and `META_APP_SECRET` unset. Those
values are optional provider gates: `/api/health` reports their individual
missing/invalid status under `readiness.providers` without marking the core
deployment unhealthy. Configure real values only when enabling the relevant
provider; never use example or fake credentials.

## Current verification authority

Use Current runtime, Health gate and Separate gates below for verification.
Read the compiled revision from live health and verify the intended full SHA
with the product-health script. Dated releases below are historical evidence,
not a fixed current release. [The index](../README.md) selects other procedures.

## Historical candidate (7 September 2026, beta readiness)

The following checkpoint and commands are historical only. They are superseded
by the Single-authority release procedure under Current runtime below.

The coordinated candidate checkout is `/projects/blockwise-beta-release-20260907`.
The deployed application revision is
`f972e44d4ee1a47c1602e1427883835512240fce`, built from the clean release
checkout and now serving publicly. The immutable image manifest is
`sha256:65255dc9e9eb87fbdb3f7716c5f5b16101bf449dd4a3eb31e823af057a064587`.

Release scaffolding is isolated under `/srv/blockwise/beta-release-20260907/`:
`build-image.sh` builds an immutable SHA-labelled image, `deploy-app.sh` keeps
the expected-live, ancestry, clean-source, image-label, protected-env, and
provider-write guards, and `rollback-app.sh` is the guarded app-only rollback
command. Before any rollback, export the current serving SHA and use a retained
image only:

```bash
export EXPECTED_LIVE_REVISION=$(curl -fsS https://blockwise.sale/api/health | jq -er .revision)
/srv/blockwise/beta-release-20260907/rollback-app.sh --revision <retained-full-sha> --apply
```

The protected product environment was not changed. `BLOCKWISE_ENABLE_PROVIDER_WRITES`
remains `false`, and no provider writes, customer-data mutations, payments,
OAuth writes, email sends, worker restart, or Caddy restart were performed.

### Validation checkpoint

- `npm run check:nul`: passed, scanning 1,036 text files.
- Root `npm test`: 910 passed, 0 failed.
- Package tests: 124 passed, 0 failed, 2 skipped out of 126. The skips are the
  lifecycle comparison test and the root-only unwritable-directory typecheck
  test. No package test failed.
- `npm run typecheck -- --pretty false`: passed after package builds; no diagnostics.
- Final image build succeeded and app-only deployment completed. Public
  `/api/health` reports `status=ready` and the exact deployed revision above.
- Product canary persistence smoke returned `SAVE_REOPEN_OK` for the explicitly
  seeded E2E workspace, including Feed/Story hashes and exact edited-text
  reload. This is not fresh signup or external-provider proof.

### Historical candidate gates (superseded)

1. Re-run `check:nul`, the complete test suite, typecheck, and build from the
   final clean candidate SHA. Resolve the package navigation expectation or
   document an approved intentional update.
2. Run `/srv/blockwise/beta-release-20260907/build-image.sh --revision <sha>
   --source /projects/blockwise-beta-release-20260907` only after coordinated
   code and E2E acceptance. Verify the OCI revision label and retain build log.
3. Set `EXPECTED_LIVE_REVISION` to the freshly verified `/api/health` revision
   and use `deploy-app.sh --revision <sha> --apply`. It is app-only and must
   preserve the protected environment fields.
4. Run the candidate health check and smoke evidence. Provider writes remain
   disabled unless separately approved with an exact workspace allowlist.
5. Record external Meta OAuth/deauthorize/partner-account and Stripe evidence
   separately. Fixture tests do not prove external account configuration.

## Historical release (6 September 2026, billing and trial)

The public app serves `f35a041563d4c5e257e323a97f851ec8c447fb3b` from
`blockwise-app:f35a041563d4c5e257e323a97f851ec8c447fb3b`. This release ships
the no-card 14-day trial anchored to first Meta-reported delivery, ad-pack
credit consumption, and hardened Checkout, with migration
`20260906010000_no_card_trial_delivery_start.sql` applied. See the
[release record](../releases/2026-09-06-billing-trial.md) for checks, the
rehearsal evidence, live-Stripe verification scope, and the retained
bc2b1f3b rollback image. No test-mode payment flows were run (no test
credentials in the deployment environment), and no customer was charged.

The earlier same-day release `3b2770eb4dec62217589b074be999ae9fa9fda06`
(template editor and customer usability) remains recorded below.

## Historical release (6 September 2026, template editor and customer usability)

The 6 September release served `3b2770eb4dec62217589b074be999ae9fa9fda06` from
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


The application may use `@supabase/supabase-js` as a protocol client only. It
must point to the self-hosted Caddy origin through `NEXT_PUBLIC_SUPABASE_URL`;
the client library must not be read as evidence that a managed Supabase
runtime is part of the target architecture.

The shared VPS already has Frank's `frank-caddy` edge on host ports 80/443.
Product Caddy is loopback-bound and profile-gated; before enabling its `edge`
profile, persistently attach `frank-caddy` to the external `blockwise-product`
network in Frank's Compose/service definition and add the product hostname host
route to `product-caddy:80`. A one-off `docker network connect` is not a
completed deployment prerequisite.

Current operational references: [OSS migration](oss-product-migration.md),
[VPS SSH](vps-ssh.md), [worker deploy](vps-worker-deploy.md), and
[rollback](rollback.md). Historical managed deployment notes are intentionally
not linked as current runbooks.

## Evidence and release commands

Run runtime checks on the controlled VPS hostname through Caddy. Do not use a
local dev server as launch evidence. The old managed deployment is a rollback
source, not the acceptance target.

| Command | Purpose |
| --- | --- |
| `docker compose --env-file /srv/blockwise/product/.env -f infra/coolify/docker-compose.product.yml --profile edge --profile realtime config --quiet` | Validate the rendered product Compose contract without printing secrets (the worker profile remains omitted) |
| `docker compose ... --profile realtime up -d --no-build --pull never product-db product-rest product-auth product-storage` | Start base services for GoTrue/Storage bootstrap; apply product migrations and reload PostgREST before starting the app/edge |
| `scripts/vps/product-health.sh` | Check Compose state and JSON `/api/health` readiness through the configured hostname and shared Frank edge |
| `scripts/vps/product-post-deploy.sh` | Run the health gate, then request Frank's fixed-input fast/full reconciliation without coupling release health to control-plane availability |
| `scripts/vps/product-backup.sh <directory>` | Capture database dump, globals, exact row counts, and SHA-256 manifest |
| `scripts/vps/product-checksums.sh <directory>/SHA256SUMS` | Verify backup artifacts and print current exact row counts |
| `npm run check:nul`, `npm run typecheck`, `npm test`, `npm run build` | Run repository release gates before building app/worker images |
| `scripts/vps/product-row-counts.sh` | Reconcile public, auth, storage, and private schema counts |

The product scripts read the rendered env through
`BLOCKWISE_PRODUCT_ENV_FILE=/srv/blockwise/product/.env`; never print or
commit that file. The worker release must also pass the preflight in
`docs/runbooks/vps-worker-deploy.md`.

## Foundation already implemented

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

## P0 - Required before live cutover

- [ ] Provision the product VPS and render `/srv/blockwise/product/.env` from
  the example with real secrets injected by the approved secret manager. Use
  distinct JWT, Realtime, PostgREST authenticator, database, and token-
  encryption secrets as documented by the migration runbook.
- [ ] Resolve app/worker/base-service image tags to approved immutable digests;
  record each digest with the full Git SHA and build date.
- [ ] Run the Compose config check and health check with Caddy TLS, then run
  app smoke tests for signup/login/recovery, workspace switching, invitations,
  RLS denial across workspaces, RPC queue operations, private object
  upload/download, and Realtime or polling invalidation.
- [ ] Capture the source database dump, globals, GoTrue-compatible Auth export
  (including unchanged UUIDs, identities, password/recovery metadata), bucket
  metadata, and five-field object manifest outside the repository.
- [ ] Rehearse the complete import on disposable product volumes. Apply only
  the allowlist in `infra/product/product-migrations.txt`; never import
  Hermes/research migrations into the product database.
- [ ] Reconcile exact row counts, Auth UUIDs, object checksums/bytes/MIME, and
  migration receipts with the source export. Keep the old endpoint and all old
  volumes untouched during the retention window.
- [ ] Verify the controlled VPS hostname end to end: OAuth callback URLs,
  SMTP/recovery, Meta connect/disconnect, provider token vault access, Ad
  Studio generation, paused publish flow, leads, billing fallback, health,
  alerting, and deletion behavior.
- [ ] Keep `BLOCKWISE_ENABLE_PROVIDER_WRITES=false` on the app and omit the
  worker through the canary. Enable provider writes and start the worker only
  as a separate, approved cutover gate after publish and human-approval checks
  pass; an offline worker preflight is not canary readiness.
- [ ] Freeze writes, take the final export, switch DNS and external callbacks,
  and only then enable the reviewed worker/provider-write posture. Record the
  exact cutover time and release SHA.

Frank template packs and Hermes research remain separate systems. The sole
maintained application source is `/projects/blockwise` on `main`, tracking
`origin/main`. Production is released only from the same full Git SHA in a clean
immutable checkout at `/srv/blockwise/releases/product/<full-sha>`. A feature
checkout or an archive branch is not a deployment source. Root `vercel.json`
disables Git-triggered Vercel deployments; retired managed-hosting integration
statuses are not production release gates. Release provenance
must match canonical HEAD, remote main, immutable checkout, image label, selected
environment revision and the public compiled revision.

### Single-authority release procedure

Use `scripts/vps/product-release.sh` as the only normal app release entry point.
It serializes releases, refuses source drift, builds an immutable image, and
requires a passing repository/canary acceptance receipt before activation.
From `/projects/blockwise`, run `scripts/vps/product-release.sh --prepare`
to fetch and build the current verified main candidate. After the checks and
controlled canary pass, run `scripts/vps/product-release.sh --deploy <full-sha>
--receipt <absolute-receipt.json>` on one line. The bounded receipt contains
exactly `sha`, `canary_pass: true`, and `repository_checks: "pass"`; retain the
actual detailed logs and any explicit skipped-test reasons separately. Run
`scripts/vps/product-release-preflight.sh <full-sha> --check-live` to verify the
source/image/live chain without changing it. Preparation does not change
production. Activation recreates only the application service; database, Auth,
Storage, Caddy, worker and provider activation remain separately gated changes.

Run the repository gates below against the candidate. Verify the candidate in
one isolated controlled canary with outbound credentials disabled, then record
its exact SHA and passing checks in the acceptance receipt. Do not fabricate a
receipt or treat a build alone as customer acceptance. The release script checks
the selected image and source again immediately before activation. Post-release
verification must compare `/api/health` with the same full SHA and image label.
A failed activation restores the prior environment and app selection; preserve
the prior image and immutable source until the rollback window closes.

The normal source must not stay intentionally divergent from production. A
short-lived candidate between verified preparation and activation is expected;
unreleased work remains on a feature branch, not on a competing canonical
checkout. A failed release is an incident with an explicit retained baseline,
not a reason to resume ad-hoc worktree deployments.

- [ ] Validate tenant isolation and RLS on every customer path, including
  storage paths, server RPCs, queue payloads, exports, and agent boundaries.
- [ ] Verify Meta App Review, Graph API version, permissions, OAuth, paused
  campaign creation, approval-gated activation/budget changes, and provider
  failure handling with a real test business.
- [ ] Verify signup abuse controls, legal pages, Australian privacy/marketing
  obligations, CSP/HSTS/CSRF/rate limits, operator access controls, and
  deletion/backup retention behavior.
- [ ] Verify durable worker jobs for Meta publish/mutation, lead sync/delivery,
  reporting refresh, token health, provider sync, Ad Studio recovery, retries,
  lease heartbeat, and failure visibility. Scheduled enqueueing is a separate
  VPS scheduler/webhook gate; it is not a Vercel requirement.
- [ ] Configure Sentry, audit drain, email/WhatsApp alerts, off-host encrypted
  backups, and incident ownership. Keep Hermes/Apify credentials only in the
  Hermes runtime and keep Frank/Hermes research data separated.
- [ ] Run desktop and mobile acceptance tests against the controlled VPS
  origin, then repeat the critical smoke checks after DNS cutover.

## Final sign-off record

- [ ] Product VPS hostname and Caddy certificate recorded.
- [ ] Product app/worker image digests, full Git SHA, and deployed timestamp
  recorded.
- [ ] Source export, Auth import receipt, object manifest, backup checksum
  manifest, and exact row-count comparison recorded.
- [ ] DNS, SMTP, OAuth callbacks, webhooks, scheduler, and provider-write
  changes recorded as separate reviewed gates.
- [ ] `BLOCKWISE_ENABLE_PROVIDER_WRITES=true` approved after the canary, with a
  named incident owner and tested rollback.

## Definition of live

Blockwise is live only when the self-hosted product stack serves the intended
public DNS through Caddy, all P0 checks and sign-off evidence are complete,
the final data reconciliation passes, and provider writes are deliberately
enabled. A healthy Compose deployment or a completed migration rehearsal alone
does not mean cutover is complete.
