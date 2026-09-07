# Homepage reporting chart axis fix

Date: 7 September 2026

## Released outcome

- Preview: https://blockwise.sale/homepage-preview/concept#results
- Compiled revision: `70a6189973eb069d0715831ac50e7c16eeaffd0f`
- Image/container: `blockwise-homepage-preview:70a6189973eb` / `blockwise-homepage-preview-70a6189973eb`
- Source branch: `fix/homepage-chart-axis-20260907`

The graph had seven points and seven labels in its fixture, but its visible
x-axis rendered only the first and last labels. The corrected desktop axis
renders every label at the same horizontal coordinate as its point. Narrow
screens retain all seven weekday labels and show the first, middle and last
30-day buckets to avoid collisions.

The later hero playback-control removal from `fb791d735fc6` was retained.
No production application, provider, database or authentication route changed.

## Verification

- NUL scan, full tests, TypeScript check and production build passed.
- Candidate browser checks passed at 1440, 390 and 320 CSS pixels.
- No visible label overlap, horizontal overflow, browser console error or page error.
- Public desktop shows all seven weekday and all seven 30-day labels.
- Public phone shows all seven weekdays and three evenly spaced 30-day labels.
- Public GET returned 200, POST returned 405 and the preview application API returned 404.
- The container is healthy, non-root, read-only, capability-dropped and limited to 1 GB.

## Rollback

Reapply the preceding preview with `scripts/vps/homepage-preview-route.py
--upstream blockwise-homepage-preview-fb791d735fc6:3000 --apply` after
verifying that container is still healthy. The route updater preserves
production routes.
