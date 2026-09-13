# Marketing-consent RLS rehearsal

2026-09-13, rollback-only against `blockwise-product-product-db-1`.

The corrective snapshot SQL was stripped of its `BEGIN` and `COMMIT` before the outer transaction. The transaction ended in `ROLLBACK`.

Observed passes: 12

1. Corrective scoped helper/function/grants compile.
2. Verified workspace member records grant.
3. Same member records revoke, retaining two immutable events.
4. Direct update is denied.
5. Unverified member is denied for a grant.
6. An unverified member with a prior grant records a revoke.
7. Cross-workspace member is denied and sees no events.
8. Anonymous RPC is denied.
9. `service_role` snapshot returns verified timestamp and latest revoked consent fact.
10. Authenticated callers cannot execute the verification helper.
11. A workspace with two owners returns a null owner verified timestamp.
12. `service_role` helper returns null for a profile outside the supplied workspace.

No fixture rows survived the rollback.