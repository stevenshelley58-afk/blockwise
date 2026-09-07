# Postcode outreach draft and preview release

## Serving revision

`7d0115b59c5ec84a83acc041726ba0f195d801f8`, released 7 September 2026.
Integrated the previous serving revision `54085f995a5c3f7310499d39cc887c3b37d6df92`; preserved pricing, guides, approved sample assets, and consent-aware analytics.

## Delivered

- Approved Quiet-card email rendering with three evidence states, two peer examples, one report CTA, and a single optional follow-up draft.
- Synthetic previews at `/ad-reports/demo/email` and `/ad-reports/demo`, including light/dark email variants.
- Public opaque-link frozen reports and signup CTA. Reports remain readable after scan freshness expires. Unknown agent status never removes valid local examples.
- HMAC-protected validate/import adapter and atomic immutable draft persistence. Repeated identical imports reuse the saved report.
- Private CRM/contact fields excluded from public projection. Report routes excluded from general analytics. Browser table permissions denied; RLS on.
- No changes to Ad Radar, no actual contact imports, no outbound sends or scheduling. Provider writes remain disabled.

## Verification

- `npm run test`: 891/891 root tests; secondary/package suites 63/63, 11/11, 17/17; no failures.
- `npm run typecheck`, `npm run check:nul`: pass.
- Immutable Docker candidate ran `npm run build`: pass. Public GA4/Clarity build settings retained.
- Isolated SQL acceptance: replay, conflicts, rollback, immutability, grants/RLS; pass.
- Protected product backup restored into an isolated disposable database. Migration plus production grants rehearsed; existing table counts preserved.
- Migration `20260907010000_postcode_outreach_drafts.sql` applied through the existing ledger runner. Verified all three tables RLS-enabled, anon/authenticated SELECT denied, and zero campaign drafts.
- Canary and live browser journey checks: three segments, six local peers retained, optional own ad, widths 320/390/1440, light/dark and first/follow-up previews, report-to-signup route, missing report 404, zero page errors.
- Live email CTA navigated to matching report, then signup. No signup submitted. Unsigned import rejected with 401.
- Production health verified the exact serving revision above.

Protected backup, build/deploy logs and browser-check output remain outside Git at `/srv/blockwise/outreach-release-20260907`.

## Before the first real pilot

Connect the user's completed Ad Radar output through the documented adapter, select the first recorded-agent postcodes, and review real matches, evidence, contact provenance, lawful consent basis and source/media permissions. Configure an appropriate outbound provider with functioning unsubscribe/suppression and reply handling; this release contains no sender. Test actual inbox rendering and establish privacy-safe conversion measurement before launch. Signup is not trial activation.

See [the draft adapter runbook](../runbooks/postcode-outreach.md).
