# Blockwise UI/UX Review & Execution Plan

Date: 2026-06-10. Scope: all surfaces (landing, pricing, auth, customer app, Ad Studio, Monitor, Research).
Audience: an executing agent. Every task states the file, the exact change, and an acceptance check. Do tasks in order. Do not improvise beyond what is written.

---

## Part 1 — Verdict

The good news: this is **not AI slop**. The design system ("Executive Precision" — deep navy `#123e75`, slate neutrals, Manrope display + Inter body, whisper shadows) is disciplined and intentional. No purple gradients, no emoji, no "Unleash your potential" copy, no default-Tailwind look. The bones are premium.

What keeps it from *feeling* premium is **drift and unfinishedness**, specifically:

1. **Three design languages coexist.** The app shell (4px controls, 8px cards), Ad Studio (8px controls, 12px cards, its own `--st-*` shadow tokens in a CSS-in-JS string), and the landing page (10–16px radii, a one-off bright blue `#2563eb` hero button) read as three different products. Premium = one voice everywhere.
2. **Token discipline collapsed below the `:root` block.** `globals.css` (6,409 lines) re-hardcodes the palette hundreds of times (54× `#ffffff`, 31× `#131b2e`, 16× `#123e75`...). `meta-monitor.css` hardcodes its KPI tone palette. `adstudio/styles.ts` ships a *stale navy* — `rgba(31,58,110,.28)` — that no longer matches the brand `#123e75`.
3. **Conversion-killing placeholder:** the pricing page literally shows **"$X / month"** (`src/app/pricing/page.tsx:105`).
4. **Two competing conversion paths** (self-serve trial vs. book-a-walkthrough) given equal weight in 3+ places on the landing page.
5. **Missing "expensive" details:** no loading skeletons or button spinners, dead UI (a permanently `disabled` Collapse button, a decorative ChevronDown on a non-interactive workspace chip), no inline form validation, unstyled success states, no hover micro-interactions on cards.
6. **Stale design artifacts in repo root** (`landing-demo.html`, `design-redesign-preview.html`, `landing-preview.html`) containing two *other* abandoned palettes (`#1f3a6e`, teal `#087f7a`) — a brand-drift hazard for any agent that reads them.

Premium feel is the accumulation of consistency + finished states + restrained motion. The plan below converges everything onto one system and finishes the unfinished.

---

## Part 2 — The canonical design language (converge everything onto this)

Any change in Part 3 must conform to this table. When in doubt, this section wins.

| Token | Value | Notes |
|---|---|---|
| Brand navy | `#123e75` (`--accent`) | The ONLY interactive blue. Kill `#2563eb`, `#1d4ed8`, `rgba(31,58,110,*)` |
| Navy hover | `#0d3263` (`--accent-strong`) | |
| Navy press | `#002855` (`--accent-press`) | |
| Navy tint | `#eef3fb` (`--accent-tint`) | |
| Ink / muted / faint | `#131b2e` / `#475569` / `#94a3b8` | |
| Lines | `#dfe6f0` (`--line`), `#edf1f6` (`--line-soft`) | |
| Status | green `#006d38`/`#ecfdf5`, amber `#8a5a00`/`#fdf8ee`, rose `#ba1a1a`/`#fdf3f2` | |
| **Radius scale** | controls **8px**, cards **12px**, large surfaces/dialogs **16px**, pills `9999px` | This adopts Ad Studio's (newest, best) scale app-wide |
| Shadows | rest `0 1px 2px rgba(15,23,42,.04)`, float `0 4px 20px rgba(15,23,42,.08)` | Never heavier at rest |
| Focus ring | `0 0 0 3px rgba(18,62,117,.12)` (`--ring`) | Every interactive element |
| Motion | `transition: ... 150ms ease` on color/border/shadow/transform; hover lift = `translateY(-1px)` + float shadow | Nothing slower than 200ms |
| Type | Manrope display / Inter body; numbers always `font-variant-numeric: tabular-nums` | |
| Buttons | height 40px (compact 32px), radius 8px, weight 600, primary = navy fill, secondary = white + `--line` border, ghost = transparent | One system across landing + app + studio |

