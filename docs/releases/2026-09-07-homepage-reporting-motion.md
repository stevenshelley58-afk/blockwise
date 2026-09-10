# Motion-led reporting graph — 7 September 2026

- Preview: https://blockwise.sale/homepage-preview/concept#results
- Compiled source: `f06e3b61180c7a92495b0c372f368b6698d190a8`.
- Image/container: `blockwise-homepage-preview:f06e3b61180c` / `blockwise-homepage-preview-f06e3b61180c`.
- VPS source: `/projects/blockwise-homepage-value-20260907`; branch `codex/homepage-value-redesign-20260907`.

## Direction

The reporting section now sells one benefit: immediate visibility without waiting for an agency update. The approved copy is “Know how your ads are going.” and “Your dashboard. Updates when you want them.”

The split copy/card layout was replaced by one full-width data canvas. Three metrics lead into a large line graph. A small update preview and Daily/Weekly/Custom controls show that the same reporting can arrive by email. There is no duplicate dashboard chrome, feature list or section CTA.

## Motion and behaviour

Motion follows the shared Blockwise timings and Emil Kowalski-style functional animation principles. The line draws once over a visible static base. The 7-day and 30-day paths use matching vertices so period changes morph rather than redraw abruptly. Active pills glide between options. Pointer movement reveals the nearest data point. Cadence changes update the floating email preview. Keyboard changes are immediate and reduced-motion users receive no movement.

The fixtures are isolated in `src/lib/homepage-concept/reporting.ts`. Nothing is fetched, saved or sent.

## Verification

- `npm run check:nul`: passed.
- `npm run test`: passed; root suite 70 passed with one existing skip, and package suites 11/11 and 17/17 passed.
- `npm run typecheck`: passed.
- Preview production build and isolated container image build: passed.
- Impeccable detector with project design-system comparison disabled: no findings. The broader existing marketing stylesheet continues to produce only design-system drift findings already accepted for this concept.
- Public desktop at 1440px and phone at 390px inspected: no horizontal overflow.
- Public interactions verified: the graph morphs, the tooltip reports the nearest point, and custom 14-day scheduling updates correctly.
- No browser console or page errors.
- Public GET returned 200 with the exact compiled revision and `noindex, nofollow, noarchive`.

## Hosting and rollback

The preview remains in its separate non-root, read-only, no-credentials container on the dedicated internal network. Production application routes and provider integrations were not changed.

Reapply with:

`python3 scripts/vps/homepage-preview-route.py --upstream blockwise-homepage-preview-f06e3b61180c:3000 --apply`

The preceding preview `blockwise-homepage-preview-60d26b84b006` remains available for rollback through the same preview-only route updater.
