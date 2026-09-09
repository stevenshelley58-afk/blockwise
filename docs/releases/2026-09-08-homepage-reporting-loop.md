# Reporting chart-to-email loop, 8 September 2026

Historical release evidence for the isolated homepage preview.

- URL: https://blockwise.sale/homepage-preview/concept#results
- Final compiled revision: `2edfff58c68b3739aa50da6d21ce80cc516ff29a`.
- Flow: draw the existing weekly line, wait350ms after its actual completion, crossfade to the existing sample email, hold for5 seconds, crossfade back and redraw. Repeats while visible.
- Crossfades reuse the shared250ms state duration. Returning line drawing waits for that crossfade before starting. Both panels remain mounted in the same grid cell, preserving layout height.
- Manual period selection and focus within the content pause automatic rotation. A44px play/pause control allows restarting. Autoplay does not advance off-screen or in a hidden document.
- Native reduced-motion preference changes are observed with a cleaned-up media-query listener. Reduced motion disables autoplay and hides the loop control while manual views remain available.
- This repeating animation is explicitly requested by the user. Other motion policy and homepage sections are unchanged. No network, email or campaign integration was added.

## Verification

- NUL check, full tests, typecheck, production build and whitespace check passed.946 tests passed, zero failed, one existing root-permissions test skipped because root bypasses chmod restrictions.
- Public browser verified final compiled revision and two complete return/redraw cycles:900 frames, zero blank frames,25 crossfade overlap frames and zero panel-height change. Both email transitions began with reveal width608; chart returns reset width to0.
- Final dynamic reduced-motion test stopped on the email for6200ms and hid the loop control. Normal-motion settings were restored afterward.
- Final320px mobile check: no control/email overflow, manual30-day selection showed the play control. Initial visual mobile check confirmed a44px pause target.
- Initial-loop checks additionally held manual selection and off-screen state unchanged for6500ms. A restarted cycle completed the line at1668ms and selected email at2052ms.
- Final candidate and public HTML matched. All seven current sections were preserved, with no em dashes. Preview-only router comparison passed. Product stayed at `674b512139961927191f3659a64737a2e0db1cdd` and the canonical exact-revision health gate passed.
- Evidence: `/projects/blockwise-homepage-chat-reconciled-20260907/work/homepage-reporting-loop/`.

## Retention and rollback

- Live container/image: `blockwise-homepage-preview-2edfff58c68b3739` / `blockwise-homepage-preview:2edfff58c68b3739`.
- Prior stable rollback container/image: `blockwise-homepage-preview-3c5ac511636a3639` / `blockwise-homepage-preview:3c5ac511636a`.
- Rollback revision: `3c5ac511636a3639edaad600ade08067f8f13c6d`.
- Restore through the existing preview-only route installer using the rollback upstream on port3000, then verify public revision and unchanged product health.
- The intermediate task build `28389198cceccd8b2434b6287f2d59ae35440100` may be retired after verifying it has no route or other consumers. Cleanup results are retained in the evidence directory.
- Source worktree `/projects/blockwise-homepage-chat-reconciled-20260907`, branch `codex/workflow-continuity-20260908`, Git history and release evidence are retained.
