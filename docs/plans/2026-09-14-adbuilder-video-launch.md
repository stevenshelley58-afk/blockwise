# Ad Builder Video — launch record

Owner decisions recorded 14 September 2026. This file supersedes the proposed
defaults in the 14 September build handoff wherever the two disagree, and it
records what is actually built versus still outstanding. A plan is not evidence
of deployment: the verified state of each item is stated below.

## Offer, as approved

| Item | Decision |
| --- | --- |
| Existing video | Upload, keep, preview and download. No production charge, and no payment record is created for this path. |
| Commissioned video | A$100, **ex-GST placeholder**. Live checkout stays gated until the accountant confirms GST treatment. |
| Deliverable | One 20-30 second vertical 1080x1920 MP4. |
| Sound | No narration. A customer-supplied transcript, or a house-licensed music bed. Any track must have confirmed usage rights. |
| Deadline | First draft on the **2nd working day**, Monday to Friday, in the workspace timezone. The exact local date and time is shown at checkout. |
| Revision | One consolidated revision, due 24 hours after feedback is submitted. |
| Refunds | Full refund on request at any time before final delivery. |
| Retention | 7 days abandoned unpaid uploads; 90 days paid source and editing files; finals while the account is active. |
| Support | support@blockwise.sale |
| Oversized uploads | Accepted and optimised. The original is kept unchanged and the optimisation is disclosed to the customer. |
| Large sources | A clip longer than the deliverable is accepted and flagged for the editor, not rejected. |

### Why the deadline is stated in working days

The approved wording was "48 business hours, Mon-Fri". Taken literally that is
48 *accumulated* working hours, which at 8 hours a day is **six** working days,
so a Friday-afternoon order would be due the Monday week. The owner confirmed
the intent is a deadline on the **2nd working day**. The function is therefore
defined in working days so the code cannot disagree with the promise, and
weekends never consume the commitment:

```
Monday    09:00 -> Tuesday   17:00
Friday    16:00 -> Monday    17:00
Monday    19:00 -> Wednesday 17:00   (after hours, counting starts next day)
Saturday  12:00 -> Tuesday   17:00
```

`ready_at` is the later of verified payment and a complete, validated brief.
Operator pickup and retries never reset it.

## Verified state

Built and committed on branch `adbuilder-video-launch`:

- `8ab28d278` eight workspace-scoped tables with RLS, the privacy boundary and
  the working-day deadline function.
- `126bf9bc6` object paths, upload limits, ffprobe-based media inspection and
  the upload ledger state machine, plus 31 passing test assertions.
- `536714a65` ffmpeg and a bounded, non-executable tmpfs in the sandboxed
  worker, with memory, process and CPU limits.

- `ddfb825e2` resumable upload (init, chunk at an explicit offset, finalise)
  and the authorised media read that issues short-lived links.
- `48e15c0bc` the `/ad-builder/video` surface, the offer contract and the
  studio navigation entry.
- `362720342` `.gitignore` correction, without which the page and component
  were silently excluded from git.
- `8ce698636` the authorised library download.
- `4570ecb93` worker-side resizing of large sources onto the existing
  `job_queue`.

Applied to the local product database and confirmed: eight `video_%` tables
exist with RLS enabled, the private `adbuilder-video` bucket exists with a 2 GB
ceiling and an explicit MIME allow list, and the isolation test passes.

Verified by `next build` (exit 0) with `/ad-builder/video` and every
`/api/adbuilder/videos` route in the route manifest, plus `/operator/video`
and both `/api/operator/video-orders` routes. 128 unit assertions and 8
real-media assertions pass, and `tsc --noEmit` is clean.

**Built end to end for the free path:** a customer can create a video, upload a
resumable source, have it inspected, resume an interrupted transfer, download
it, and see it in their library. Oversized sources are queued for a resized
playback copy that never replaces the original.

- `9e74de2d3` commissioned briefs, orders, the immutable offer snapshot and the
  server-side checkout gate.

**Built for the paid path, but deliberately unable to charge:** brief autosave
to a single working draft, brief freezing on submit, order creation with a
frozen offer snapshot, and a checkout route that refuses before it does any
work. `assertCheckoutEnabled` requires both a determined tax treatment and an
explicit switch, so editing one constant cannot start charging customers.

- `6ab91de93` the operator fulfilment queue read model and its audited actions.
- `d7ab41402` the `/operator/video` surface and operator draft and final uploads.

**Built for fulfilment:** an operator can see paid orders soonest deadline
first, claim one, upload a draft or a final through the same inspected path a
customer uses, and deliver. Claiming never writes the committed deadline, a
second claim is refused, and a delivery cannot happen twice.

