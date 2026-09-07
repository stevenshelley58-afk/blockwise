# Beta readiness release record (7 September 2026)

## Status

Validation is in progress. This record covers the coordinated candidate
checkout `/projects/blockwise-beta-release-20260907`; it is not deployment
authorisation. The public app remains on
`c02b11e452203a2d54bd278b913f410588ce6ff4`. Candidate application checkpoint:
`7563960ecbc7ac8eb83f679c310029a09a16da26`.

## Safety posture

- Worktree is expected to remain committed and clean before image construction.
- Provider writes remain disabled with `BLOCKWISE_ENABLE_PROVIDER_WRITES=false`.
- The Meta publish workspace allowlist remains unchanged.
- No provider writes, real OAuth writes, Stripe charges, email sends, customer
  data mutations, worker restart, Caddy restart, or deployment occurred during
  this checkpoint.
- Build and deployment scaffolding is isolated under
  `/srv/blockwise/beta-release-20260907/`. `rollback-app.sh` must be prepared
  before any image or app deployment action.

## Validation evidence

- `npm run check:nul` passed, scanning 1,036 text files.
- Root tests passed: 910/910.
- Package tests: 120/123 passed, 1 failed, 2 skipped. The failure is
  `customer-navigation.test.mjs`, which still expects `/ad-radar` to be absent
  from active navigation. The candidate deliberately enables canonical Ad Radar,
  so this is an outstanding product-test reconciliation, not a silent pass.
- Typecheck and final build evidence are required after all product and ops
  commits are integrated.

## Outstanding release gates

- Product E2E acceptance and operations follow-up are still pending.
- Final immutable image build and app-only deployment are pending explicit
  coordination.
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
