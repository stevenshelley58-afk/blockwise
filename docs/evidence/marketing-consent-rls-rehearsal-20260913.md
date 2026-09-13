# Marketing-consent RLS rehearsal

2026-09-13, rollback-only against `blockwise-product-product-db-1`.

The corrective snapshot SQL was stripped of its `BEGIN` and `COMMIT` before the outer transaction. The transaction ended in `ROLLBACK`.

Observed passes: 9

1. Corrective function/helper/grants compile.
2. Verified workspace member records grant.
3. Same member records revoke, retaining two immutable events.
4. Direct update is denied.
5. Unverified member is denied for a grant.
6. An unverified member with a prior grant records a revoke.
7. Cross-workspace member is denied and sees no events.
9. Anonymous RPC is denied.
9. `service_role` snapshot returns verified timestamp and latest revoked consent fact.

No fixture rows survived the rollback.