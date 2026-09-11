# Blockwise production readiness

## Current verification authority

Use Current runtime, Health gate and Separate gates below for verification.
Read the compiled revision from live health and verify the intended full SHA
with the product-health script. Dated releases below are historical evidence,
not a fixed current release. [The index](../README.md) selects other procedures.

## Automatic deployment of main

`blockwise-autodeploy.timer` polls `origin/main` every 60 seconds and releases
any new revision through `blockwise-autodeploy.service`. The unit runs
`/usr/local/sbin/blockwise-autodeploy`, which prepares the immutable image and
then deploys it with `scripts/vps/product-release.sh`.

A release never reads a working tree. The script builds a worktree of the exact
commit under `/srv/blockwise/releases/product/<sha>` and releases from there, so
no uncommitted edit in any checkout can block or alter a release. A dirty
canonical tree used to stop every deploy; it no longer can.

This keeps the guarantees that make rollback possible. A released revision is
still pinned to one commit, the release worktree must be detached, clean and at
that commit, and `BLOCKWISE_ENABLE_PROVIDER_WRITES` must stay `false`. Deploying
uncommitted source is still refused. `BLOCKWISE_RELEASE_SOURCE` names the tree a
release reads from and is rejected unless it is a worktree of
`/projects/blockwise` inside release storage.

Logs: `/srv/blockwise/releases/autodeploy.log`. Check the live revision with
`curl -fsS https://blockwise.sale/api/health`. To release by hand, use the same
script with `--prepare` then `--deploy`; see
[rollback](rollback.md) before reverting a revision.

## Keeping the checkout clean

Two mechanisms stop the shared checkout filling with other sessions' work.

`scripts/githooks/pre-commit` refuses to commit a file that was last modified
before the current session started, because such a file cannot be this session's
work. It records the session start once per checkout. Set
`BLOCKWISE_ALLOW_OLD=1` for a deliberate exception. Install it once per
repository, which covers every worktree:

```bash
git -C /projects/blockwise config core.hooksPath /projects/blockwise/scripts/githooks
```

`scripts/vps/cleanup-agent-checkouts.sh` lists dated snapshot checkouts and
removes only those that are fully merged, have no uncommitted work and have been
idle. Run it without arguments to report and with `--apply` to remove. It ignores
generated SNAPSHOT banners and untracked build artifacts, so those never keep a
dead checkout alive, and it never removes a checkout holding unmerged commits or
uncommitted changes.

Release worktrees are bounded separately: `scripts/vps/prune-releases.sh` keeps
the live revision, the rollback revision and the newest five, on a weekly timer.

## Historical candidate (7 September 2026, beta readiness)

The following checkpoint and commands are historical only. They are superseded
by the Single-authority release procedure under Current runtime below.

The coordinated candidate checkout is `/projects/blockwise-beta-release-20260907`.
At the latest validation checkpoint the application code revision is
`7563960ecbc7ac8eb83f679c310029a09a16da26`. The public app remains on
`c02b11e452203a2d54bd278b913f410588ce6ff4`; no application deployment was
performed by this validation task.

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
- No final image was built while product E2E and operations follow-up remained
  in progress.

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
