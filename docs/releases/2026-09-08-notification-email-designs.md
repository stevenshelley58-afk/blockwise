# Daily, weekly and new-lead email designs

Design delivery dated 8 September 2026. This record is evidence of this release,
not a permanently current runtime claim. Work was completed independently.

## Delivered

Three focused, reusable Quiet card emails:

- Daily summary: period/timezone, lead count, ad spend, cost per lead, latest
  enquiries and one View daily summary action.
- Weekly report: seven-day results, absolute lead-count comparison, campaign
  breakdown and one View weekly report action. Not the editorial newsletter.
- New-lead alert: lead name, enquiry, location, source, received time and one
  View lead action. Private contact details stay in the authenticated product.

The two reports also have quiet-day and delayed-data examples. Zero leads never
produce a fabricated cost per lead; delayed data says Pending, not zero. All
three have independent preference metadata and explicitly scoped opt-out wording.
The chosen delivery combination is not mutually exclusive.

Review: https://blockwise.sale/email-preview/email-notifications
Full library: https://blockwise.sale/email-preview/email-library
Frank archive: https://frank.fail/api/chat/uploads/library/blockwise-email/2026-09-08-v1.1/blockwise-email-library.zip?download=1

No production settings, database, provider, email queue or scheduler was changed.
The canonical Settings source currently defines `leadAlerts` and `weeklyDigest`
but does not define `dailyDigest`; the daily preference is a proposed integration
key for the requested design, not a claim about live availability. Future delivery
must honour the current recipient preference, scoped unsubscribe and eligibility.

## Reuse and provenance

Reused the renderer, design tokens, Button, iframe component, real Next frontend,
preview container isolation and Frank's existing persistent upload/download path.
Added only the required summary/metric block, compact activity rows, notification
fixtures and a focused gallery mode. No dependencies or external email assets.

- Git source and compiled preview: `d9126c915029125ecb4db4d4a6ee24320229b2bc`.
- Source checkout: `/projects/blockwise-email-options-20260907`.
- Active preview container: `blockwise-email-preview-d9126c915029`.
- Image: `sha256:37b61ad5d279b1d803b79ccff586bb893db5e220ff3a46baf6d0489843e25ba9`.
- Frank version 1.1.0: `/srv/frank/data/window/uploads/library/blockwise-email/2026-09-08-v1.1/`.
- ZIP 231,202 bytes; SHA-256:
  `291aaa59e2325cd4e3a4e7ff9705e0bd13e1926039c77964c18a2e0a5da1ab3f`.
- Verified all 199 manifest file hashes and archive integrity. Frank's existing
  internal download endpoint returns 200 with the matching archive bytes. The
  public Frank route retains its normal authentication. Version 1.0 is preserved.
- Standard HTML bytes: daily 12,309; weekly 11,825; new lead 10,013. Plain text
  accompanies each. No images, webfonts or scripts in delivered email HTML.

## Verification and limits

- Focused renderer/catalogue/preview-isolation tests: 11 pass. All 44 catalogue
  entries render across three palettes, and all report states render in each.
- Production validation: required fields, protocol/placeholder rejection,
  escaped text and row content, safe subjects, section limits, and scoped footer
  coverage pass. Standalone quiet-day render command smoke test passes.
- NUL scan, TypeScript check and production build pass.
- Full root TypeScript group: 849/850 pass. The unchanged pre-existing legal-copy
  assertion in `progressive-legal-contract.test.ts` still expects "three complete
  Feed and Story ad creations". No unrelated legal copy/test was modified.
- Remaining root group: 73 pass, 0 fail, 1 skip. Package groups: 28 pass, 0 fail.
- Runtime healthy, non-root, read-only, no host port, isolated internal network.
  Compiled SHA, preview flag and base path read from the running container.
- Public notification/full-library routes return 200; preview API returns 404;
  preview POST returns 405. Router script preserves unrelated routes.
- Browser review covers daily light, weekly dark, delayed weekly at 320px,
  new-lead light at 320px and quiet daily at 320px. At 320px the page width and
  scroll width are both 305px including the scrollbar; the email frame is 237px.
  The delayed weekly email itself has matching 237px content/scroll width,
  1459px body inside a 1483px auto-height frame, and correct dark card colour.
  Its Pending headline remains a single 46px-high line. Quiet daily frame 1480px;
  desktop daily frame 1180px. Scoped opt-out links, wrapping controls and mobile
  detail rows are visible. Browser viewport override reset before handoff.
- Real received Gmail/Apple Mail/Outlook tests remain a delivery integration gate.
  Browser previews are not universal inbox/dark-inversion certification.

Logs: `/srv/blockwise/previews/email/notifications-*.log`.

## Retention and rollback

Keep the one active task preview above, source/Git history, verification logs,
Frank versions and the preceding rollback image
`blockwise-email-preview:991e719cc477` (image
`sha256:2907a2c3991fc55b89aa250fed787f42051ba9d8542305f18d3f0efa516f416a`).
The superseded preview container is stopped after the route switches. Regenerable
checkout dependencies and Next/package build outputs can be removed only after
checking no host process uses the checkout; the image contains its own runtime.
Source, user data, manifests and both Frank library versions must remain intact.

Reapply the narrow route after a product-router reload:

```sh
cd /projects/blockwise-email-options-20260907
python3 scripts/vps/email-preview-route.py --upstream blockwise-email-preview-d9126c915029:3000 --apply
```

Rollback only this preview by starting the retained prior container/image and
pointing the same narrow route at it. Do not restore a full router snapshot over
unrelated work. No customer product or Frank application rollback is needed.
