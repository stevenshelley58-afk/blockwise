# Email design options — 7 September 2026

## Delivered preview, not a mail rollout

- Review: https://blockwise.sale/email-preview/email-design
- Serving revision: `317a73cead103062e3088a9462f14a95a6146ea6`.
- Container: `blockwise-email-preview-317a73cead10`; image `sha256:d6175f1818bb9ad8189cfcfdec263951977b533235c1e69603b9da815eda23f3`.
- Its compiled Next configuration was read from the running container and matches
  the Git revision. Healthy, non-root, read-only, 1 GB memory / 1 CPU limit, no host
  port, no production environment, separate internal Docker network.
- Production mail, auth, DB, billing, Meta, homepage and the existing homepage
  preview are unchanged. The only router addition is the independent email-preview
  path. It strips cookies/authorization, disallows writes, and sends noindex headers.

## Delivered system

Three shared layouts: Quiet card (recommended), Personal letter, Operations brief.
Seven fictional examples: sign-in link + separate code, welcome, lead alert, weekly
summary, receipt, security notice, product update. Switching content, device size,
light/dark and option works without backend integrations. Selection is reflected
in the URL. Browser preview iframes use the actual email HTML, disable scripts and
pointer actions, and auto-fit their content height using a parent ResizeObserver.
Same-origin iframe access is only for measuring generated mock HTML; no scripts or
live credentials are present inside the iframe.

The 21 system-theme email outputs measure **7,793–9,480 bytes** of UTF-8 HTML,
with zero email image/font/script downloads and a plain-text companion. This is a
payload measure, not an SMTP delivery-latency claim. Fixtures and rendering are
separate; no new dependencies were introduced. Fresh npm install audit: 0 known
vulnerabilities reported at install time.

## Verification and limits

- Focused renderer + preview-isolation tests: 4/4 pass.
- `npm run check:nul`: pass. Production build including its TypeScript check: pass.
- Separate `npm run typecheck` evidence: `/srv/blockwise/previews/email/typecheck-final.log`.
- Full `npm test` reports 849/850 passing before its fail-fast boundary. The one
  failure is the unchanged `progressive-legal-contract.test.ts` wording assertion
  for "three complete Feed and Story ad creations". It was independently reproduced
  on the clean live-base `/projects/blockwise-hero-copy-20260907` worktree (3/4 in
  that file). Legal copy/tests were not weakened or changed for a design preview.
- The remaining root test group was explicitly run: 66 pass, 0 fail, 1 skip.
  Package groups: 28 pass, 0 fail. Logs are retained under
  `/srv/blockwise/previews/email/`.
- Public HTTPS page: 200; preview product API: 404; preview POST: 405.
- Browser screenshots reviewed all three compositions in light and dark, and the
  sign-in/billing cases at a 320px page viewport. Final narrow check: page width
  305px inside 320px including browser scrollbar; primary iframe width/content
  both 229px; entire receipt body 838px fits its auto-height 862px frame.
  Desktop check: 1265px page inside 1280px viewport; main email frame 630px wide.
- A broader automated browser-frame matrix was abandoned when CUA frame-selector
  evaluation failed after srcdoc changes (MutationObserver instrumentation errors).
  Do not describe that matrix as passing. Targeted DOM checks and visual inspection
  completed; the deterministic HTML matrix covers all 21 fixture/layout outputs.
- These are browser previews, not real received-message certification. Gmail,
  Apple Mail and Outlook light/dark/auto-inversion inbox checks remain for the
  selected option before connecting delivery. No test emails were sent.

## Runtime routing / rollback

The shared Frank edge and mounted product Caddyfile were not edited. Runtime router
backups are under `/srv/blockwise/previews/email/`. The route is independent of
other preview paths and must be reapplied after a product-router config reload:

```sh
cd /projects/blockwise-email-options-20260907
python3 scripts/vps/email-preview-route.py --upstream blockwise-email-preview-317a73cead10:3000 --apply
```

To remove only this review path, use `--remove --apply` with that script. Never
restore an old full router backup over another task's changes. Older email-preview
containers can be stopped while retaining their images; no product rollback is
needed because the product container was not replaced.

## Files / integration seam

- `src/lib/email-design/renderer.ts`: pure HTML/plain-text renderer.
- `src/lib/email-design/fixtures.ts`: fictional content and message contract.
- `src/components/email-design/email-design-studio.tsx`: reusable review UI.
- `src/app/email-design/page.tsx`: flag-gated, noindex Next route.
- [Design contract and client references](../design/email-system-options.md).

After selection, adapt real producers to `renderEmail(message, design)` and replace
preview links/preferences with approved production URLs. Preserve actual auth
provider expiry/token variables. Do not send forced-preview theme variants: use
system mode for native adaptation. Initial implementation used Terra; Astra handled
integration, focused corrections and final verification. No paid rendering service
or reviewer-agent gate was used; costs were not measured.
