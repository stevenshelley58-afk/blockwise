# Marketing-consent RLS rehearsal

2026-09-13, rollback-only against `blockwise-product-product-db-1`.

The corrective snapshot SQL was stripped of its `BEGIN` and `COMMIT` before the outer transaction. The transaction ended in `ROLLBACK`.

Observed passes: 8

1. Corrective function/helper/grants compile.
2. Verified workspace member records grant.
3. Same member records revoke, retaining two immutable events.
4. Direct update is denied.
5. Unverified member is denied.
6. Cross-workspace member is denied and sees no events.
7. Anonymous RPC is denied.
8. `service_role` snapshot returns verified timestamp and latest revoked consent fact.

No fixture rows survived the rollback.