Guardrails (from `AGENTS.md` — these are hard rules):

- Do NOT change auth behaviour, database schema, public API response shapes, or provider behaviour.
- These are **Simplification PRs**: tag PRs `simplification`, state which user-facing complexity each removes. LOC may increase where it removes user confusion.
- Verify with `npm run check` (NUL check + tests + typecheck) before every commit. No localhost smoke tests as deploy acceptance — use Vercel Preview.
- Do not copy code from the external reference repos.

---

## Part 3 — Execution plan

### Phase 0 — Conversion blockers & brand-drift hazards (do first, ~half day)

**T0.1 — Delete stale design artifacts.**
Delete from repo root: `landing-demo.html`, `landing-preview.html`, `design-redesign-preview.html`. They contain abandoned palettes (`#1f3a6e`, `#087f7a`) that contaminate future work. Git history preserves them.
*Accept:* files gone, `npm run check` passes, no imports referenced them (grep first: `grep -rn "landing-demo\|landing-preview\|design-redesign-preview" src/ scripts/ package.json`).

**T0.2 — Real price on the pricing page. ⚠ OWNER INPUT REQUIRED.**
`src/app/pricing/page.tsx:94-105` shows `$X / month`. Ask the owner for the real monthly price before doing this task; do not invent one. Replace the placeholder and delete the TODO comment. If the owner has not supplied a price, ship an interim fix: replace the `$X / month` block with the trial-led framing "Free for 7 days — 10 ad packs included" as the visual headline of the card, moving price to "then $— / month" only once known. A visible `$X` must not remain in production.
*Accept:* no literal `$X` anywhere in `src/`.

**T0.3 — One primary conversion path on the landing page.**
`src/app/page.tsx`. Currently three trial callouts + two demo callouts compete. Changes:
1. Hero (≈lines 104–179): keep ONE primary button, copy **"Start free trial"** (not "Free Trial"), linking `/signup`. Next to it a plain text link "Book a 15-min walkthrough →" that scrolls to the demo form. Remove any second button styling in the hero.
2. "Free trial" dark band (≈lines 448–468): keep, but its CTA copy becomes "Start free trial" — identical wording everywhere (premium products repeat one phrase; variation reads as sloppiness).
3. Managed-setup section (≈lines 470–482): retitle the CTA "Prefer us to set it up? Book a walkthrough" — visually secondary (ghost/text style, never the filled primary style).
*Accept:* exactly one filled-primary CTA visible per viewport-height of scroll; the string "Start free trial" is the only trial CTA wording on the page.

**T0.4 — Kill the off-brand hero blue.**
`src/app/landing.css`: lines 11–12 define `--lp-blue: #2563eb; --lp-blue-dark: #1d4ed8`. Replace all usages (lines ~74, 77, 126, 749, 752, and any others — grep `lp-blue`) with `--lp-primary` (`#123e75`) and hover `#0d3263`. Then delete the `--lp-blue` / `--lp-blue-dark` token definitions.
*Accept:* `grep -n "2563eb\|1d4ed8\|lp-blue" src/app/landing.css src/` returns nothing.

**T0.5 — Track all CTAs, not just demo CTAs.**
`src/components/landing/cta-link.tsx` only fires tracking for demo CTAs. Generalize to fire a `cta_click` event with a `cta` label prop for every landing CTA (hero, band, nav, pricing). Do not change the existing demo event name (analytics continuity); add alongside.
*Accept:* every `<CtaLink>` on `/` and `/pricing` passes a distinct label; typecheck passes.

---

### Phase 1 — One design language (the core premium work, ~1–2 days)

