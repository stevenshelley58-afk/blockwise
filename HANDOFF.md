# Handoff — Monitor Dashboard Redesign

## Goal
Redesign the **monitor dashboard** UI. Workflow: propose one visual direction, apply it, then the user reviews in the browser (`npm run dev`) and we iterate. This is a *design* pass, not bug-fixing.

## Primary files
- `src/components/monitor/monitor-dashboard.tsx` — the dashboard component (client component, uses `@tanstack/react-table` + `recharts`).
- `src/app/globals.css` — all styling lives here. Monitor styles are around the `.monitor-*` selectors (search `monitor-performance-table`, `monitor-provider-strip`, `monitor-mobile-details`).

## Design system — reuse these tokens, don't invent new ones
CSS variables already defined in `globals.css`:
- `--ink` (primary text / dark), `--muted` (secondary text), `--line` (borders), `--surface-subtle` (hover/fill backgrounds).
Existing component classes worth matching: `.button` / `.button.secondary` / `.button.primary` / `.button.ghost`, `.panel`, `.table` / `.table-wrap`, `.status-pill`, `.metric-card`, `.nav-link`.

## Constraints
- **Do not touch `src/lib/research/*`** or the research API routes — they have ~20 pre-existing `tsc` errors (Jsonb type mismatches, stale `@ts-expect-error`) unrelated to UI. Ignore them when verifying; they are not regressions.
- Keep `monitor-dashboard.tsx` a client component (`"use client"`).
- Verify with `npm run typecheck` — your changes should add **zero** new errors beyond the known research ones.

## What was already done this session (P0 fixes — may be committed or uncommitted)
These are bug-fixes, NOT the redesign. Check `git status` / `git log` to see if they're committed:
1. **`operator/research/page.tsx`** — replaced non-existent `btn-secondary` class with `button secondary` (3 spots).
2. **Sidebar active state** — extracted nav into new client component `src/components/sidebar-nav.tsx` using `usePathname`; `app-shell.tsx` now passes a `variant` prop. Added `.nav-link.active` CSS (left accent bar + fill).
3. **Monitor row affordance** — added a chevron column to `monitor-dashboard.tsx` (`ChevronDown`, rotates 180° when expanded) plus row keyboard support (`role="button"`, `tabIndex`, `aria-expanded`, Enter/Space) and `:focus-visible` outline. Related CSS: `.monitor-expand-col`, `.monitor-expand-toggle`, `.monitor-expand-chevron`.

If these are uncommitted and you want a clean redesign diff, commit them first:
```
git add -A && git commit -m "fix: P0 UI issues (nav active state, monitor row affordance, button class)"
```

## Known redesign opportunities for the monitor dashboard (from earlier audit)
- No visible success confirmation after Meta setup save (needs `aria-live` + visible toast/state).
- Provider status strip (`.monitor-provider-strip`) needs a responsive grid for many providers.
- Metric cards: label is 13px uppercase (shouts) vs 30px value — rebalance typography.
- Monitor `<select>` labels lack `htmlFor`/`id` association (a11y).
- Overall: tighten visual hierarchy, spacing rhythm, and the performance-table density.

## Suggested first prompt
> Read HANDOFF.md. Redesign the monitor dashboard per its goal and constraints. Propose one cohesive visual direction and apply it to `monitor-dashboard.tsx` + `globals.css`, then summarize what changed so I can review at localhost. Reuse the existing design tokens; don't touch `src/lib/research/*`.

## Verify
```
npm run typecheck   # expect only the known pre-existing research errors
npm run dev         # review at http://localhost:3000 (monitor route)
```
