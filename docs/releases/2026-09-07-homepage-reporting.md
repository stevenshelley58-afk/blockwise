# Homepage reporting section — 7 September 2026

## Released outcome

- Preview: https://blockwise.sale/homepage-preview/concept#results
- Compiled source revision: `c22d3a36d131281f5143b5d998be0178cc5923d2`.
- Image/container: `blockwise-homepage-preview:c22d3a36d131` / `blockwise-homepage-preview-c22d3a36d131`.
- VPS source: `/projects/blockwise-homepage-value-20260907`; branch `codex/homepage-value-redesign-20260907`.
- Supersedes the rejected create/approve/enquiries results walkthrough. The owner's correction is the brief: no guessing how ads are going, no waiting for an agency report, a personal dashboard and email updates on the customer's schedule.
- Headline: “No guesswork. No chasing updates.” A substantial dashboard shows leads, spend, cost per lead, a labelled chart and campaign breakdown. A visible email preview demonstrates daily, weekly and custom 1–30-day delivery intervals.
- Reuses incumbent marketing typography, palette, Motion and Lucide. No dependency, provider, DB, authentication or production homepage change.

## Scope and truth

`results-reporting.tsx` is an isolated reusable client component; `reporting.ts` contains typed synthetic fixtures. Dashboard chart and campaign totals agree for 7/30-day periods. Email examples share the same daily lead series. Every value is illustrative, not a customer result or performance promise.

Flexible email scheduling is an owner-requested concept. Existing customer settings expose a weekly-digest toggle, not this full scheduler. The controls neither save preferences nor send mail; the preview explicitly says so. Implement and verify delivery separately before promoting this concept to the production homepage.

All six surrounding sections were compared byte-for-byte in compiled HTML against the latest concurrent preview (`7bbe60b7bb4827fbebe981741dbcd2f4702512ad`): hero, explainer, examples, control, FAQ and trial are unchanged. Earlier concurrent FAQ and explainer revisions were integrated rather than overwritten. Future preview releases must retain this reporting component and its styles.

## Verification

- Full integrated suite: 937 tests, 936 passed, zero failures, one existing root-permissions skip. Final focused homepage/reporting tests: 8/8 passed.
- NUL scan and TypeScript check passed. Final production build, including TypeScript validation, and isolated container image build passed.
- Public GET 200, exact compiled revision, noindex, POST 405 and preview application API 404 verified.
- Desktop and phone visuals inspected; responsive geometry checked at 320, 390, 767 and 1440 CSS pixels. Final 320px month view has no off-screen elements or metric-column overflow; all reporting controls are at least 44px tall (allowing browser rounding).
- 7/30-day switch, daily/weekly/custom radio choices and custom interval tested. Final live preview: 62 leads / $1,116 for 30 days; every 14 days updates the email to 32 leads / $576. Native keyboard activation, visible focus, reduced-motion rendering and trial anchor verified. No application console errors.
- Chrome automation stalled during a concurrent preview replacement; final interaction checks were repeated successfully in the isolated in-app browser. No app-code workaround was introduced for the automation problem.
- Text contrast: muted metadata 5.01:1 on white; body text 6.93:1; subdued headline 7.91:1 on the dark section; email schedule 11.16:1 on its dark surface.
- Impeccable detector ran once: 88 advisory palette/type/radius differences against the customer-app design document, no other finding classes. This section intentionally inherits the established marketing concept instead of changing global customer-app tokens.
- Focused simplification removed the obsolete walkthrough component, fixtures, tests and styles. Visual corrections removed default heading margins and prevented four-digit spend colliding on narrow phones. Motions are finite, user-triggered and use the shared 250ms ease-out timing; SSR content is visible.

## Deployment and rollback

The preview runs secret-free as non-root with a read-only filesystem, dropped capabilities, no-new-privileges, a 1GB memory limit, and an internal-only network. Each route switch checked the current public revision first and used the existing preview-only route updater; production routes were preserved. Browser viewport and media overrides were restored.

Reapply this release after a product-router restart:

```sh
python3 scripts/vps/homepage-preview-route.py --upstream blockwise-homepage-preview-c22d3a36d131:3000 --apply
```

The preceding preview `blockwise-homepage-preview-7bbe60b7bb48` is retained for rollback. Use the route updater with that upstream, starting its container if required. Never restore an old full router configuration over other work.
