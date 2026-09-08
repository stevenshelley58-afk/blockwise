# Ad Radar subscription-fill deployment evidence

Date: 2026-09-08

## Deployed revisions

- Research runtime is ACTIVE at exact SHA
  7b11172024c6050bd1c27b2b671278598028b495.
- Product is LIVE at exact SHA
  674b512139961927191f3659a64737a2e0db1cdd.
- Product health is verified. Two pagination canary flows and two public normal
  TLS flows passed.
- The canonical one-queue worker is active with --ad-db-worker. Raw capture
  journaling is durable, media archiving is independent, and the core path
  makes no AI call.

## Verification

- Runtime full suite: 1046 passed, 0 failed, 1 skipped. The unwritable-fixture
  check ran without setpriv DAC override, so its permission failure remains
  meaningful.
- Focused Ad Radar suite: 54 passed; the balance-concurrency test passed.
  Test-only reference: 31761d26001e94e9381fe8e13fcb679b8d278b7d.
- Product groups: 913/913, 134/136 with 2 skipped, 11/11, and 17/17; no
  failures. NUL, typecheck, and build gates passed.
- Broader unchanged mobile suite remains 14 passed and 4 failed. More locator
  and Templates strict-locator success are not claimed.

## Paid and replay evidence

The first paid GL C Residential capture confirmed zero ads using 25 credits and
scheduled the next scan in 3 days. Same-job raw replay took 192 ms, used one
attempt, and left provider-used at 325 both before and after; no additional
paid request or credits were used. Subsequent runs observed active ads and
media archives. The balance single-flight fix prevents stale concurrent
preflight snapshots from rejecting a reservation after a paid call; a drained
worker was used before the runtime upgrade.

## Scope and remaining gap

WA first-fill is RUNNING and NOT COMPLETE. The known scope is 389 eligible
numeric Facebook pages, not all 12,144 WA agents; only 147 agents currently
have a known eligible page. Busy-page pagination completeness remains
unimplemented or unproven, and unresolved directory identity gaps remain
explicit. Customer own/local pages and all known pages in a subscribed
postcode are daily; other active pages are daily, quiet pages use 3/7/14/30
days, and a partial result with active ads retries within 24 hours with
coverage unknown.

The existing subscription maximum is 75,000, with 74,675 remaining at launch.
The per-request limit is 25. No additional overall policy cap was introduced
and no credits were purchased beyond the recorded paid capture.

## Database and recovery state

Research migrations 202609080001, 202609080002, and 202609080003 are live;
the product interest migration is live. Unsupported legacy global-fill
completion flags were reset (531 rows) while saved ad evidence was preserved.
The concurrent-balance fix is deployed, and claimed jobs were drained before
restart; no paid request was interrupted.

The pre-change backups are at
/srv/hermes/backups/ad-radar-before-20260908. The research backup is about
1.7 GB and its listing was verified; the product full restore was tested.
Off-server backup verification has not been performed.
The temporary schema-only rehearsal databases and canary fixtures were retired after verification; protected pre-change dumps remain retained.

The old worker release 3634d6d23fbc8c23f855d2f53a27edc1188ccc07 is retained but
is not a drop-in rollback because the old SQL RPCs were removed. The same-schema
release 9b07d3e987f745c702bd9556109b946e106de828 is retained, as is the
previous product release 77a89d270f65ca0561ebc90214cb401700ce3825.

## Artifact location

Archify evidence and the generated process review are retained under
/srv/blockwise/e2e-runs/ad-radar-20260908/new-process. This record preserves
the pagination and identity gaps and does not claim full-WA completion.
