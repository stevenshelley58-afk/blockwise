---
name: Blockwise
description: Calm, exact tools for real-estate ad execution — Premium v2 register
colors:
  primary: "#16181d"
  primary-strong: "#0b0c10"
  primary-press: "#000000"
  primary-tint: "#f1f2f4"
  canvas: "#f6f7f9"
  surface: "#ffffff"
  surface-subtle: "#f1f2f4"
  ink: "#16181d"
  muted: "#545a66"
  faint: "#9aa0ad"
  line: "#e9ebef"
  line-heavy: "#d3d7df"
  accent-tint: "#f1f2f4"
  data: "#2a78d6"
  data-soft: "rgba(42,120,214,0.10)"
  data-track: "rgba(42,120,214,0.16)"
  success: "#006d38"
  success-soft: "#ecfdf5"
  warning: "#8a5a00"
  warning-soft: "#fdf6e7"
  danger: "#ba1a1a"
  danger-soft: "#ffdad6"
typography:
  headline:
    fontFamily: "Manrope, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "27px"
    fontSizeMobile: "24px"
    fontWeight: 800
    lineHeight: "1.15"
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Manrope, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15.5px"
    fontWeight: 800
    lineHeight: "1.25"
    letterSpacing: "-0.015em"
  stat:
    fontFamily: "Manrope, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 800
    lineHeight: "1.1"
    letterSpacing: "-0.02em"
  section:
    fontFamily: "Manrope, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 800
    lineHeight: "1.3"
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: "1.5"
    letterSpacing: "0"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
    lineHeight: "1.4"
    letterSpacing: "0"
  micro:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 500
    lineHeight: "1.4"
    letterSpacing: "0"
  badge:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "10.5px"
    fontWeight: 700
    lineHeight: "1.1"
    letterSpacing: "0"
  wordmark:
    fontFamily: "Manrope, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: "1"
    letterSpacing: "-0.035em"
  eyebrow:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "9.5px"
    fontWeight: 500
    lineHeight: "1.2"
    letterSpacing: "0.12em"
rounded:
  control: "10px"
  card: "16px"
  panel: "20px"
  pill: "9999px"
spacing:
  compact: "8px"
  control: "12px"
  content: "16px"
  section: "24px"
  page: "32px"
shadow:
  card: "0 1px 2px rgba(16,18,23,0.04), 0 8px 24px rgba(16,18,23,0.06)"
  float: "0 2px 4px rgba(16,18,23,0.05), 0 16px 40px rgba(16,18,23,0.10)"
motion:
  ease-spring: "cubic-bezier(0.22, 1.1, 0.36, 1)"
  duration-micro: "150ms"
  duration-state: "250ms"
  duration-entrance: "350ms"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "#ffffff"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  home-primary-action:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "48px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "36px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.card}"
    padding: "0 12px"
    height: "36px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "20px"
    border: "1px solid {colors.line}"
    shadow: "{shadow.card}"
---

# Design System: Blockwise — Premium v2

## 1. Overview

**Creative North Star: "The Quiet Operations Desk"**

Blockwise is a work-focused product used while a real-estate team is preparing,
checking, or improving live advertising. The interface should feel like a calm
operations desk: the next action is obvious, system state is legible, and visual
craft supports the work without competing with it.

**Premium v2** is the owner-approved evolution of that register. It keeps the
near-black one-voice accent, neutral surfaces, Manrope/Inter type, compact
radius scale, and operational density — and adds exactly three things:

1. **One vivid, niche-configurable data hue** for charts, meters, and
   sparklines only (`#2a78d6` for Blockwise).
2. **A spring motion system** — brief, purposeful, reduced-motion aware.
3. **Complete loading, empty, and success states** for every data surface.

Premium v2 is not a redesign. It is the same quiet register with a data voice,
a motion grammar, and no dead ends.

The system rejects parallel visual languages. The customer surface consumes one
token and component vocabulary. A surface may be purpose-built, but it may not
introduce a new accent family, radius scale, typography system, or navigation
grammar.

## Owner preferences (September 2026)