**T1.1 — Update the radius tokens (single highest-leverage visual change).**
`src/app/globals.css` `:root`: change `--r-card: 8px` → `12px`, `--r-ctl: 4px` → `8px`. Add `--r-panel: 16px` for dialogs/overlays. Then sweep `globals.css` (137 `border-radius` declarations), `landing.css` (50), `meta-monitor.css`, replacing hardcoded radii with the nearest token: 4–9px → `var(--r-ctl)`; 10–13px → `var(--r-card)`; 14–18px → `var(--r-panel)`; 999px/50% pills stay. Exception: keep `border-radius: 50%` on genuinely circular elements (dots, avatars).
*Accept:* `grep -c "border-radius: *[0-9]" src/app/globals.css` drops below 15 (the circular/special cases); app, landing, and studio controls all render at 8px, cards at 12px.

**T1.2 — Tokenize hardcoded colors in `globals.css`.**
Replace literal palette values with their tokens throughout the file body: `#ffffff`/`#fff` → `var(--surface)` (where used as background/surface; keep literal white where it is text on navy), `#131b2e` → `var(--ink)`, `#123e75` → `var(--accent)`, `#475569` → `var(--muted)`, `#94a3b8` → `var(--faint)`, `#dfe6f0` → `var(--line)`, `#f8fafc` → `var(--bg)`, `#002855` → `var(--accent-press)`. Mechanical, file-local. Do not change rendered values — this is normalization only.
*Accept:* visual diff = none (spot-check 3 pages in Vercel Preview); hex counts drop to single digits.

**T1.3 — Tokenize `meta-monitor.css` and fix the KPI tones.**
`src/app/meta-monitor.css` lines 24–29 hardcode six KPI icon tones, including a mislabeled `tone-purple` that is actually slate. Replace with tokens: `tone-blue` → `var(--accent-tint)`/`var(--accent)`; `tone-green` → `var(--green-soft)`/`var(--green)`; rename `tone-purple` → `tone-slate` (update the one component that uses it — grep `tone-purple` in `src/components/monitor/`); `tone-orange` → amber tokens; `tone-rose` → rose tokens; `tone-indigo` → `var(--accent-tint)`/`var(--accent-strong)` (it currently uses one-off `#d6e3ff`/`#1e477e`). Same file: lines 37, 51, 62–64, 112–113, 206–207, 213–252 contain more literals — replace with tokens. The gradient at line 51 (`linear-gradient(90deg,#4a76b8,#123e75)`) becomes a flat `var(--accent)` fill (gradients on data bars read as decoration; flat reads as precise).
*Accept:* `grep -c "#[0-9a-f]" src/app/meta-monitor.css` ≤ 3; monitor dashboard renders with identical hierarchy.

**T1.4 — Fix Ad Studio's stale navy and align its tokens.**
`src/components/adstudio/styles.ts`: line ~23 `box-shadow:0 2px 8px rgba(31,58,110,.28)` uses the OLD navy. Replace with `0 2px 8px rgba(18,62,117,.28)`. Sweep the whole STYLES string for `rgba(31,58,110` and `rgba(15,23,41` (typo of 15,23,42) and correct to the brand rgb values. Replace hardcoded `#fff`/`#f8fafc` backgrounds with `var(--surface)`/`var(--bg)` where the studio inherits globals. Keep the `--st-*` shadow tokens but redefine them in terms of the brand rgb. Do NOT restructure the studio layout in this task.
*Accept:* `grep -n "31,58,110\|15,23,41[^2]" src/components/adstudio/styles.ts` returns nothing.

**T1.5 — One button system.**
Consolidate to `.button` (+ `.primary`, `.secondary`, `.ghost`, `.compact`, `.big`) in `globals.css` with the Part 2 metrics (40px / radius `var(--r-ctl)` / weight 600 / 150ms transitions / `--ring` focus). Currently fragmented across: `globals.css` lines 696–730, 1382, 4741–4778, 5762; `landing.css` `.lp-btn-primary` (10px) and `.lp-btn-hero` (14px); `styles.ts` `.studio-btn` (38px/8px). Changes: (a) make the base `.button` match the canonical metrics; (b) redefine `.lp-btn-primary`/`.lp-btn-hero` to inherit the same metrics — hero may keep larger padding/font (15.5px) as a `.big` variant but same radius and color; (c) set `.studio-btn` height to 40px to match. Do not rename classes used in TSX (no churn) — align their CSS instead.
*Accept:* computed style of primary buttons on `/`, `/signup`, `/results`, and Ad Studio topbar: identical background, radius, weight; height 40px (hero may be taller).

