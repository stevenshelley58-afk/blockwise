# Release Reconciliation — production release line vs canonical main

Status: recorded. This document is the reconciliation receipt for the
production release line against canonical `origin/main`.

## Receipt

| Field | Value |
| --- | --- |
| Reconciliation date | 2026-08-03 |
| Deployed checkout path | `/projects/ad-template-builder-release` (detached HEAD, clean tree) |
| Deployed SHA | `e6770c6c6f7f56e311761804796798231bc70a6b` ("Harden Ad Studio editor and v2 Story templates (#360)") |
| origin/main SHA at initial verification | `e6770c6c6f7f56e311761804796798231bc70a6b` — identical to deployed; divergence 0 commits ahead / 0 commits behind |
| origin/main SHA at reconciliation time | `e16febfa678ef895e1ade011c82404c8a83ffdc0` ("feat(ops): request Frank reconciliation after deploy") |
| Divergence at reconciliation time | 0 commits ahead / 64 commits behind — `origin/main` advanced by fast-forward only; `e6770c6` is a direct ancestor of `e16febfa` |
| Capability dropped | None. No capability was dropped by the reconciliation; the deployed release line contains nothing that canonical main lacks. |

The deployed release line and canonical main agree: production runs committed
source from git, and the release branch can fast-forward to `origin/main` at
any time without a merge or rebase. The 64 commits main gained during the
reconciliation window are ordinary forward work on the same line; they do not
diverge from what production runs.

## Main worktree intentionally behind

The `/projects/blockwise` main worktree intentionally remains behind
`origin/main` (verified 71 commits behind at reconciliation time) because it
holds unrelated staged user work — the `frank/template-factory` deletions.
That work is out of scope for this reconciliation and must not be touched,
committed, or reverted by release automation. It will rejoin canonical main
through its own review path.

## Required status checks (enable manually)

Branch protection cannot be changed without the admin API. A repository admin
should mark the following checks as required for `main` (exact check names as
registered by the workflows):

- `Build and test` (`.github/workflows/ci.yml`)
- `Secret scan` (`.github/workflows/ci.yml`)
- `SBOM` (`.github/workflows/ci.yml`)
- `Container scan` (`.github/workflows/ci.yml`)
- `Contract and static checks` (`.github/workflows/hard-reset-verification.yml`)
- `Database migration and pgTAP checks` (`.github/workflows/hard-reset-verification.yml`)

Until these are enabled, the reconciliation receipt above plus the CI runs on
this branch are the release gate of record.
