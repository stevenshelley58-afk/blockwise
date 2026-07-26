# Blockwise Customer Dashboard Rebuild — Plan

Date: 2026-07-26 · Scope: full customer surface (Home, Ad Studio shell, Performance, Ad Radar, Property Check, Leads, Settings, Onboarding) · Direction approved by owner: **premium + motion, white-label layer built in, library components over hand-built UI.**

Companion file: `dashboard-mockup.html` — interactive mockup of the target register (Home + Leads), including a live **Blockwise ↔ DentistWise niche switch** demonstrating the white-label layer.

---

## 1. Where the app stands today (audit summary)

The stack is already the right one and does not change: Next.js 16, React 19, Tailwind v4, shadcn/ui (new-york, Radix), lucide, Recharts 3, TanStack Table 8, `motion` v12, sonner, next-themes. `components.json` already registers the `@shadcn-dashboard` registry and one block (`button-01`) is already in use.

The customer shell (`SelfServeShell`) already runs on the shadcn Sidebar, wired through the token bridge in `src/app/tailwind.css` (shadcn semantic tokens → Blockwise CSS vars). **That bridge is the single most valuable asset for white-labeling — everything in this plan flows through it.**

Surfaces are at three maturity levels:

| Level | Surfaces |
|---|---|
| Already on shadcn | Self-serve Home (good quality), Leads (basic table, no TanStack features) |
| Legacy CSS | Performance/Results (`MetaMonitorDashboard`), Ad Radar (`.content` / `.page-heading` classes), operator + monitor shells |
| Mixed / oversized | Settings (`settings-view.tsx`, 45KB single file), Ad Studio |

Two structural problems block the "clone for DentistWise" goal more than any visual issue:

1. `globals.css` is 165KB of legacy hand-written CSS still loaded everywhere. Customer routes must stop depending on it (operator keeps it until its own migration).
2. **Copy and niche nouns are hardcoded inline in every page** — "real estate · AU", "Turn a listing into Feed and Story creatives", nav labels in `sidebar-nav.tsx`, setup step titles, empty states. This is the actual cloning blocker.

---

## 2. Direction — the "Premium v2" register

This is an **evolution of the "quiet operations desk"**, not a replacement. DESIGN.md currently mandates near-zero motion; the owner has explicitly directed the evolution below, and DESIGN.md gets a v2 update in Phase 8 codifying it (DESIGN.md itself states later owner direction supersedes).

**Keep** (unchanged): near-black single action accent (One Voice Rule), neutral layered surfaces, Manrope display + Inter body, radius scale (10/16/20px), compact density, sentence case, semantic colors for status only, WCAG AA targets.

**Add:**

1. **Data color as the only vivid voice.** UI chrome stays monochrome; charts, sparklines, meters and progress get one vivid, niche-configurable data hue. Blockwise: `#2a78d6` (validated: lightness band, chroma, ≥3:1 contrast on white — dataviz palette checks pass). DentistWise example: `#0e8a68` (also validated). Decorative color stays banned; informational color becomes the premium signature.
2. **A real motion system** (section 4): spring-based state changes, count-up numbers, staggered entrances, drawn checkmarks, one celebration moment. Everything ≤ 350ms, everything honoring `prefers-reduced-motion`.
3. **Premium finish details:** layered soft shadows (rest `0 1px 2px rgba(16,18,23,.04), 0 8px 24px rgba(16,18,23,.06)`; float deeper on hover), `tabular-nums` in tables and tickers, mono uppercase micro-labels for metadata, and a complete set of empty / loading / success states on every surface (skeletons from the registry, not spinners).

---

## 3. Component sourcing — build nothing from scratch

Priority order when a surface needs a component:

1. **shadcn/ui core** (installed) — primitives. Add missing ones as needed: `command` (⌘K menu), `popover`, `checkbox`, `chart`.
2. **`@shadcn-dashboard` registry** (already wired; MIT open-source base, freemium blocks). Free blocks this plan uses: `dashboard-layout-01`, `sidebar-01`, `number-ticker-04`, `sales-trend-chart`, `area-chart-01`, `area-chart-07`, `bar-chart-01`, `radial-chart-04` (KPI rings), `datatable-01` (TanStack, exportable), `account-setting-1`, `account-setting-2`, `animated-list-02` (motion setup checklist), `progress-02` (onboarding stepper), `multi-step-form-01/02`, `no-data-empty-state`.
3. **motion-primitives** (MIT, built on `motion` v12, shadcn-registry install): `AnimatedNumber`, `SlidingNumber`, `AnimatedGroup`, `InView`, `TransitionPanel`.
4. **Magic UI** (MIT, registry install): `NumberTicker`, `BlurFade`, `AnimatedList`, `Confetti`, `AnimatedCircularProgressBar`.
5. **Kinetics (kinetics.colorion.co)** — *reference only* for tuned spring stiffness/damping values. It has **no license**; re-type values, never paste code.

