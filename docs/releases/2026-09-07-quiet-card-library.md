# Quiet card library — 7 September 2026

## Delivery

Steven selected Quiet card and requested reusable templates, including a weekly
newsletter, stored in Frank. Delivered 44 templates across seven categories with
parameterised content, separate fictional examples, HTML/plain-text output, and a
real Next review UI. No email was sent, no newsletter was scheduled, and no live
provider, auth, billing, Meta or customer product flow was rewired.

- Review: https://blockwise.sale/email-preview/email-library
- Compiled preview revision: `991e719cc477085241bb338a0b6ce8d0a33f073f`.
- Container: `blockwise-email-preview-991e719cc477`.
- Image: `sha256:2907a2c3991fc55b89aa250fed787f42051ba9d8542305f18d3f0efa516f416a`.
- Pure reusable library source revision: `75aaa9c1de2e164d45396f06f371c7c450874cc5`.
  The later commit only fixes initial browser-preview sizing after hydration;
  exported email content and rendering are unchanged.
- Frank directory: `/srv/frank/data/window/uploads/library/blockwise-email/2026-09-07-v1/`.
- Frank archive: https://frank.fail/api/chat/uploads/library/blockwise-email/2026-09-07-v1/blockwise-email-library.zip?download=1
- ZIP: 203,774 bytes; SHA-256:
  `2277c190be8fa9ab8b09f859204684c672b961e50cd67a6c518cc97f261157ff`.

Frank serves the artifact through its existing authenticated upload/download route.
All 186 manifest file hashes and the ZIP integrity were verified; the internal
Frank endpoint returns 200 with the matching ZIP and attachment filename. Public
unauthenticated access returns 401 as expected: normal Frank sign-in is required.
The canonical Frank checkout had unrelated work, so its source, branch, database
and runtime were not modified. Only a new, versioned artifact folder was added to
its existing persistent storage. No second Frank checkout or app was created.

## Implementation decisions

Reused the existing Quiet card renderer, Blockwise design tokens/logo, Button
component, preview deployment and file-storage route. Small custom catalogue and
validation code is necessary to parameterise this project's content and enforce
required variables. No new package, paid service, image, font download or mail
platform is needed. The standalone renderer uses Node 22.18+ with no dependencies.

- Actual sample HTML range: **7,425–11,129 UTF-8 bytes** (about 7–11 KB).
- Catalogue sample budget <25 KB; production builder hard ceiling 32,000 bytes.
- Marketing and optional-report outputs require unsubscribe/preferences links;
  service emails remain distinct. Consent, suppression and event truth must be
  checked by any future sender; the renderer cannot enforce these externally.
- Production mode rejects missing values, placeholder domains, unsafe protocols,
  fake business-identity placeholders, oversized stories and header injection.
- One native adaptive HTML contains light/dark styles. The preview also has forced
  palettes for visual review. Production builder rejects forced colours.
- Native dark rules now cover the staircase mark, greeting, headings, body,
  panels and border-based CTA; essential content does not depend on remote assets.

## Verification

- Focused email renderer/catalogue/isolation tests: 8/8 pass, including all 44
  templates in three colour modes, required-field removal, unsafe URLs, escaped
  copy, newsletter expansion and plain-text footer links.
- Portable export and CLI smoke test: pass; newsletter renders to HTML/plain text
  without dependencies or sending capability.
- NUL scan, TypeScript check and production build: pass.
- Full root TypeScript group: 849/850 pass. The unchanged pre-existing
  `progressive-legal-contract.test.ts` assertion still expects "three complete
  Feed and Story ad creations". It was reproduced on the clean live base during
  the preceding options task; no legal copy or test was changed to mask it.
- Remaining root group explicitly run: 70 pass, 0 fail, 1 skip.
- Package groups: 11 + 17 = 28 pass, 0 fail.
- Final runtime: healthy, non-root, read-only, no host port, isolated internal
  network; compiled revision, preview flag and base path read from the container.
- Public preview pages 200; product API under preview 404; preview writes 405.
  Route script preserves the other product/preview routes and strips auth cookies.
- Browser review: newsletter light and dark, native system-dark stylesheet under
  a temporary browser preference, and mobile billing. At a 320px viewport, the
  page is 305px including scrollbar, no page overflow; email iframe is 237px wide.
  Newsletter document width equals scroll width (237px), body 2132px fits a 2156px
  frame, dark card/heading colours correct, and wrapping CTA is 64px tall.
  Mobile receipt frame is 993px tall, with stacked detail rows and visible footer.
- Fixed a discovered initial iframe-load/hydration race. Fresh final page measures
  newsletter to 1218px without needing a theme switch. Desktop email width 630px.
- CUA frame evaluation can fail after srcdoc replacement; one native-dark
  computed-style probe timed out. Native-dark visual inspection succeeded; do not
  describe an exhaustive browser/client matrix as passing. Temporary browser
  viewport and preference overrides were cleared.

Logs: `/srv/blockwise/previews/email/library-*.log`. A temporary GitHub connection
failure was resolved for the push with a one-command current-DNS IPv4 resolution
and HTTP/1.1 override; no persistent Git or network configuration was changed.

## Remaining integration gate

Real received-email tests in Gmail, Apple Mail and Outlook desktop/mobile,
light/dark/auto-inversion remain required before turning on delivery. No inbox
certification is claimed. Replace example content, connect verified events and
real provider URLs, then configure the existing sender's multipart delivery,
unsubscribe headers, suppression checks and consent/approval workflow. A template's
presence does not imply the corresponding product feature already exists.

## Routing and rollback

Only the existing isolated review route was updated. The customer product container
and Frank edge configuration were not replaced. Reapply after a product-router
reload with:

```sh
cd /projects/blockwise-email-options-20260907
python3 scripts/vps/email-preview-route.py --upstream blockwise-email-preview-991e719cc477:3000 --apply
```

For preview-only rollback, point that route at the retained prior candidate after
starting it. Do not restore a full router backup over other work. Keep the versioned
Frank library intact; future updates should create a new version, not overwrite it.