**T1.6 — Style the orphaned form states.**
`globals.css`: add explicit rules for `.form-success` (green `var(--green)`, 13px, weight 600), `.signup-success` (card-level success block: `var(--green-soft)` bg, `var(--green)` text, `var(--r-ctl)` radius, 12px padding), `.turnstile-box` (margin 4px 0, min-height 65px to prevent layout shift while the CAPTCHA loads), and `.auth-alt-link` (muted color, navy on hover, underline). Components already emit these class names (`signup-form.tsx`, `login-form.tsx`, `forgot-password/page.tsx`).
*Accept:* signup success and forgot-password success render styled, not browser-default.

---

### Phase 2 — The expensive details: states, motion, dead UI (~1 day)

**T2.1 — Button loading spinners.**
Create `src/components/app/button-spinner.tsx`: a 16px inline SVG circle spinner (CSS animation, `currentColor`, `aria-hidden`). Use in `signup-form.tsx`, `login-form.tsx`, forgot-password, and the landing demo form: while submitting, button shows spinner + existing text ("Creating account…"), `disabled`, `aria-busy="true"`. Keep the existing disabled opacity rule.
*Accept:* submitting any auth form shows a spinner inside the button; no layout shift (reserve the 16px with `gap`).

**T2.2 — Skeleton loading for monitor charts and tables.**
Add to `meta-monitor.css`: `.mm-skeleton` — `background: var(--surface-subtle)` with a subtle shimmer (`linear-gradient` sweep, 1.4s), radius `var(--r-ctl)`. In `MetaMonitorDashboard.tsx` (and chart components that currently render nothing or a spinner while loading), render fixed-size skeleton blocks matching final dimensions (KPI cards: 6 blocks; charts: full-panel blocks). Spinners communicate "wait"; skeletons communicate "almost there" — the latter is the premium pattern.
*Accept:* hard-refresh `/results` on a throttled connection shows shape-true skeletons, not blank panels or lone spinners.

**T2.3 — Card hover micro-interaction.**
`globals.css`: on `.metric-card`, `.mm-ad-card`, landing feature cards, and any clickable `article`/card: add `transition: box-shadow 150ms ease, transform 150ms ease, border-color 150ms ease;` and on hover of *clickable* cards only: `transform: translateY(-1px); box-shadow: var(--shadow-float);`. Non-clickable cards get no hover (motion that signals nothing is noise).
*Accept:* clickable cards lift on hover; static metric cards do not.

**T2.4 — Remove dead UI in the app shell.**
`src/components/app-shell.tsx`:
1. Lines 182–185: the permanently `disabled` "Collapse" button — delete it (and its `.sidebar-collapse` CSS in `globals.css`). A control that never works erodes trust in every control.
2. Lines 191–194: `.workspace-chip` is a `<span>` with a `<ChevronDown>` — an affordance promising a dropdown that doesn't exist. Remove the ChevronDown icon (keep the chip as a label). If/when a workspace switcher ships, the icon returns.
*Accept:* no `disabled` nav controls; no chevrons on non-interactive elements; typecheck passes.

**T2.5 — Tabular numerals everywhere numbers live.**
Add `font-variant-numeric: tabular-nums;` to `.metric-value`, `.mm-kpi-value`, `.mm-ad-metric dd`, pricing price, trial-status pill, and any table cell classes missing it (`.mm-table tbody td` already has it).
*Accept:* changing digits don't cause width jitter in KPI cards.

