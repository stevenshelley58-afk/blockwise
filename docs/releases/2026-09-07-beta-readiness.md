# Beta readiness release record (7 September 2026)

## Status

This record covers the coordinated candidate checkout
`/projects/blockwise-beta-release-20260907`. The app-only deployment now serves
revision `f972e44d4ee1a47c1602e1427883835512240fce`; deployment did not restart
worker or Caddy. Candidate application checkpoint before docs-only evidence:
`7563960ecbc7ac8eb83f679c310029a09a16da26`.

## Safety posture

- Worktree is expected to remain committed and clean before image construction.
- Provider writes remain disabled with `BLOCKWISE_ENABLE_PROVIDER_WRITES=false`.
- The Meta publish workspace allowlist remains unchanged.
- No provider writes, real OAuth writes, Stripe charges, email sends, customer
  data mutations, worker restart, Caddy restart, or deployment occurred during
  this checkpoint.
- Build and deployment scaffolding is isolated under
  `/srv/blockwise/beta-release-20260907/`. The guarded rollback command was
  prepared before deployment; the retained env backup is
  `/srv/blockwise/beta-release-20260907/product.env.before-f972e44d4ee1`.

## Validation evidence

- `npm run check:nul` passed, scanning 1,036 text files.
- Root tests passed: 910/910.
- Package tests: 124/126 passed, 0 failed, 2 skipped. The skips are the
  lifecycle comparison test and the root-only unwritable-directory typecheck
  test. No package test failed.
- Typecheck passed after package builds. Final immutable image build and
  app-only deployment passed. `/api/health` reports the exact serving revision.
- Product canary reported `SAVE_REOPEN_OK` in seeded workspace
  `00000000-0000-0000-0000-0000000000e2`, with revision-1 save, Feed/Story
  hashes, and exact edited-text reload. This does not prove fresh signup or
  external provider actions.

## Outstanding release gates

- Fresh email signup and external-account onboarding were not exercised.
- Live Meta OAuth/deauthorize/partner-account, provider publishing, lead
  delivery, scheduler, and Stripe account evidence remain external gates.
- Live Meta OAuth, deauthorize/data-deletion, partner-account, publishing,
  lead delivery, scheduler, and Stripe account evidence remains external and
  cannot be inferred from fixture tests.

## Rollback reference

Use only a retained image with a matching OCI revision label. Set
`EXPECTED_LIVE_REVISION` from the current `/api/health` response, confirm
provider writes are still disabled, then run:

```bash
/srv/blockwise/beta-release-20260907/rollback-app.sh --revision <retained-full-sha> --apply
```

The rollback is guarded, app-only, and retains a protected environment backup.
Database restore and DNS changes are separate procedures documented in the
rollback runbook.
