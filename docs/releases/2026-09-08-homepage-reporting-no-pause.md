# Reporting loop without playback button, 8 September 2026

Historical release evidence for the isolated homepage preview.

- URL: https://blockwise.sale/homepage-preview/concept#results
- Compiled application revision: `6ea2231796f6da2399e490a1e7443564085747be`.
- Removed the visible play and pause button. The chart-to-email loop remains automatic.
- Manual 7-day, 30-day and Email selection remains available. After manual selection, the automatic loop continues rather than becoming permanently paused.
- Full tests, NUL check, typecheck, production build and diff check passed.
- Public browser verified that the reporting toolbar contains only the three requested selectors and no playback control.
- Browser verified the automatic sequence Email to 7 days to Email, then manually selected 30 days and verified the loop continued to Email and back to 7 days.
- Candidate and public HTML matched. All current homepage sections remain present and no em dashes are rendered.
- Preview-only router comparison passed. Product health passed at the independently observed current product revision `b56816d5a3081ea3460ff3cd250493a02d146089`.
- Live preview container/image: `blockwise-homepage-preview-6ea2231796f6da2` / `blockwise-homepage-preview:6ea2231796f6da2`.
- Immediate rollback: `blockwise-homepage-preview-2edfff58c68b3739` / `blockwise-homepage-preview:2edfff58c68b3739`.
- Evidence: `/projects/blockwise-homepage-chat-reconciled-20260907/work/homepage-loop-no-button/`.
