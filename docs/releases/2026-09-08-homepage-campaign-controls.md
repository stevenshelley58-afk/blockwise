# Visual campaign controls, 8 September 2026

Historical evidence for the isolated homepage preview.

## Result

- URL: https://blockwise.sale/homepage-preview/concept#control
- Compiled application revision: `3c5ac511636a3639edaad600ade08067f8f13c6d`.
- Replaced the small, sparse four-row accordion with a strong two-line headline, four selectable topics and one persistent visual preview.
- Creative control: editable headline on a real property image, branding context and approval reminder.
- Budget control: daily-budget slider, duration selection and calculated planned spend.
- Campaign detail: sample results, approval status and local pause/resume demonstration.
- Helpful updates: sample email and Daily, Weekly, Monthly or Never selection.
- All interactions are local React state. No campaign, billing or email operation occurs. No new dependency.
- Existing homepage components, CSS tokens, property asset and shared motion durations are reused. Implementation: `src/components/homepage-concept/campaign-controls.tsx` and the scoped control styles in `src/app/concept/concept.css`.
- Concurrent pricing work is preserved. The gallery remains removed. Section order: top, how-it-works, results, control, pricing, FAQ, trial.

## Verification

- NUL check, full tests, typecheck, production build and diff check passed.
- 945 tests passed; zero failed; one existing root-permissions test skipped because root bypasses chmod-based unwritable-directory checks.
- Public browser checked compiled revision, creative input, calculated budget, pause/resume, email selection, arrow-key selection/focus and inactive-panel inert state.
- Inspected desktop at1440px and phones at390px and320px. Control rectangles had no horizontal overflow and input/button heights were at least44px.
- Crossfade sample:37 frames,12 overlapping frames, zero blank frames and zero panel-height change.
- Reduced-motion initial load matched the preference and all panel transforms were none.
- Final public browser recheck verified a30 AUD daily budget over14 days produces420 AUD and that pricing plus all six FAQ categories remain present.
- Final candidate and public HTML matched. GET200, POST405, preview API404, noindex/no-store headers. No em dashes in rendered HTML.
- Preview-only router comparison passed. Canonical product health gate passed at unchanged product revision `674b512139961927191f3659a64737a2e0db1cdd`.
- Evidence: `/projects/blockwise-homepage-chat-reconciled-20260907/work/homepage-control/`.

## Release and retention

- Final serving container: `blockwise-homepage-preview-3c5ac511636a3639`.
- Image: `blockwise-homepage-preview:3c5ac511636a`, ID `sha256:536c0fc8cfa0987175b338f807ef952497752ed1c89e2d71be07c15d4c97f4c6`.
- A concurrent release had started the same revision in `blockwise-homepage-preview-3c5ac511636a`. Its image ID differed from the independently verified build and was no longer inspectable by ID. It was not deleted or stopped. The final preview route was switched to the uniquely named container backed by the retained, verified image above.
- Verified prior rollback container/image: `blockwise-homepage-preview-bc3237a6db4b` / `blockwise-homepage-preview:bc3237a6db4b`, revision `bc3237a6db4b3d85a2fb44b329bf86617f2d863d`. This predates the combined pricing/control change.
- To restore that prior preview, use the existing preview-only route installer with `blockwise-homepage-preview-bc3237a6db4b:3000`, then verify public revision and unchanged product health.
- Source worktree: `/projects/blockwise-homepage-chat-reconciled-20260907`; branch `codex/workflow-continuity-20260908`. Source, Git history, evidence and documented live/rollback containers are retained. Artifact cleanup or retention is recorded in the evidence directory after checking active consumers.
