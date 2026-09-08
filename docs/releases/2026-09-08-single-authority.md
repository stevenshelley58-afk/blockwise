# Single application authority, 8 September 2026

Status: reconciliation record. Deployment/check outcomes are recorded in the
protected release receipt under `/srv/blockwise/reconciliation/20260908-single-authority/`.
This document does not claim a candidate passed before that receipt exists.

## Baseline and decision

The existing public app and its image/compiled labels served
`de606ac66fe917ce9c0dd7ba6a86ef3a37ab8ecd`. The root checkout was
`e39e5a4f43be2ef3431e31970f09d7e22bfb9b07`; remote main was
`f56dc2a4a88e763a4358a192214f7606b706ccaa`. Remote main and live had
167 and 171 unique commits respectively. Root checkout was behind live.

Steven requested one authoritative application version before continuing the
UI audit. The reconciliation preserves the exact deployed application behavior,
not a blind functional merge of unreleased infrastructure. A normal two-parent
merge retains both histories with the deployed tree selected explicitly. No
force push or published-history rewrite is used.

The old main's customer-ops/Chatwoot/Mautic foundation, Stalwart mail foundation,
and associated migration/security plumbing remain preserved as unreleased work.
They were not running customer capabilities and must not be activated merely to
make branch histories agree. Accepted future work must be reconciled deliberately
onto the current `main`, with its own gates and migration evidence.

## Retained evidence and unfinished work

- `archive/main-before-single-authority-20260908`: previous remote main.
- `archive/canonical-before-single-authority-20260908`: previous root checkout.
- `archive/live-before-single-authority-20260908`: existing verified live release.
- `/srv/blockwise/reconciliation/20260908-single-authority/before.json`: exact
  prior references and hashes of pre-existing uncommitted documents/artwork.
- The same protected directory retains the bounded document backup, original
  patch, stash identifier, previous environment, check logs and release receipt.
- Existing artwork under `/projects/blockwise/adstudio/` is retained untouched
  and is not included in the immutable release build context.
- Owner product preferences and dated lead-management evidence are preserved.
  Live DESIGN.md already contains the owner preferences plus newer Home-scoped
  rules, so neither is discarded to resolve the stale-checkout conflict.
- Immediate rollback source is retained at
  `/srv/blockwise/releases/product/de606ac66fe917ce9c0dd7ba6a86ef3a37ab8ecd`
  with image `blockwise-app:de606ac66fe917ce9c0dd7ba6a86ef3a37ab8ecd`.
- Existing feature worktrees and active isolated design previews are retained.
  They are not application source authorities or direct deployment candidates.

## Going forward

`/projects/blockwise` on `main` and `origin/main` are the sole maintained source.
The release process builds that exact revision from a clean immutable checkout,
requires repository and controlled-canary acceptance, checks image and compiled
provenance, and changes only the app service. Rollback keeps an immutable prior
release and must be recorded as an incident.

The paused UI audit created no mock users, rows, workspace, storage objects or
provider/email activity before reconciliation started.

## Retired automatic hosting

PR validation exposed a still-connected Vercel Git integration launching builds.
The root `vercel.json` now sets `git.deploymentEnabled` to `false`, with a
regression test. This prevents new Git-triggered deployments for the consolidated
source; it does not delete historical provider deployments or customer data.
The optional Supabase Preview integration reported a failure; it is not one of
the two required repository checks or the maintained production database.

## Inherited verification repairs

Required CI exposed two baseline issues. The contract runner now installs
FFmpeg/ffprobe so media archive tests exercise real video validation. Research-only
migrations and database tests are restored to their separate research ownership
paths, reusing the narrow isolation corrections preserved in old main. These are
repository/CI corrections, not live database migrations or feature changes.
