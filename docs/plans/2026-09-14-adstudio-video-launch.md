# Ad Studio Video — launch record

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

Built and committed on branch `adstudio-video-launch`:

- `8ab28d278` eight workspace-scoped tables with RLS, the privacy boundary and
  the working-day deadline function.
- `126bf9bc6` object paths, upload limits, ffprobe-based media inspection and
  the upload ledger state machine, plus 31 passing test assertions.
- `536714a65` ffmpeg and a bounded, non-executable tmpfs in the sandboxed
  worker, with memory, process and CPU limits.

- `ddfb825e2` resumable upload (init, chunk at an explicit offset, finalise)
  and the authorised media read that issues short-lived links.
- `48e15c0bc` the `/ad-studio/video` surface, the offer contract and the
  studio navigation entry.
- `362720342` `.gitignore` correction, without which the page and component
  were silently excluded from git.
- `8ce698636` the authorised library download.
- `4570ecb93` worker-side resizing of large sources onto the existing
  `job_queue`.

Applied to the local product database and confirmed: eight `video_%` tables
exist with RLS enabled, the private `adstudio-video` bucket exists with a 2 GB
ceiling and an explicit MIME allow list, and the isolation test passes.

Verified by `next build` (exit 0) with `/ad-studio/video` and every
`/api/adstudio/videos` route in the route manifest, plus `/operator/video`
and both `/api/operator/video-orders` routes. 120 video test assertions pass
and `tsc --noEmit` is clean.

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

**Not built yet:** the Stripe payment-mode session itself (blocked on the GST
decision by design, not by omission), the transactional notifications,
payment reconciliation, the capacity gate, the retention cleanup job, and the
release. The wall-clock behaviour of the resumable upload and the resize job
has not been exercised against a real multi-hundred-megabyte file.

**Nothing is live to customers.** Production still serves revision `897506271`;
this branch is 11 commits ahead of it and has not been released.

## Known open items

1. **GST is unconfirmed.** This blocks enabling live checkout, by agreement.
2. **Migration ledger.** `20260914100000` was applied out of process during
   development, so the ledger has no row for it. The sanctioned
   `scripts/vps/product-migrate.sh --apply` is idempotent and will record it on
   the next run. Do not insert the row by hand.
3. **The original handoff's media layout** named separate `adstudio-video`
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
`deleted/20260914-adstudio-video-generation` tag and from
`chore/zero-branch-consolidation`. Human editing fulfils launch; automated
generation is not a prerequisite and is not referenced by this feature.