**Skip:** canvas-ui (WebGL page effects, needs an experimental Chrome flag, Commons Clause license — landing-page material at best, wrong tool for the dashboard), Aceternity UI (non-MIT, aesthetic too loud), Amicro (pre-alpha, no npm package), shadcnuikit free tier (usage rights undocumented — reference only unless Pro is purchased).

**Optional purchase decision (defer to Phase 3):** shadcndashboard Starter ($89 one-time) unlocks `datatable-02..12` and the premium shells. Not required — the free set covers this plan. Buy only if `datatable-01` feels thin for Leads.

**Install rules:** registry blocks are source you own — restyle to Blockwise tokens on arrival (they ship Geist/stock-shadcn styling; ours comes from the token bridge automatically for colors, but check radii/spacing). Blocks import from your own `@/components/ui/*`, so Radix compatibility is a non-issue (only `checkbox-07/09` import Base UI directly — avoid those two). Delete the `LyraStyleProvider` any shell block ships. Watch shadcn CLI overwrite prompts on existing `components/ui/*` files — review diffs, keep local versions. Pull blocks by registry *name*, not title (titles are mislabeled in places, e.g. `dashboard-shell-03` is titled "01 – Modern").

---

## 4. Motion system

One module, `src/lib/motion.ts`, exports the entire vocabulary — pages never define their own timings:

- Spring presets (from Kinetics-tuned values, re-typed): `snappy` (stiffness 400, damping 30) for micro-interactions, `gentle` (260, 28) for entrances, `slow` (170, 26) for progress/meters.
- Durations: micro 150ms, state 250ms, entrance 350ms. Nothing slower.
- `useReducedMotion` from `motion/react` gates everything; reduced = opacity-only, no transforms, numbers render final value instantly.

Usage map:

| Moment | Component | Source |
|---|---|---|
| KPI numbers | `AnimatedNumber` (count-up on view) | motion-primitives |
| Card/list entrance | `AnimatedGroup` stagger 40ms, 12px rise + fade, once per navigation | motion-primitives |
| Route transitions | fade/slide via `template.tsx` in `(customer)` | motion |
| Buttons | `whileTap` scale 0.97; arrow-nudge on hover | motion |
| Interactive cards | hover lift −2px + float shadow (interactive cards only, never static panels) | CSS |
| Setup steps | drawn SVG checkmark + spring row highlight | animated-list-02 pattern |
| Progress ring / meters | animated stroke/width | AnimatedCircularProgressBar |
| First ad published | one confetti burst — the only celebration in the product | Magic UI Confetti |

Banned: looping/idle animation, parallax, gradient shimmer, hover motion on non-interactive elements.

---

## 5. White-label layer (the DentistWise story)

New directory `src/config/niche/` — the **only** place niche identity lives:

```
src/config/niche/
  niche.ts        // NicheConfig type
  blockwise.ts    // current copy, extracted verbatim
  dentistwise.ts  // (created at clone time)
  index.ts        // export const niche = blockwise  ← the single switch
```

`NicheConfig` shape:

- `product`: name, legal name, domain, support email, logo variant key
- `industry`: label ("Real estate"), audience noun ("agents"), region default
- `terms`: dictionary of swap-able nouns — `lead`, `listing`/`offer`, `campaign`, `area` ("suburb") — used via a tiny `t()` helper
- `theme`: data hue, accent overrides → feeds the CSS vars in the token bridge (`--data`, `--accent-*`)
- `nav`: labels + which routes exist
- `copy`: per-surface dictionaries (home headings/CTAs for each setup state, empty states, onboarding steps, settings section intros)
- `features`: flags for niche-specific surfaces — `propertyCheck`, `suburbPages`, `guides` (DentistWise launches with these off; nav and routes respect the flags)
- `assets`: paths under `public/niche/<key>/` (logo, OG images, sample creatives)

Rules that make cloning trivial:

1. Customer pages and components may not contain niche nouns or copy strings — only `niche.*` references. Enforced by a grep acceptance check (below).
2. Images referenced by customer surfaces live under `public/niche/<key>/`.
3. Database schema stays niche-neutral (it already mostly is: workspaces, leads, campaigns, brand kits).
4. Marketing pages (landing, pricing, guides) are the second copy surface — same config approach, can trail the app rebuild.