These preferences are the current authority when older guidance in this file
conflicts with them. They refine the existing system; they do not authorise a
parallel visual language or the removal of useful product capability.

- **No decorative eyebrows in customer UI.** The existing eyebrow token remains
  for legacy surfaces and dense technical metadata only. Do not place one above
  a page heading or use it as filler.
- **Use fewer words.** Keep labels, required instructions, prices, terms,
  validation, status, accessibility text, and other copy that performs a real
  function. Remove copy that only explains an obvious image, heading, card, or
  control.
- **Make the screen self-explanatory through hierarchy.** Improve the headline,
  preview, grouping, or next action. Never add explainer text to compensate for
  weak hierarchy.
- **Keep the established palette and simple typography.** Use the existing
  shadcn/Tailwind bridge, Manrope/Inter type, neutral surfaces, ink action
  colour, and shared radii before adding anything route-specific.
- **Prefer rounded surfaces.** Avoid square cards, sharp image containers, and
  page-local radius systems. Reuse `--r-ctl`, `--r-card`, `--r-panel`, and the
  pill radius.
- **Limit unnecessary scrolling, not information.** A shorter screen must not
  come from tiny text, clipped content, hidden controls, or invented omissions.
  Keep long forms, reports, and lists when the task genuinely needs them, but
  collapse repetition and completed setup.
- **Make mobile feel like an app.** Use the existing bottom navigation, safe
  areas, sheets, reachable actions, stable previews, and clear Back behaviour.
  Do not stack a desktop page into a phone.
- **Keep customer navigation permanent.** Self-serve customer routes,
  including Ad Studio templates, editors, and review surfaces, keep the five
  mobile destinations Home, Ads, Results, Leads, and More. Ads owns the full
  Ad Studio subtree. More contains remaining tools and account actions.
  Restricted monitor workspaces retain their permitted reporting navigation.
  Never expose unavailable tools or invent destinations to fill the menu.
- **Keep mobile layers deliberate.** Fixed navigation and visible consent
  reserve layout space. Sheets sit above navigation; consent yields while a
  modal is open and remains available afterwards. Never cover controls or the
  device safe area.
- **Email uses the Quiet card.** Email surfaces reuse the established surface,
  border, radius, and typography tokens in both light and dark themes. Keep the
  message and one clear action primary.
- **Guides are content-first.** Lead with the useful content, use rounded
  panels only when they improve grouping, and keep promotion subtle and
  secondary to the guide.
- **Show the product clearly.** Ads, Feed and Story previews, charts, and
  editable content must stay readable at phone widths. Never use a tiny desktop
  screenshot as a substitute for a mobile composition.
- **Motion explains state.** Use brief, smooth, purposeful transitions for
  selection, progress, saved state, confirmation, and spatial continuity. Do
  not delay routine work with choreography. Marketing previews may loop when
  the loop itself demonstrates the product output; working customer screens do
  not use ambient loops.
- **Use truthful states.** Never infer verification, connection, payment,
  freshness, current metrics, or completion from the presence of a record alone.
  State what is known, what is pending, and the next safe action.
- **Keep one obvious next action.** Secondary capabilities remain available,
  but they should not compete equally with the current task.
- **Keep trial language direct.** Use “Start your free trial” and “No card
  required” where appropriate. Show the actual allowance, renewal, charge,
  cancellation, and ad-spend terms beside the decision that needs them.
- **No em dash in frontend copy.** Rewrite with a full stop, comma, colon, or
  parentheses.

When implementing a new screen, review it as a distracted one-handed mobile
user first, then as a desktop operator. Preserve approved sections and safety
controls while removing repetition.

**Key Characteristics:**

- quiet, neutral work surfaces with soft layered elevation
- strong hierarchy with one dominant action or read
- a single vivid data hue reserved for quantitative display
- brief spring motion that explains state, never decorates
- honest progress, conflict, error, and partial-success feedback
- complete loading/empty/success states — no dead ends
- compact information density without crowding

### Mobile Home direction (scoped)

