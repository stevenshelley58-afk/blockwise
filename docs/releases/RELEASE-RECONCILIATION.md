# Release Reconciliation — Phase 0 control plan

Status: **INCOMPLETE — no deployment performed** (2026-09-04)

This branch began from `origin/main` at `d0d005ee` and was forward-merged with
the later `origin/main` release at `a2a35bf9`. It does not deploy, replay stale production-only commits, or
assert that a historical runtime receipt describes current main.

## Current known facts

- PRs #386, #387, #395, #396, #397, and #398 are merged into main.
- Draft PR #405 (Stalwart/GoTrue delivery foundation) remains pending.
- The provider-neutral SnagTime contract is merged, but the SnagTime fork,
  deployment, and cutover remain pending.
- Mini Frank is excluded from Blockwise scope.
- The accessible VPS checkout was historically observed at
  `/projects/ad-template-builder-release` on `e6770c6`.
- An older production receipt cites image/source `350efcee`; it is historical
  and unverified. The VPS operator checkout and running image must be audited
  again together. Root Docker access is not available from this environment.

## Required reconciliation before any cutover

1. Freeze the candidate release at a full merged Git SHA and content-audit all
   production-only commits against current main. Do not blindly cherry-pick or
   replay the old `350efcee` line.
2. Compare application content, migration directory, schema, functions/RLS,
   Auth/Storage contracts, Compose/Caddy configuration, and generated/runtime
   assets. Record a migration-directory hash and the target migration ledger.
3. Export the source database/Auth/Storage metadata and private object
   manifest; take a verified backup with checksums before any mutation.
4. Restore the exports on disposable volumes, apply only the reviewed product
   migration allowlist, and reconcile exact rows, UUIDs, policies, schema,
   object paths, bytes, MIME types, and SHA-256 hashes.
5. Build from the frozen SHA, resolve and record the immutable app/worker/base
   image digests, and retain the previous verified rollback image.
6. Deploy only through the approved product path after review; capture Caddy
   TLS, `/api/health`, authentication, tenant/RLS, storage, booking, email,
   and browser receipts against the deployed hostname. A local check is not
   acceptance evidence.
7. Keep provider writes disabled and the worker omitted through the canary.
   Enable Stalwart/SnagTime/provider writes only through separate reviewed
   gates with rollback instructions and an incident owner.

## CI/control-plane disposition

The single full suite is the `Contract and static checks` context in Hard Reset
Verification. Release CI provides `Secret scan`, `SBOM`, and `Container scan`;
image evidence binds the saved image ID and tar digest to the SBOM and scan.
Preview CSP remains manual/advisory until provenance-bound automation exists;
this branch does not claim that it was run. Changes to `.gitleaksignore` are
security-review events; post-merge branch protection requires GitGuardian.

Main branch protection must be changed only after these exact checks have
passed on the new PR and the context names are confirmed. Required settings:
strict/up-to-date branches, one approval, admin enforcement, conversation
resolution, no force pushes, and no deletions. If enforcing new contexts before
merge would block this PR because they are absent from main, defer the API
change and record the exact command and receipt after merge; do not weaken or
misconfigure protection.

## Superseded PR

PR #383 is docs-only, based on an obsolete main, and explicitly says not to
merge. Its useful inventory/ADR/manifest text is carried forward here with
current statuses and unknowns made explicit. It must be closed as superseded
after this replacement draft PR is opened; its history is retained.
