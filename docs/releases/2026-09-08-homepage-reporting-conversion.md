# Homepage reporting conversion update, 8 September 2026

## Published preview

- Preview: https://blockwise.sale/homepage-preview/concept#results
- Compiled revision: `969f80e19fc69c96b07324c08eb83de7400bc62e`.
- Container/image: `blockwise-homepage-preview-969f80e19fc6` / `blockwise-homepage-preview:969f80e19fc6`.
- Source retained: `/projects/blockwise-homepage-chat-reconciled-20260907`, branch `codex/workflow-continuity-20260908`.
- Immediate preview rollback retained: `blockwise-homepage-preview-02f632fe7b5e`, revision `02f632fe7b5edccb8bb527bfa2e83da93aa4bc4b`.

## Approved conversion changes

The reporting section now leads with `See your leads. Know your costs.` It explains the three key reporting measures in the subheading, uses clearer metric labels, shows a compact email-update preview, and offers a `Start free trial` action with the existing `No card required.` reassurance.

The chart remains interactive and has been reduced by one quarter so lead and cost figures are easier to scan. The `Example data · AUD` label was removed. No new user-facing copy contains an em dash. The section remains isolated static frontend data with no backend, email, analytics, or provider integration.

## Verification

- `npm run check:nul`, `npm run test`, `npm run typecheck`, preview `npm run build`, and `git diff --check`: passed.
- Candidate and public preview HTML matched byte-for-byte. The exact compiled revision, revised copy, all seven homepage sections, and removal of `Example data · AUD` were checked.
- Public preview GET returned 200 with no-index and no-store headers. POST returned 405 and the preview API returned 404.
- All non-preview Caddy configuration remained identical before and after the preview route switch.
- Desktop and phone browser inspection at 1440 and 390 CSS pixels confirmed no horizontal overflow, an unclipped layout, the 264px desktop and 165px phone chart heights, the trial action, and the removed label. Browser error log was empty.
- The main product revision changed independently during the preview update. Its current ready revision is `674b512139961927191f3659a64737a2e0db1cdd`, and the maintained product health gate passed against that exact revision. No product deployment or provider writes occurred in this change.

## Retention

The live preview container is healthy, read-only, unprivileged, secret-free, and has no source bind mounts. Source, Git history, retained rollback containers, and evidence under `work/` are preserved. Regenerable dependencies and build outputs were removed after checking for active workspace consumers.

This is historical release evidence, not a replacement for the current operating guides.