The current `/self-serve` direction supersedes the earlier September 2026
mobile Home pilot. Home is a creative-first workbench: lead with the
customer's real ad creative or a truthful preview-unavailable state, then show
only recommendations backed by existing HomeData/read models and approved
resolvers. Recommendations must retain known source, freshness, pending, and
unavailable semantics. Never invent a recommendation, metric, connection, or
completion state to fill the screen.

Home is not an identity, setup, reporting, billing, or administration surface.
Do not repeat workspace/account identity in its title area, show setup or
activation progress, duplicate Results telemetry, or expose operator controls.
Account details remain behind the accessible account menu. The shared customer
shell still owns the five-destination mobile bar: Home, Ads, Results, Leads,
and More. The direction applies only to Home and does not change other
customer routes, operator surfaces, or the current light-only customer theme.

## 2. Colors

The palette is near-monochrome and operational. Primary ink and action color are
the same near-black; separation comes from neutral layers, borders, spacing, and
soft layered shadows.

### Primary

- **Operations Ink** (`--ink`): primary buttons, active navigation, selected
  states, and the strongest text. Its rarity preserves action hierarchy.
- **Selection Mist** (`--accent-tint`): selected rows, quiet hover surfaces, and
  low-emphasis action context.

### Neutral

- **Work Canvas** (`--bg`): the page and workbench background.
- **Clean Surface** (`--surface`): controls, panels, dialogs, and editable
  regions.
- **Subtle Surface** (`--surface-subtle`): inset wells, secondary tiles, and
  quiet grouping.
- **Body Slate** (`--muted`): supporting text that still meets contrast targets.
- **Quiet Slate** (`--faint`): nonessential metadata only, never body copy or
  form placeholders. It also supports mono table headers and dense metadata.
- **Hairline** (`--line`) and **Control Line** (`--line-heavy`): structural
  borders and input boundaries.

### The Data Hue (new in v2)

- **Data Blue** (`--ui-data`, `#2a78d6`): the one vivid voice. Used **only** for
  charts, meters, sparklines, and quantitative trend display. Soft tints
  (`--ui-data-soft`, `--ui-data-track`) back chart fills and meter tracks.
- The data hue is **niche-configurable**: the customer layout overrides the three
  `--ui-data*` variables from `src/config/niche` for white-labeling.
- **The Data Hue Rule.** The data hue never appears in UI chrome, buttons,
  navigation, headings, or body text. If a number isn't being plotted, metered,
  or trended, it doesn't get the data hue.

### Secondary (status)

- **Verified Green** (`--ui-success` / `--ui-success-soft`): accepted, connected,
  completed states.
- **Attention Amber** (`--ui-warning` / `--ui-warning-soft`): review-required
  states that are not failures.
- **Blocking Red** (`--ui-error` / `--ui-error-soft`): destructive actions and
  release-blocking errors.

**The One Voice Rule.** Operations Ink is the only general action accent. The
data hue is the only vivid display accent. Do not introduce a third.

**The Semantic Color Rule.** Green, amber, and red communicate state. They never
decorate headings, cards, or illustrations.

**Mobile Home surface rule.** Home remains light-only: `--bg`, `--surface`,
`--surface-subtle`, `--line`, and semantic text tokens come from the existing
Tailwind bridge. Do not infer a full-page dark mode from sidebar theme support.
Keep the surface continuous and let the real creative carry visual priority.

## 3. Typography

**Display Font:** Manrope (with Inter and system sans fallbacks) — `font-display`
**Body Font:** Inter (with system sans fallbacks) — `font-sans`
**Metadata Font:** JetBrains Mono — `font-mono`, for dense metadata and table
headers. It is not a default page-heading treatment.

**Character:** Manrope gives page and panel headings firm, compact authority at
extrabold weight with tight tracking. Inter carries controls, copy, and data.
JetBrains Mono carries tiny uppercase metadata (table headers, step counters,
and technical status) at wide tracking. It is a supporting detail, not a
decorative introduction to every section.

### Hierarchy

- **Page heading** (`font-display`, 24→27px, 800, `-0.02em`): the single dominant
  heading on a task surface.