- `a6ebd752d` a fix for an invalid ffprobe flag, plus integration tests that run
  against real encoded media.
- `6ae3d3f04` a reproducible generator for those media fixtures.

**Media handling is now verified against real files, not only doubles.** The
integration suite generates genuine H.264 files with ffmpeg and exercises the
real pipeline: container sniffing from actual bytes, both inspection entry
points measuring real geometry and duration, refusal of a contradicted declared
type, of non-video bytes and of a truncated file with a valid header, and the
full resize chain executed through the real ffmpeg binary with the output
probed back. Run it with `bash scripts/dev/make-video-fixtures.sh` first; it
skips cleanly without the fixtures.

That suite immediately found a defect that would have broken the feature
outright: the inspection passed ffprobe a `-nodata` flag, which does not exist,
so ffprobe exited non-zero and **every real video was classified as corrupt**.
Every unit test had passed because they inject a fake probe.

**Not built yet:** the Stripe payment-mode session itself (blocked on the GST
decision by design, not by omission), the transactional notifications,
payment reconciliation, the capacity gate, the retention cleanup job, and the
release. The resumable upload has still not been exercised end to end over a
slow or interrupted connection, and no resize has been run on a
multi-hundred-megabyte source.

**Nothing is live to customers.** Production still serves revision `897506271`;
this branch is 11 commits ahead of it and has not been released.

## Known open items

1. **GST is unconfirmed.** This blocks enabling live checkout, by agreement.
2. **Migration ledger.** `20260914100000` was applied out of process during
   development, so the ledger has no row for it. The sanctioned
   `scripts/vps/product-migrate.sh --apply` is idempotent and will record it on
   the next run. Do not insert the row by hand.
3. **The original handoff's media layout** named separate `adbuilder-video`
   bucket paths `sources/`, `previews/`, `thumbnails/`, `production/`,
   `drafts/` and `finals/`. Those are implemented as written.

## Security decisions worth not re-litigating

- **Server-mediated upload, not TUS direct-to-storage.** The proposed TUS flow
  would need a `storage.objects` policy, letting a browser client reach the
  object store directly. Uploads are mediated by authenticated routes holding
  the service role, exactly like the existing customer image path, so no new
  storage policy is needed and the bucket keeps its own type and size
  enforcement.
- **Four tables are server-only.** `video_assets`, `video_brief_versions`,
  `video_payment_attempts` and `video_order_events` are excluded in
  `infra/product/post-migrate-api-grants.sql`. Without that exclusion the
  central grants file grants the browser role full DML on every RLS-enabled
  table, which would have exposed the payment-attempt and audit tables.
- **Production material stays operator-only**, including inside the customer's
  own workspace, and is enforced in RLS rather than only in application code.
- **Stored media references are API routes, never signed URLs**, because a
  persisted signed URL becomes a dead reference once it expires.

## The AI generation path

An earlier unmerged branch contained an AI video-generation system. It was
deleted on the owner's instruction and is recoverable from the
`deleted/20260914-adbuilder-video-generation` tag and from
`chore/zero-branch-consolidation`. Human editing fulfils launch; automated
generation is not a prerequisite and is not referenced by this feature.
## Release plan

Branch `adbuilder-video-launch` is rebased onto `origin/main` = `e558f256d`, which
is the revision production is currently serving, so the branch applies directly
to the live release point. The rebase replayed 20 commits with no conflicts,
including `studio-shell.tsx`, which upstream had also changed for the design
system work; the Video navigation entry survived, `tsc` is clean, 137 video
assertions pass and `next build` succeeds.

### The order, and why it is this order

Migrations run **before** merge, because a merge is live in about two minutes
and the app must never serve code whose schema is not yet present. The product
migration runner is idempotent per its own ledger, so a re-run is safe.

```bash
# 1. Rehearse on a restore, as the runner's guard requires.
bash scripts/vps/product-backup.sh
bash scripts/vps/product-restore.sh <the backup just written>   # into a scratch database
BLOCKWISE_PRODUCT_MIGRATION_DIR=<restore>/supabase/migrations \
  bash scripts/vps/product-migrate.sh --plan     # confirm the five files and their order

# 2. Apply to production. The guard is deliberate: it requires evidence that
#    the set was rehearsed, not a promise that it was.
BLOCKWISE_MIGRATION_APPROVED=I_HAVE_REHEARSED_ON_A_RESTORE \
  bash scripts/vps/product-migrate.sh --apply

# 3. Merge the branch, which releases through the watched path.
git -C /projects/blockwise merge --no-ff adbuilder-video-launch

# 4. Verify the deployed revision and the live journey, not the release record.
docker ps --format '{{.Image}}' | grep blockwise-app
```

