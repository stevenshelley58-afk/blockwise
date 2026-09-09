# Smooth reporting graph — 7 September 2026

Preview: https://blockwise.sale/homepage-preview/concept#results
Compiled revision: e7ba472db8f331c2876933716e1e7173c7dcefdb
Container: blockwise-homepage-preview-e7ba472db8f3

Replaced straight segments with bounded cubic curves and a shared SVG clipping reveal for line and fill. The 1.2-second marketing motion is viewport-triggered, once only, with an immediate reduced-motion path. Removed email controls, schedule helpers and floating notification. Added the requested humorous personal-dashboard/email copy.

Preserved the concurrently published bb566f85 hero through a merge; reporting remains ResultsReporting. Full tests, typecheck, NUL scan and production build passed after merging. Browser verification at 390px and 1440px measured clip width 0 offscreen, intermediate width during reveal, 608 at completion. Both paths share the clip; range morphs work, controls are absent, no overflow or page errors. Reduced motion remains 608 throughout. Public revision and copy verified after the preview-only route switch.

Rollback: use scripts/vps/homepage-preview-route.py with upstream blockwise-homepage-preview-bb566f8523b0:3000 after verifying that container exists; never restore a whole router configuration.
