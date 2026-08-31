# Release Reconciliation — production release line vs canonical main

Status: **INCOMPLETE — reconciliation required.** The running production
release is NOT built from canonical `main`. PR #383 must not merge until the
release branch below exists and all new CI checks pass.

## Production runtime receipt (2026-08-31, host srv1625369)

Evidence collected from the running containers and registry on the VPS, not
from any checkout directory:

| Field | Value |
| --- | --- |
| Production stack | `blockwise-product` compose stack on `srv1625369` (100.78.126.112), edge via `blockwise-product-product-caddy-1` |
| Running image | `blockwise-app:350efcee487e765c61c205ccb42b7099e03f9ac2` |
| Image digest | `sha256:f98c607b49e9328b6a371751d66822af0e3ce441cf4d418292e689fc5675f201` (image created 2026-08-30T16:36:44Z) |
| Source SHA of running image | `350efcee487e765c61c205ccb42b7099e03f9ac2` ("fix(renderer): respect vertical line geometry") — branch `codex/direct-meta-publish-persistence` |
| Source checkout on host | `/opt/releases/only-process-blockwise-350efcee` (release dirs, not a dirty tree) |
| `350efcee` vs `origin/main` | **NOT an ancestor of main.** merge-base is `544134a6`. Production has 5 commits main lacks; main has commits production lacks. |
| Health result | `/api/health` → `200 {"app":"blockwise","status":"ready"}` (2026-08-31; compose healthcheck green, container `healthy`) |
| Database | self-hosted Postgres 17.6 (`blockwise-product-product-db-1`), db `blockwise`, 122 public tables |
| Migration ledger | `blockwise_product_migration_ledger`; latest applied `20260830050000_adstudio_manual_colour_mode.sql` at 2026-08-30T14:13:45Z |
| Configuration | `/opt/releases/only-process-blockwise-350efcee/infra/coolify/docker-compose.product.yml` sha256 `20706487e7a684968a0a417ba5f170713686415c48690acf58651a71fcfaa71e`; Caddy config sha256 `a11467e5430b9294b98f349bc173853c87f49370801f85124ffdf47fe73b3b02` |
| Backup receipts | `/srv/blockwise/backups/20260830T051532Z` (`database.dump`, `globals.sql`, `row-counts.json`, `SHA256SUMS`); pre-deploy backups `pre-935a61d-20260830T091014Z`, `pre-only-process-20260829T222306Z` |
| Rollback target | image `e7719a9c` (`blockwise-app:e7719a9c…`, id `56dfdf5fa42c`, built 2026-08-30T15:06Z) — present on host |

Note: `docs/runbooks/vps-ssh.md` states the public app deploys through Vercel.
The running production runtime observed on 2026-08-31 is the self-hosted
compose stack above. The runbook needs updating to match reality.

## Reconciliation work required (blocking Phase 0 exit)

The deployed line `350efcee` and canonical `main` have diverged:

- Production-only commits (on `codex/direct-meta-publish-persistence`, not on
  `main`): `350efcee`, `e7719a9c`, `9d54f9fc`, `41c508b8`, `d2878c04`.
- `main` has at least `e16febfa` plus prior history not in the production image.

Required action: a protected release branch that merges `350efcee` (or its
equivalent cherry-picked content) with `origin/main`, with tests resolving any
conflicts, no deployed capability dropped, and a fresh deploy + receipt from
the merged result. Until that deploy happens, the manifest fields for the NEW
release stay pending and the running stack above remains the last-known-good.

## Earlier (superseded) checkout-level verification

A checkout-level check on 2026-08-31 verified `/projects/ad-template-builder-release`
detached at `e6770c6…` equal to then-`origin/main` (0/0 divergence). This
proved checkout ancestry only — it did not describe the running container, and
is superseded by the runtime receipt above. It is retained for the audit trail.

## Main worktree intentionally behind

The `/projects/blockwise` main worktree intentionally remains behind
`origin/main` because it holds unrelated staged user work — the
`frank/template-factory` deletions plus local editor-handoff commits. That
work is out of scope for this reconciliation and must not be touched,
committed, or reverted by release automation. It will rejoin canonical main
through its own review path.

## PR #383 status

PR #383 currently contains only the four documentation files. The CI workflow
commit (`6c1c691f`, `.github/workflows/ci.yml`) is queued locally on
`release/reconcile-production-main` but was NOT pushed: the stored PAT had
`repo` scope only and GitHub rejects workflow-file pushes without `workflow`
scope. The exposed PAT was removed from the local credential store on
2026-08-31 and must be revoked by the account owner. A replacement token with
`repo` + `workflow` scopes is required to push the workflow commit and update
the PR. **Do not merge until the workflow commit is included and the `Build
and test`, `Secret scan`, `SBOM` and `Container scan` jobs pass.**

## Required status checks (enable via admin API)

Once a token with admin API access is available, protect `main` with:

- Require pull requests (no direct pushes), disallow force pushes, block
  merging with unresolved reviews or failing checks.
- Required checks: `Build and test`, `Secret scan`, `SBOM`, `Container scan`
  (`.github/workflows/ci.yml`), `Contract and static checks`,
  `Database migration and pgTAP checks` (`.github/workflows/hard-reset-verification.yml`).

Until enabled, the reconciliation receipt above plus green CI runs on the
release branch are the release gate of record.