- **Panel title** (`font-display`, 15.5px, 800, `-0.015em`): panel and section
  ownership.
- **Stat value** (`font-display`, 24→26px, 800, `-0.02em`, `tabular-nums`): KPI
  numbers. Always tabular-nums so digits align.
- **Body** (Inter, 13px, 400, 1.5): instructions, descriptions, product copy.
- **Label** (Inter, 12.5px, 600): controls and fields.
- **Dense metadata / table header** (JetBrains Mono, 9.5px, 500, `0.12em`,
  uppercase): `<th>` cells, step counters, and compact technical status.
  The eyebrow token is legacy-only and never a decorative customer treatment.

**The Product Type Rule.** Display typography stops at headings and stat values.
Buttons, labels, data, and navigation use the body family.

**The Sentence Case Rule.** Labels, actions, headings, helper text, errors, and
status messages use sentence case. Uppercase is reserved for compact table or
technical metadata, never decorative page introductions.

**Mobile Home type rule.** Home uses Inter utility text at 15px for primary
actions and tool labels, 13px for supporting text and metric labels, and a
compact Inter 20px Home bar title. Section headings use 15.5px, with the next-step heading at 17px. Numeric results keep tabular figures
and may use compact notation only when the complete value remains accessible.

## 4. Elevation

Blockwise uses tonal layering and one-pixel boundaries first, with two soft
layered shadows for resting and floating surfaces. Elevation must explain
stacking or interaction, not decorate a card grid.

### Shadow Vocabulary

- **Resting surface** (`shadow-card`): panels and stat tiles that need separation
  from Work Canvas. `0 1px 2px rgba(16,18,23,.04), 0 8px 24px rgba(16,18,23,.06)`.
- **Floating surface** (`shadow-float`): dialogs, menus, dropdowns, and raised
  interactive surfaces. `0 2px 4px rgba(16,18,23,.05), 0 16px 40px rgba(16,18,23,.10)`.

**The Flat-First Rule.** If border and tonal layer explain the hierarchy, do not
add a shadow. Nested card shadows are prohibited.

**The Lift Rule.** Interactive cards may lift on hover (`-translate-y-0.5` +
`shadow-float`, 200ms) — but only cards that are genuinely clickable, and always
gated behind `motion-reduce:hover:translate-y-0`.

## 5. Motion (new in v2)

Motion explains state and directs attention. It is brief, spring-tuned, and
always honors `prefers-reduced-motion`. The single source of truth is
`src/lib/motion.ts` — pages and components import from there and never define
their own timings.

### The Motion Vocabulary

- **Springs:** `snappy` (micro-interactions), `gentle` (entrances), `slow`
  (progress bars and meters).
- **Durations:** `micro` 150ms, `state` 250ms, `entrance` 350ms. Nothing in the
  customer surface moves slower than `entrance`.
- **Entrance:** a 12px rise + fade (`rise`), staggered 40ms between siblings,
  once per navigation. Reduced motion swaps to an opacity-only fade.
- **Count-up:** KPI numbers count up over 900ms; under reduced motion they render
  their final value instantly.
- **CSS spring curve:** `cubic-bezier(0.22, 1.1, 0.36, 1)` (`ease-spring`).

### The Motion Rules

- Customer work surfaces do not use ambient or looping motion. Marketing
  previews may loop when repetition is the product demonstration itself.
  Nothing else exceeds the entrance duration (count-up aside).
- Hover lift is reserved for genuinely interactive cards.
- There is exactly **one confetti moment** — the first-run handoff into Ad
  Studio. It is brief, never loops, and is skipped entirely under reduced motion.
- Every transform is gated: `useReducedMotion` for motion/react, the
  `motion-reduce:` variant for CSS.

## 6. States (new in v2)

Every data surface ships a complete set of states. A surface that can load, be
empty, succeed, or fail must render all four — no dead ends.

- **Loading:** token skeletons (`animate-pulse` blocks in the panel/card radius)
  that mirror the loaded layout. Route-level `loading.tsx` for first paint.
