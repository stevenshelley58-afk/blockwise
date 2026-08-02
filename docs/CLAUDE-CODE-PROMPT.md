# Claude Code prompt — Blockwise Premium v2 rebuild (Stage 1: everything except Ad Studio)

Copy everything below the line into Claude Code, run from the repo root.

---

Rebuild the Blockwise customer app to the approved **Premium v2** register. This is Stage 1: every customer surface EXCEPT Ad Studio. Ad Studio has its own approved mockup and ships as Stage 2 — do not modify `src/app/(customer)/ad-studio/**` or `src/components/adstudio/**` in this stage beyond what they inherit automatically from shared tokens.

## Read these first, in order

1. `AGENTS.md` — binding engineering rules. The mandatory UI workflow applies to every phase (`$impeccable`, critique → distill → craft → layout → typeset → adapt → polish for redesigns).
2. `docs/REBUILD-PLAN.md` — the full plan this prompt executes. Component sourcing, motion system, white-label config architecture, and phase details live there; this prompt is the execution order and acceptance contract.
3. `mockups/dashboard-premium-v2.html` — open it in a browser at desktop AND ~390px width. This is the approved visual target for shell, Home, Leads, mobile navigation, motion, and the niche-switch behaviour. Match it in spirit and quality, not pixel-for-pixel.
4. `mockups/adstudio-mockup.html` — Stage 2 reference only. Read it so shared components you build (especially Settings sections and the token bridge) support it; do not build it.
5. `src/app/tailwind.css` — the shadcn token bridge. It is the single source of truth for theming; extend it, never bypass it.
6. `DESIGN.md` — the current register. Premium v2 (owner-approved) evolves it: keep the near-black one-voice accent, neutral surfaces, Manrope/Inter, radius scale and density; ADD one vivid niche-configurable data hue for charts/meters/sparklines only (`#2a78d6` for Blockwise), a spring motion system, and complete loading/empty/success states. Update DESIGN.md to v2 in the final phase.

## Standing decisions (owner-approved, do not re-litigate)

- **Library components over hand-built.** Source order: shadcn/ui core → `@shadcn-dashboard` registry (already in `components.json`; use free blocks listed in the plan) → motion-primitives (MIT) → Magic UI (MIT). Kinetics is a spring-value reference only (no license — never paste its code). Do not use canvas-ui, Aceternity, Amicro, or shadcnuikit code.
- **Motion:** build `src/lib/motion.ts` per the plan (spring presets, durations, reduced-motion gate) and use it everywhere. Count-up KPIs, staggered entrances, drawn checks, hover lift on interactive cards only, one confetti moment reserved for first published ad. Nothing loops, nothing exceeds 350ms, everything honors `prefers-reduced-motion`.
- **White-label config:** create `src/config/niche/` (type + `blockwise.ts` + `index.ts`) and move ALL customer-surface copy, nav labels, niche nouns, and the data hue into it as you touch each surface. Customer pages must contain zero niche nouns by the end. Feature flags: `propertyCheck`, `suburbPages`, `guides`.
- **Settings is canonical and shared.** Refactor `settings-view.tsx` (45KB) into per-section components under `src/components/settings/` (account, workspace, billing, connections, team, notifications, danger) with their data access in shared server actions/hooks — NOT page-local code. Stage 2 mounts the same components inside Ad Studio's Settings so an edit in either place is the same edit. Build for that now; do not duplicate any settings logic.
- **Mobile is a first-class app, not a responsive afterthought.** Target: it should feel like a native app. Concretely: the bottom tab bar per the mockup (frosted, safe-area padded, 4 primary tabs + spring press feedback), condensed mobile topbar, 44px minimum touch targets, tables become card lists on mobile (Leads pattern in the mockup), no horizontal scroll at 320px, route transitions under 350ms, `viewport-fit=cover`, and the existing PWA install path kept working. Verify every phase at 390px and 320px as well as desktop.
- **Desktop and mobile are one design system** — same tokens, same components, same copy from config; only layout adapts.

## Execution order

Work phase by phase. One PR per phase, branched from the previous phase's branch (or main once merged). Do not start a new phase with the previous one red.

