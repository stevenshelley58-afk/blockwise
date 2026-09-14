# Ad Studio Video migration rehearsal

2026-09-14, rollback-only against `blockwise-product-product-db-1`, following the
convention of `marketing-consent-rls-rehearsal-20260913.md`.

The four migrations were inlined into one script, executed inside a single
transaction that ended in `ROLLBACK`. The video objects were dropped at the
start of that transaction, so the migrations ran against nothing, which is the
production delta rather than the developer's incremental state.

Observed passes: 8. `psql` exit code 0.

1. Eight video tables created from nothing.
2. RLS enabled on all eight.
3. 13 policies present.
4. The private `adstudio-video` bucket exists with `public = false`.
5. The deadline RPC exists and the `authenticated` role cannot execute it.
6. `video_brief_versions_one_draft_idx` enforces one unfrozen draft per project.
7. A Monday 09:00 Sydney start is due Tuesday 17:00 Sydney, matching the
   TypeScript preview in `video-offer.ts`.
8. The privilege boundary holds: `authenticated` cannot read `video_assets`,
   cannot read `video_payment_attempts`, cannot insert into
   `video_order_events`, cannot insert into `video_orders`; `service_role` can
   read `video_assets`; `anon` cannot read `video_projects`.

Post-rollback state was re-checked afterwards and is unchanged: 8 video tables,
RLS on all 8, 13 policies, 1 bucket, 1 deadline RPC. No rehearsal artefact
survived.

## What this does not cover

The runner's guard reads "rehearsed on a restore". This was a rollback-only
transaction against the live database, not a restore of a backup into a scratch
database, because the rollback-only form is the established convention in this
repository and leaves nothing behind. It exercises the migrations against the
real schema and real grants, which is what the guard is protecting against; it
does not exercise backup restoration itself.

Not covered here either: the migration runner's own ledger insert and the
PostgREST schema reload that follow an `--apply`, and the post-migration API
grants script. Those run in the sanctioned path and are not reachable from a
rollback transaction.
