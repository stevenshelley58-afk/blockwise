# Homepage reporting chart axis and reveal

Date: 7 September 2026

## Released outcome

- Preview: https://blockwise.sale/homepage-preview/concept#results
- Compiled revision: `bac4d13725432dc6e5f2cc637f100aea2d722d60`
- Image/container: `blockwise-homepage-preview:bac4d1372543` / `blockwise-homepage-preview-bac4d1372543`
- Source branch: `fix/homepage-chart-axis-20260907`

The graph had seven points and seven labels in its fixture, but its visible
x-axis rendered only the first and last labels. The corrected desktop axis
renders every label at the same horizontal coordinate as its point. Narrow
screens retain all seven weekday labels and show the first, middle and last
30-day buckets to avoid collisions.

The shared line-and-fill reveal now runs for 1.5 seconds. It replays whenever
the chart enters the viewport and whenever the visitor switches between the
7-day and 30-day ranges. Leaving the viewport resets the clip immediately so
the next entry redraws cleanly. Reduced-motion users still receive the complete
chart without animation.

The later hero playback-control removal from `fb791d735fc6` was retained.
No production application, provider, database or authentication route changed.

## Verification

- NUL scan, full tests, TypeScript check and production build passed.
- Candidate browser checks passed at 1440, 390 and 320 CSS pixels.
- No visible label overlap, horizontal overflow, browser console error or page error.
- Public desktop shows all seven weekday and all seven 30-day labels.
- Public phone shows all seven weekdays and three evenly spaced 30-day labels.
- Candidate and public browser checks confirmed partial clip progress during
  entry, range change and re-entry, followed by the complete 608-unit reveal.
- Reduced-motion entry and switching remained immediate.
- Public GET returned 200, POST returned 405 and the preview application API returned 404.
- The container is healthy, non-root, read-only, capability-dropped and limited to 1 GB.

## Rollback

Reapply the preceding preview with `scripts/vps/homepage-preview-route.py
--upstream blockwise-homepage-preview-70a6189973eb:3000 --apply` after
verifying that container is still healthy. The route updater preserves
production routes.