**T2.6 — Consistent focus rings.**
Sweep `globals.css`, `landing.css`, `styles.ts` for `:focus-visible` rules; every interactive element gets `box-shadow: var(--ring)` (or `outline: 2px solid var(--accent); outline-offset: 2px` where box-shadow is occupied). Remove any `outline: none` without a replacement.
*Accept:* keyboard-tab through `/`, `/signup`, `/results`, Ad Studio — every stop is visibly ringed.

---

### Phase 3 — Ad Studio P0s from the prior review (~1 day)

`AD-STUDIO-UX-REVIEW.md` (repo root) already diagnosed these; several remain unfixed. Re-verify each against current code before changing — skip any already fixed.

**T3.1 — Mobile edits must be saveable.** (Review §4.) Ensure the mobile layout exposes a persistent Save/Done action; the `.studio-more-menu .studio-mobile-menu-save` rule currently sets `display:none`.
**T3.2 — Campaign settings reachable on mobile.** (Review §5.) The settings rail/panel must have a mobile entry point (sheet or menu item).
**T3.3 — Generation feedback.** (Review §2/§7.) Long operations (brief → generate) need a determinate-feeling progress state: disable trigger, show stage text ("Writing copy…", "Rendering…"), never a frozen screen. Reuse T2.1 spinner + a `.studio-progress` line.
**T3.4 — Demo-data leakage guard & sample-workspace banner.** (Review §6/§8.) Banner must be non-dismissable in sample workspaces; demo data must be visually labeled wherever it renders.
*Accept for all:* the "Fix order / P0" checklist in `AD-STUDIO-UX-REVIEW.md` items reproduce as fixed on a ≤390px viewport in Vercel Preview.

---

### Phase 4 — Copy & trust polish (~half day)

**T4.1 — Outcome-driven trust row.** `src/app/page.tsx` ≈lines 120–125: replace table-stakes copy ("Use your own ad account", "Budget controlled"…) with concrete outcomes. Use these four, verbatim: "Live ads from one listing in minutes" · "You approve every ad before it spends" · "Hard budget caps, no surprises" · "Results tracked in one dashboard".
**T4.2 — Ad Radar shows value before interaction.** Pre-render 3–4 cached example ads for a default location so the section demonstrates output with zero input (per audit finding; the components in `src/components/research/landing-radar-cards.tsx` likely support static props — verify).
**T4.3 — Password field hint → live hint.** `signup-form.tsx`: the 8-char minimum currently lives in helper text; on input, tint the helper green once satisfied (no meter, no red while typing — calm validation).
**T4.4 — Demo form parity.** The walkthrough form asks 5 fields vs. signup's 3; cut demo form to name + email + suburb (phone optional).
*Accept:* copy matches verbatim; demo form ≤ 4 fields; Radar section shows ads on first paint.

---

## Part 4 — Verification protocol (run after every phase)

1. `npm run check` (NUL check, unit tests, typecheck) — must pass.
2. `npm run test:e2e` if the phase touched components covered by Playwright specs (`e2e/`).
3. Deploy to **Vercel Preview** (never judge from localhost, per AGENTS.md) and review: `/`, `/pricing`, `/signup`, `/login`, `/results`, `/ad-studio`, `/ad-radar` at 1440px, 768px, 390px.
4. Grep gates (must all return empty by the end of Phase 1):
   - `grep -rn "2563eb\|1d4ed8" src/`
   - `grep -rn "31,58,110" src/`
   - `grep -rn '\$X' src/`
   - `grep -rn "087f7a\|1f3a6e" src/ *.html`
5. One PR per phase, tagged `simplification`, description stating which user-facing complexity it removes.

## Part 5 — Explicitly out of scope (do not do)

- No app-wide dark mode (only the sidebar theme exists today; full dark mode is a separate project — adding it now would double the token-sweep work mid-flight).
- No font changes, no new dependencies, no Tailwind, no component-library adoption.
- No changes to auth flows, API response shapes, DB schema, or Meta provider behaviour.
- No restructuring of `globals.css` into modules (worthwhile later, but it inflates diff risk now; the token sweep makes a future split mechanical).