- **Empty:** a dashed-border well (`border-dashed border-(--line-heavy)
  bg-(--surface-subtle)/50`, centered) with a concise state title and, where
  needed, one actionable instruction or primary button. Do not add explanatory
  prose when the title, preview, or control already makes the state clear.
- **Success:** brief inline confirmation in `text-success` (bold 12.5px). Never
  a toast for something the user must act on.
- **Error:** inline `text-error` message for recoverable failures; a soft error
  card (`border-error/25 bg-error-soft`) for blockers. Always say what to do
  next.

## 7. Components — the Premium v2 vocabulary

The canonical implementation is **shadcn/ui on Tailwind v4**, bridged onto the
Blockwise tokens via `src/app/tailwind.css`. Reach for a shadcn primitive before
hand-building; use the token utilities below for layout and bespoke surfaces.

### Layout

- **Page container:** `mx-auto w-full max-w-[1120px] px-4 pt-6 pb-28 md:px-6
  md:pt-8 md:pb-16` (narrow surfaces use `max-w-[880px]`/`max-w-[720px]`;
  stacked mains add `grid gap-3.5`). The deep mobile bottom padding clears the
  bottom nav. Keep the first useful action near the top on mobile.
- **Panel:** `rounded-(--r-panel) border border-(--line) bg-(--surface) p-5
  shadow-card`. Title in the panel-title voice.
- **Stat tile:** `rounded-(--r-card) border border-(--line) bg-(--surface)
  px-[18px] pt-[17px] pb-[15px] shadow-card` — compact sentence-case label,
  display tabular value, and muted foot. Do not add a decorative eyebrow.

### Controls

- **Home primary action (scoped):** semantic primary background and foreground,
  `--r-ctl` (10px), and a reachable 44px minimum height. **Never make a Home
  CTA full width.** Keep it bounded by content or a sensible max width at every
  viewport. It is the one visible next-step action, not a second summary of
  the creative.
- **Ink button:** full pill, Operations Ink background, white label, 36px.
  Hover opacity, active scale — no bounce.
- **Ghost button:** full pill, Clean Surface, Control Line boundary, ink label.
- **Chip / filter pill:** full pill 34px; selected = ink background + white text,
  unselected = surface + hairline.
- **Input / select:** Clean Surface, hairline border, `card` radius, 36px, ink
  border on focus. Selects pair with a faint chevron.

### Mobile Home direction components

- **Creative lead:** use the existing shared image/video/text preview primitives;
  keep media readable at 320px and branch honestly for failed or unknown media.
- **Recommendation row:** a minimum 44px reachable row with a meaningful action,
  concise rationale when supplied by data, and one trailing affordance. Do not
  render a placeholder recommendation.
- **Bounded action:** keep the next real route or resolver-backed action near
  the creative, but never stretch its CTA to the viewport edges.
- **Flat grouping:** use continuous sections and hairlines before rounded cards.
  A panel must improve grouping, not decorate an empty Home.
- **State treatment:** loading, empty, partial, and error states preserve the
  same creative-first hierarchy and provide a real recovery path.

### Page head

- Display h1 with a short, useful lead only when it adds information. Do not
  add an eyebrow or explainer paragraph above it. Put freshness, setup state, or
  the next action beside the relevant content.

### Tables

- Mono uppercase `9.5px` headers in `text-(--faint)`; rows on Clean Surface;
  horizontal scroll wrapper (`-mx-5 overflow-x-auto px-5` + `min-w-[…]`) so
  tables never squeeze on mobile.

## 8. Do's and Don'ts

### Do:

- **Do** lead Home with the customer's real creative and keep its next action
  linked to a server-resolved, available route.
- **Do** keep Home flat by default: use sections, rows, hairlines, and
  disclosures before rounded cards or chart scaffolds.
- **Do** preserve actual data semantics. Show unavailable reporting as
  unavailable with a contextual recovery link; never substitute zero.
- **Do** make the 390px first viewport useful while preserving a natural scroll
  at 320px and clearing the shared five-destination bar.
- **Do** keep recommendations concise, real, and secondary to the creative;
  expose source and freshness whenever the data provides them.