### Five migrations, in order

| File | What it adds |
| --- | --- |
| `20260914100000_adbuilder_video.sql` | The eight video tables, RLS, the privacy boundary, the working-day deadline function |
| `20260914110000_adbuilder_video_storage.sql` | The private `adbuilder-video` bucket |
| `20260914130000_video_deadline_rpc.sql` | The service-role-only deadline wrapper |
| `20260914140000_video_single_brief_draft.sql` | The one-unfrozen-draft-per-project index |

`20260914100000`, `20260914110000`, `20260914130000` and `20260914140000` were
each applied to the local product database during development, out of process,
so **the ledger has no rows for them**. The runner will insert those rows on
its first `--apply`; it is idempotent, so it will re-run the DDL and record what
it did. Do not insert the ledger rows by hand: that repeats the out-of-process
change rather than repairing it.

### Feature gates this release must leave in this state

| Gate | Required state at release | Why |
| --- | --- | --- |
| Paid video checkout | **closed** | `VIDEO_OFFER.taxTreatment` is `undetermined` and `checkoutEnabled` is `false`, and `assertCheckoutEnabled` requires both to flip plus `STRIPE_VIDEO_AUD_ID` configured. The GST treatment is not confirmed. |
| Video upload | open | The free path is the launch scope. |
| Provider writes | **disabled** | The release preflight requires `BLOCKWISE_ENABLE_PROVIDER_WRITES=false`. |

There is no `STRIPE_VIDEO_AUD_PRICE_ID` configured and no payment-mode session
code, so no video payment can be created by this release even if the gate were
flipped by accident.

### Rollback

Use `scripts/vps/product-rollback.sh` to return to `e558f256d`. That revision
does not read the video tables, so the migrations may stay applied: they are
additive and nothing else references them. Do not drop them to roll back, and
do not unapply payment events.

### What this release does not deliver

The paid path cannot be sold: no Stripe payment-mode session exists, by design,
pending the GST decision. Fulfilment, notifications, upload, inspection,
resizing and downloading are all built, but the operator queue has never been
used on a live order and no uploaded file has crossed a real network.

## Live record

**Released and verified live on 2026-09-15.**

| Item | Value |
| --- | --- |
| Deployed revision | `e33b2d9f0c890ff3bdfb12dce569f4c4e431bc36` |
| Previous revision | `1c654aecad81d854ee49989af7dde45fbeffc9c0` |
| Rollback | `scripts/vps/product-rollback.sh` to `1c654aecad` |
| Migrations recorded | 127 ledger rows including all four video migrations |
| Health | readiness endpoint ready; all product services healthy |

The handoff open item is closed: `20260914100000` and its three siblings now
have ledger rows, applied by the sanctioned runner from the worktree.

### Live verification, and its limit

The routes and API paths below were renamed on 15 September 2026 when the
editor was renamed to Ad Builder. The checks were run against the names in use
at the time, and the current names are shown here.

Verified against the running revision: `/ad-builder/video` returns 307 to
`/login`, so the route exists and requires authentication rather than 404;
`/api/adbuilder/videos` returns 401; the private `adbuilder-video` bucket exists
with a 2 GB ceiling; the deadline function returns Tuesday 17:00 Sydney for a
Monday start; the privilege boundary holds on the live database.

**Not verified:** no authenticated customer journey has been walked end to end
on the live deployment, and no real file has been uploaded through the live
surface. The live checks prove the routes are present, authorised and wired;
they do not prove the whole journey.

### A privilege defect found only by checking live

After the first release, `authenticated` held INSERT, UPDATE and DELETE on
`video_orders`. The migration revoked them, but the central post-migration
grants script runs after the entire migration set and re-grants browser DML on
every RLS-enabled table. Leaving `video_orders` out of its exclusion list only
declined to grant it again, and nothing revoked what the migration had already
issued. A customer could therefore have inserted an order and chosen the amount
owed, and RLS did not prevent it because the row is legitimately in their own
workspace. The grants script now revokes explicitly for the five server-only
video tables. Released as `e33b2d9f0`.

The rehearsal missed it because it ran the migration alone, without the grants
script. Recorded here rather than quietly fixed.

### Still to build

The operator fulfilment queue in **Frank Window**, per the owner decision on
2026-09-15. The equivalent queue exists in Blockwise at `/operator/video` and
works, but the owner surface of record is Frank.

The paid path cannot be sold: no Stripe payment-mode session exists and
`checkoutEnabled` is false, pending the accountant GST confirmation.