1. **Phase 0 — Foundations.** Install motion-primitives + Magic UI components used by the plan + missing shadcn primitives (`command`, `popover`, `checkbox`, `chart`). Create `src/lib/motion.ts` and `src/config/niche/`. Token bridge v2: add `--data` hue and `--color-success/warning/error` to the `@theme` bridge. No visible change.
2. **Phase 1 — Shell.** SelfServeShell polish per mockup: page-title/breadcrumb slot, ⌘K command menu (navigate + "Create ad"), config-driven workspace chip (delete the legacy `workspace-chip` class usage), trial pill restyle, route transitions, and the mobile topbar + tab bar to mockup quality.
3. **Phase 2 — Home.** Per mockup: outcome-first KPI row (Leads 30d + delta + sparkline, Cost per lead + delta, Ads live, Ad packs meter with `--data` fill), performance snapshot area chart (crosshair tooltip, endpoint label, table fallback), setup card (animated progress ring, drawn checks, current-step highlight), quick actions. All copy from config.
4. **Phase 3 — Leads.** `datatable-01` base → sorting, quality filter chips, search, pagination, CSV export; keep `LeadQualitySelect`; mobile card list per mockup; registry empty state.
5. **Phase 4 — Performance/Results.** Rebuild `MetaMonitorDashboard` off legacy CSS onto shadcn + Recharts blocks: KPI ticker row, spend/leads/CPL charts (single hue = `--data`, no legend for single series, text never wears the data color), date-range presets (7/30/90), honest disconnected/empty/stale states.
6. **Phase 5 — Ad Radar + Property Check.** Migrate off `.content`/`.page-heading` legacy classes onto the shell + shadcn; restyle search panel + results; gate both behind config feature flags.
7. **Phase 6 — Settings.** The shared-section refactor described above + `account-setting-1/2` visual patterns + copy to config.
8. **Phase 7 — Onboarding & first-run.** `multi-step-form-01` + `progress-02` patterns; confetti on first published ad; skeletons and empty states wherever missing.
9. **Phase 8 — Cleanup & governance.** Remove customer-route dependence on legacy `globals.css` selectors (operator/monitor keep the legacy shell — untouched). DESIGN.md v2. `docs/CLONE-PLAYBOOK.md`. Archive `UI-UX-REVIEW-AND-PLAN.md` (stale palette — brand-drift hazard). Final `$impeccable` audit at desktop + 390px + 320px on Vercel Preview.
10. **Phase 9 — Ship to production.** The work is not done until it is live. Once every phase is green on Vercel Preview: merge to main and deploy to production through the normal Vercel deploy path (AGENTS.md pre-authorizes staging, committing, pushing, merging once green, and Vercel deployment for release work — log decisions in the PR descriptions). Then verify the PRODUCTION URL directly: desktop + 390px, the sign-up → home → leads path, no console errors, PWA install intact. Report the production URL and exactly what was verified on it.

## Acceptance — every phase

- `npm run check` green (NUL check + tests + typecheck). Update or delete stale tests deliberately; never skip.
- Runtime verification on Vercel Preview only (never localhost), desktop AND mobile viewports, per AGENTS.md.
- No new global CSS classes; no parallel component systems; everything through the token bridge.
- Report per AGENTS.md: skills loaded, Impeccable commands used, routes inspected, viewports checked, remaining issues.

## Acceptance — end of Stage 1

- `grep -rn "real estate\|listing\|suburb\|agent" src/app/\(customer\) src/components` → only `src/config/niche/**`, feature-flagged surfaces, and Ad Studio (Stage 2) remain.
- No customer route (except Ad Studio) references legacy `globals.css` selectors.
- Lighthouse a11y on Home, Leads, Results ≥ 95; WCAG AA per PRODUCT.md.
- Operator and monitor surfaces still render unchanged on the legacy shell.

Out of scope for Stage 1: anything under Ad Studio (routes, components, template pipeline), operator/monitor rebuild, landing/pricing/guides marketing pages, database schema changes, auth changes, provider behaviour.