- **Do** make one next action or operational read visibly dominant.
- **Do** use the shared ink accent, neutral layers, radius scale, Manrope/Inter,
  and existing primitives before adding route-local values.
- **Do** reserve the data hue for charts, meters, and sparklines.
- **Do** provide loading, empty, success, and error states for every data
  surface.
- **Do** use the motion vocabulary from `src/lib/motion.ts` and honor reduced
  motion.
- **Do** keep touch targets at least 44 by 44 pixels even when the visible
  control is compact; no horizontal scroll at 320px.
- **Do** make the first viewport useful on mobile: show the purpose, current
  state, and next action without requiring an unnecessary scroll.
- **Do** preserve useful creative states and safety controls while keeping
  identity, setup, Results, billing, and admin detail off Home.
- **Do** keep overlays, consent banners, sheets, and fixed navigation clear of
  one another and the device safe area.
- **Do** keep Back, save, retry, cancel, and return paths visible and
  recoverable in every multi-step flow.
- **Do** source customer-facing copy from `src/config/niche` — no niche nouns
  (real-estate, suburb, listing) in page components.

### Don't:

- **Don't** build menu-heavy SaaS dashboards with several equivalent starting
  points.
- **Don't** use generic AI styling: gradient text, decorative glass, cream SaaS
  palettes, repetitive card grids, or gratuitous motion.
- **Don't** use the data hue in chrome, buttons, headings, or body text.
- **Don't** add looping or ambient animation to working customer surfaces, or
  more than one confetti moment. A marketing preview may loop only when the
  loop is the actual demonstration.
- **Don't** introduce new global CSS classes or a parallel component set on the
  customer surface.
- **Don't** create parallel component, token, typography, or navigation systems
  across product surfaces.
- **Don't** use colored side-stripe card accents, gradient text, default
  glassmorphism, decorative hero metrics, or nested cards.
- **Don't** add eyebrows, filler subheadings, or explanatory paragraphs that
  repeat what the visual hierarchy already communicates.
- **Don't** shorten a screen by hiding approved features, shrinking text, or
  making a required task harder to find. Never use a full-width Home CTA.
- **Don't** leave a status without its next action: a pending booking,
  connection, verification, payment, or save state must explain how to proceed.

## 9. Implementation Governance

The canonical implementation of this design system for the customer
(self-serve) surface is **shadcn/ui on Tailwind v4**. The primitives in
`src/components/ui/` are the shared vocabulary for buttons, cards, dialogs,
sheets, tables, selects, inputs, and navigation. They are wired to the
Blockwise tokens through the bridge in `src/app/tailwind.css` (the `--ui-*`
variables map onto the palette, radius, and type defined above).

- Build customer-facing UI from the shadcn primitives and Tailwind utilities;
  do not introduce new global CSS classes or a parallel component set.
- Keep the token bridge as the single source of truth: shadcn semantic tokens
  (`background`, `foreground`, `primary`, `muted`, `border`, etc.) resolve to
  the Blockwise values in this document, so a token change here propagates.
- The data hue (`--ui-data*`) is overridden per-niche from `src/config/niche` in
  the customer layout — never hardcode a chart color in a component.
- Customer pages contain zero niche nouns; all surface copy flows from
  `src/config/niche` so the same shell white-labels.
- Operator and monitor surfaces remain on the existing CSS shell until their
  own migration; the two systems coexist via the scoped, no-preflight Tailwind
  setup (`.tw` wrapper) and must not be mixed within one route.
- Motion timings come from `src/lib/motion.ts` only; working customer surfaces
  do not loop, nothing exceeds the entrance duration, and everything honors
  `prefers-reduced-motion`. Marketing previews are the explicit exception when
  the loop demonstrates the product output.
- Owner preference precedence is part of implementation governance: no new
  customer screen uses a decorative eyebrow, filler explanation, em dash, or
  page-local visual language. Preserve useful information and safety controls.
- This register remains "the quiet operations desk": shadcn is the delivery
  mechanism, the data hue is the only vivid voice, and restraint still governs
  every component choice.