**Clone playbook** (ships as `docs/CLONE-PLAYBOOK.md`): clone repo → new Supabase project + run migrations → new Vercel project + env from `.env.example` → write `src/config/niche/dentistwise.ts` → drop assets into `public/niche/dentistwise/` → flip `index.ts` export → set feature flags → deploy. Target: **a working DentistWise in under a day, with zero component edits.**

Acceptance: `grep -rn "real estate\|listing\|suburb\|agent" src/app/\(customer\) src/components` returns only config imports and `features.*`-flagged surfaces.

---

## 6. Phased execution (one PR per phase, `npm run check` green + Vercel Preview verification each — per AGENTS.md, with the `$impeccable` workflow for each UI phase)

**Phase 0 — Foundations (~1 day).** Install motion-primitives + Magic UI components and missing shadcn primitives; create `src/lib/motion.ts`; scaffold `src/config/niche/` and move *shell-level* copy (nav labels, workspace chip, trial pill) into `blockwise.ts`; token bridge v2 (`--data` hue, `--color-success/warning/error` in `@theme` — some registry blocks reference `text-success` etc.). No visual change yet.

**Phase 1 — Shell polish (~1 day).** SelfServeShell refinements: page-title/breadcrumb slot in the topbar, ⌘K command menu (shadcn `command`) for navigation + "create ad", cleaner workspace chip from config (kill the legacy `workspace-chip` class), sidebar footer trial pill restyle, route entrance transitions.

**Phase 2 — Home (~1–2 days).** Per the mockup: KPI tiles with `AnimatedNumber` + sparklines + deltas, setup card with animated progress ring and drawn checks, performance snapshot area chart (`area-chart-01` restyled, crosshair tooltip, 30-day default), quick-action cards. Home copy → config.

**Phase 3 — Leads (~1–2 days).** `datatable-01` base → sorting, quality filter, search, pagination, CSV export; keep `LeadQualitySelect` and the mobile card list; empty state from registry. Decide here whether the $89 license is worth it.

**Phase 4 — Performance/Results (~2–3 days).** The big one: rebuild `MetaMonitorDashboard` from legacy CSS onto shadcn Cards + Recharts chart blocks — KPI header row (tickers + deltas), spend/leads/CPL charts, date-range control (preset rows: 7/30/90 days), honest disconnected/empty/stale states. This retires the largest legacy-CSS customer surface.

**Phase 5 — Ad Radar + Property Check (~1–2 days).** Migrate off `.content`/`.page-heading` onto the shell + shadcn; restyle the search panel and results grid; feature-flag both surfaces via config.

**Phase 6 — Settings (~1–2 days).** `account-setting-1/2` patterns; split the 45KB `settings-view.tsx` into per-section components (account, billing, connections, team, notifications, danger); copy → config.

**Phase 7 — Onboarding & first-run (~1 day).** `multi-step-form-01` + `progress-02` patterns for onboarding; confetti on first published ad; skeletons + empty states everywhere they're missing.

**Phase 8 — Cleanup & governance (~1 day).** Remove customer-route dependence on legacy `globals.css` selectors (operator keeps them); DESIGN.md v2 (codify Premium v2 register + motion vocabulary); write `docs/CLONE-PLAYBOOK.md`; run the niche-noun grep acceptance; final `$impeccable` audit pass at desktop + mobile viewports on Vercel Preview.

Total: roughly 10–14 working days of focused effort.

---

## 7. Risks & notes

- **Registry gating:** the best shells/datatables are behind the $89–149 license; the plan deliberately uses the free set. If a gated block is ever pulled, it needs `EMAIL` + `LICENSE_KEY` env vars for the CLI.
- **Ad Studio** is out of scope for this rebuild (it has its own approved architecture and migration path per DESIGN.md) but inherits every token/motion change automatically through the bridge.
- **Operator/monitor** stays on the legacy shell until its own migration — the two systems already coexist by design; nothing here breaks that.
- **Recharts**: all chart blocks used are Recharts-based (avoid `table-13`, ApexCharts). Chart styling follows the dataviz rules already applied in the mockup: single hue for single series, no legend for one series, text never wears the data color, tooltips + table fallback for accessibility.
- The old `UI-UX-REVIEW-AND-PLAN.md` (June, navy-era palette) is superseded by this plan and should be archived in Phase 8 to avoid brand-drift for future agents — same hazard it itself warned about.
