# Blockwise design system

This is the maintained, repository-owned guide for the Blockwise visual system. It
carries the token tables, the component usage rules and the worked examples.
[`DESIGN.md`](../../DESIGN.md) remains the binding contract and states the rules in
short form; this guide is where the detail lives. When an approved design decision
changes, change both in the same commit.

An interactive HTML reference of the same system exists outside the repository. It
is reference material for a human reading it, not an authority another agent should
depend on. If it disagrees with this file, this file wins.

## Scope

The whole Blockwise website is in scope: the customer app, Ad Studio, authentication,
legal, marketing and the operator screens. Consistency means shared foundations and
shared components. It does not mean identical layouts, and it does not mean a legal
page must look like a dashboard.

**Frank is a separate product.** It keeps its own design contract at
`/projects/frank/apps/window/DESIGN.md`. Nothing here overrides it, and Blockwise
must not import Frank's visual language or the reverse.

**Isolated third-party editors keep their internals.** The Vue/Fabric editor runs in
a same-origin, style-isolated frame. Its canvas controls and toolbar are upstream
code. The Blockwise interface around it uses this system; the frame's interior does
not have to.

## Where the tokens live

| File | Role |
|---|---|
| `src/app/globals.css` | The base token set and the one definition of the shape roles. Imported into the low-priority `legacy` cascade layer. |
| `src/app/tailwind.css` | The shadcn bridge (`--ui-*`), the type roles, the elevation tokens and the Tailwind `@theme` mapping. The single source of truth for the `--ui-*` vocabulary. |
| `src/app/theme-monochrome.css` | The theme override layer. Imported last and unlayered, so it wins. Holds the light theme values and the `[data-theme="studio-dark"]` dark theme block. |

Import order is load-bearing and is documented in `src/app/layout.tsx` and at the top
of `tailwind.css`. Tailwind v4 is loaded **without global preflight**; a scoped
preflight applies under `.tw` and `[data-slot]` instead. Do not enable global
preflight as a shortcut. Do not add global CSS classes: build from Tailwind utilities
and `src/components/ui/`.

## Colour roles

One vocabulary, two themes. The role names are what matter; the values below are the
current implementation of those roles. Never hardcode a value a token already
provides.

| Role | Token | Light | Dark (Ad Studio) |
|---|---|---|---|
| Canvas | `--bg` | `#F6F7F9` | `#111318` |
| Surface | `--surface` | `#FFFFFF` | `#1B1E25` |
| Subtle surface | `--surface-subtle` | `#F1F2F4` | `#252932` |
| Primary text | `--ink` | `#16181D` | `#F6F7F9` |
| Supporting text | `--muted` | `#545A66` | `#B5BBC7` |
| Faint mark (never body text) | `--faint` | `#9AA0AD` | `#9AA0AD` |
| Decorative divider | `--line` / `--ui-border` | `#E9EBEF` | `#343A46` |
| Strong decorative border | `--line-heavy` | `#D3D7DF` | `#49515F` |
| Interactive boundary | `--ui-control-border` | `#858C99` | `#858C99` |
| Primary action fill | `--accent` / `--ui-cta` | `#16181D` | `#F6F7F9` |
| Primary action text | `--ui-cta-foreground` | `#FFFFFF` | `#16181D` |
| Focus indicator | `--ui-focus` / `--ui-ring` | `#16181D` | `#F6F7F9` |
| Overlay scrim | `--ui-scrim` | `rgba(16,18,23,0.55)` | `rgba(0,0,0,0.72)` |
| Quantitative data | `--ui-data` | `#2A78D6` | `#69ABFF` |
| Success text / surface | `--ui-success` / `--ui-success-soft` | `#006D38` / `#ECFDF5` | `#86E5AE` / `#153626` |
| Warning text / surface | `--ui-warning` / `--ui-warning-soft` | `#8A5A00` / `#FDF6E7` | `#F1CD7A` / `#382E18` |
| Error text / surface | `--ui-error` / `--ui-error-soft` | `#BA1A1A` / `#FFDAD6` | `#FFB4AB` / `#421F23` |

### Rules

- **Three kinds of line, three jobs.** A decorative divider separates content and may
  be faint. A strong decorative border groups content and may also be faint. An
  interactive boundary is the edge of something a person can act on and must be
  visible. They are separate tokens because making one token do all three jobs forces
  a choice between hairlines that look heavy and controls nobody can see. Use
  `border-input` or `border-(--ui-control-border)` for controls, `border-border` for
  decoration.
- **Data blue is for quantitative display only**: chart lines, meters, sparklines,
  gauge fills. It is never a button, link, navigation or decoration accent, and it is
  never used for text. See the contrast note below.
- **Status needs more than colour.** Every success, warning and error state carries
  text or an icon as well as its colour.
- **`--faint` is not body text.** It is a decorative mark colour. It measures 2.62:1
  on white and fails every text threshold; using it for supporting copy is a
  regression.
- **The accent inverts between themes.** In the light app the accent is near-black ink
  on white; in the dark theme it is near-white ink on a near-black surface. This is
  why `bg-(--ink)` accent fills flip correctly in Ad Studio without needing a second
  class at every call site.
- **Existing dark marketing and email treatments use these same semantic roles.** They
  are not a third palette.

### Contrast, verified

Measured with the WCAG 2.1 relative-luminance formula. Re-measure when a value
changes; do not eyeball it.

| Pairing | Light | Dark | Requirement |
|---|---|---|---|
| Primary text on canvas | 16.57:1 | 17.33:1 | 4.5:1 |
| Primary text on surface | 17.76:1 | 15.56:1 | 4.5:1 |
| Supporting text on surface | 6.93:1 | 8.66:1 | 4.5:1 |
| Supporting text on canvas | 6.46:1 | 9.64:1 | 4.5:1 |
| Interactive boundary on surface | 3.38:1 | 4.93:1 | 3:1 (non-text) |
| Interactive boundary on canvas | 3.16:1 | 5.49:1 | 3:1 (non-text) |
| Focus indicator on surface | 17.76:1 | 15.56:1 | 3:1 (non-text) |
| Action text on action fill | 17.76:1 | 16.57:1 | 4.5:1 |
| Success text on success surface | 6.14:1 | 8.71:1 | 4.5:1 |
| Warning text on warning surface | 5.51:1 | 8.75:1 | 4.5:1 |
| Error text on error surface | 5.00:1 | 8.52:1 | 4.5:1 |
| Data hue on surface | 4.42:1 | 7.04:1 | 3:1 (graphics only) |

Two honest qualifications:

- **The light data hue is 4.42:1 on white**, below the 4.5:1 bar for normal text and
  comfortably above the 3:1 bar for graphics. That is acceptable *because data blue is
  graphics-only*. If a data-hued value ever needs to be read as text, it takes the
  primary-ink role, not the data hue. This is why the "never text" rule above is a
  rule rather than a preference.
- **The decorative divider and the strong decorative border are intentionally below
  3:1** (1.19:1 and 1.44:1 light, 1.46:1 and 2.09:1 dark). They are decoration and are
  not held to a contrast bar. Anything a person must perceive as a control uses the
  interactive boundary instead.

## Type roles

Manrope carries headings (`font-display`), Inter carries interface and body text
(`font-sans`, the default), JetBrains Mono is for technical values only (`font-mono`).
The roles are generated as Tailwind utilities from `@theme` in `src/app/tailwind.css`.

| Role | Utility | Size / line height | Weight |
|---|---|---|---|
| Desktop page title | `text-page-title` | 32 / 40px | 700 |
| Mobile page title | `text-page-title-sm` | 28 / 36px | 700 |
| Section title | `text-section-title` | 22 / 30px | 600 |
| Component title | `text-component-title` | 18 / 26px | 600 |
| Body and form entry | `text-body` | 16 / 24px | 400 |
| Controls and labels | `text-control` | 14 / 20px | 500 |
| Supporting text | `text-support` | 14 / 20px | 400 |
| Small metadata | `text-meta` | 12 / 18px | 400 |
| Main metric | `text-metric` | 32 / 40px | 700 |

Rules:

- **Choose the role that names the job, not the stock size nearest to it.** A page
  title is `text-page-title-sm md:text-page-title`, never `text-3xl`. A control label
  is `text-control`, never `text-sm`.
- **The page title is the one responsive role.** It is the only pair, because it is
  the only role whose size is genuinely different on a phone and a desktop. Use
  `text-page-title-sm md:text-page-title`.
- **Comparable metrics use `tabular-nums`** so digits do not jitter between values.
- **Important instructions are not small metadata.** If a person must read it to
  complete the task, it is `text-support` or larger, not `text-meta`.
- **Intentional marketing display typography is preserved.** The homepage and landing
  builds set their own display sizes through their own scoped sheets. That is a
  documented exception, not drift.

## Spacing and layout

Scale: **4, 8, 12, 16, 24, 32, 48px**. Nothing between.

| Use | Value |
|---|---|
| Icon to label | 8px |
| Related controls | 12px |
| Mobile gutter | 16px |
| Card padding | 16px mobile, 24px desktop |
| Desktop gutter | 24 to 32px |
| Major section separation | 32 to 48px |
| Standard content width | about 1200px |
| Focused form width | about 640px |

- **Prefer flat sections and separated rows.** Use a card for independent grouped
  content, not for every paragraph. Home stays flat by default, with one named
  exception (the weekly metrics row).
- **Reuse the shared elevation tokens** (`shadow-card`, `shadow-float`). Avoid nested
  shadows: a card inside a card does not get a second shadow.
- **Data-heavy screens may use more width** than the standard content width when the
  data needs it.

## Shape roles

One role-based scale, defined once in `src/app/globals.css`. `theme-monochrome.css`
deliberately does not restate it; two live definitions of the same token is how the
12px-card-versus-16px-card drift started.

| Role | Token | Value | Applies to |
|---|---|---|---|
| Control | `--r-ctl` | 10px | Buttons, inputs, selects, menu items, cells |
| Card | `--r-card` | 16px | Cards and grouped surfaces |
| Panel | `--r-panel` | 20px | Large panels, dialogs, sheets, popovers |
| Pill | `--r-chip` | 9999px | Status pills, chips, avatars, circular controls |

- Use `rounded-(--r-ctl)`, `rounded-(--r-card)`, `rounded-(--r-panel)` or
  `rounded-full`. `--r-control` is an alias of `--r-ctl`.
- **Do not globally redefine a generic radius utility.** `--radius-sm|md|lg|xl` in
  `tailwind.css` still drive the stock `rounded-sm|md|lg|xl` utilities that roughly 250
  call sites use. Changing them changes all 250 at once. Migrate a call site to the
  role token when you touch it; do not shift the whole scale underneath the codebase.
- **Ordinary buttons use the control radius.** They are pills only when they are the
  CTA, or when they are genuinely circular.

## Focus

Focus is one shared treatment, not a per-component decision.

- The indicator is `--ui-focus` (near-black on light, near-white on dark), used
  solid. It was previously a translucent navy tint, which was invisible on a coloured
  surface. Do not reintroduce an opacity modifier.
- Controls apply it as `focus-visible:ring-[3px] focus-visible:ring-ring
  focus-visible:ring-offset-2 focus-visible:ring-offset-background`.
- **The 2px offset is load-bearing.** Without it the ring sits directly on the
  control, and on the primary action the ring and the fill are the same colour:
  measured at 1.00:1, i.e. no visible focus at all on the most important control on
  every screen. The offset separates the ring from the control so it is visible
  against both the control and the surface behind it, in both themes.
- Keyboard order follows DOM order. Never remove a focus style without replacing it.

## Controls

Build from `src/components/ui/`. Never hand-roll a button, dialog, sheet, table or
select.

### One button, one primary action

`src/components/ui/button.tsx` defines the single shared control.

| Variant | Use |
|---|---|
| `default` | The ink pill. The one primary action in a task area. |
| `outline` | The same pill in surface with an interactive boundary, for the secondary action beside it. |
| `secondary` | A quiet fill for an action inside a card or a toolbar. |
| `ghost` | No chrome until hover. |
| `destructive` | The error surface. |
| `link` | An inline text action. Never a pill. |
| `ghost-pill` | The 36px toolbar and page-head control. |

- **One dominant action per task area.** A secondary capability stays available but
  never competes equally with the current task.
- **There is no automatically injected arrow disc.** Plain text is the default. The
  button used to add a trailing circular disc with an up-right arrow to every text
  button, and 207 of 214 call sites rendered one. It is gone.
- **An icon belongs inside a button only when it carries a function the label does not
  already state**: Back, expand, download, external navigation. Write it into
  `children` like any other content. Do not replace the removed arrow with a different
  decorative icon.
- **`<Button asChild>` wraps a link** and renders it as the same control, so a link CTA
  is an `<a>` and never a clickable `div`. Keep accessible names, `aria-pressed`,
  `aria-expanded` and the disabled state on it.
- **Do not restyle links inside a container that holds the shared button.** The legacy
  marketing sheets `audit.css` and `suburb-report.css` are unlayered, so their element
  rules outrank every Tailwind utility; they exempt the button through the `bw-cta`
  marker class, which travels in `className` because that is the one prop every wrapper
  forwards.

### Forms

- Labels sit above their field. Help text and errors sit beside the relevant input,
  not in a summary block at the top.
- **Preserve entered values after a validation error.** Never clear a form to report a
  failure.
- Form entry is `text-body` (16px) at every width. 16px is deliberate: it is the size
  that stops iOS zooming the viewport when a field takes focus.
- Fields use `border-input` (the interactive boundary) and the control radius.

### Overlays

Dialog, Sheet, AlertDialog, Popover, DropdownMenu, Select and Tooltip all portal to
`document.body`. They share one focus, dismissal and layering behaviour, and one scrim
token (`--ui-scrim`). A scrim stays dark in both themes: an overlay built from `--ink`
would turn white the moment the palette inverted.

## Ad Studio is the dark theme

Ad Studio is **the dark theme of this same system**, not a separate design system. It
uses the same type roles, spacing scale, shape roles, controls, state behaviour and
action hierarchy. Only the colour roles change. Anything that differs beyond colour is
a bug, not a theme.

### How the scope works

The dark roles live in `[data-theme="studio-dark"]` in `src/app/theme-monochrome.css`.
Two writes put that attribute on the DOM:

1. `src/components/adstudio/studio-shell.tsx` sets it on the shell's own root element,
   so the subtree is correct in the server-rendered first paint and does not flash
   light.
2. The same component mirrors it onto `document.documentElement` from a refcounted
   client effect, and restores the previous value on the last unmount. This is what
   makes portaled overlays dark: they mount on `body`, outside the shell's element.

### The `--ui-*` restatement is load-bearing

A custom property's `var()` is substituted at computed-value time **on the element that
declares it**. The bridge in `tailwind.css` declares `--ui-background: var(--bg)` on
`:root`, so the substitution happens once, on the root element, and every descendant
inherits the already-resolved value. A `[data-theme="studio-dark"]` scope on a nested
element therefore **cannot** change any `--ui-*` value by redefining `--bg` alone.

That is why the dark block also restates the `--ui-*` aliases. Remove them and the
scope silently keeps light values for everything built from the shadcn bridge
(`bg-background`, `bg-card`, `border-border`, `text-foreground`, `bg-primary`, and the
portaled overlays) while the raw `--bg`/`--ink` consumers still go dark. The failure is
partial and quiet, which is the worst kind.

### What the dark theme must cover

The complete surrounding interface, not just the sidebar: shell, navigation, menus,
sheets, dropdowns, dialogs and every portaled overlay. The surface stack reads
deliberately: the canvas stage is `--bg` (deepest), the chrome panels are `--surface`,
and grouped content is `--surface-subtle`.

## States

- **Every data surface ships four states**: loading, empty, content, error. A surface
  that can also be unavailable ships five. No dead ends.
- **Missing data is not zero.** Show unavailable reporting as unavailable with a
  contextual recovery link. Never substitute zero for missing data.
- **Never infer a state from a record's presence.** Distinguish saving, saved,
  unavailable and disconnected. State what is known, what is pending, and the next
  safe action.
- **A waiting state always has a way out.** Never trap a person behind a status they
  cannot change.

## Motion

`src/lib/motion.ts` is the single source of truth. Pages and components import from
there and never define their own timings.

- Durations: **micro 150ms, state 250ms, entrance 350ms**. Nothing on the customer
  surface moves slower than entrance.
- **Reduced motion is mandatory.** Every transform is gated with `useReducedMotion`
  for motion/react or the `motion-reduce` variant for CSS.
- **Review longer existing exceptions rather than spreading them.** The homepage
  explainer uses its own documented marketing timings; that is scoped and deliberate.
- Hover lift is reserved for genuinely interactive cards.

## Drift protection

`tests/design-system-contract.test.ts` enforces the parts of this system that can be
checked from source, and `tests/cta-button-contract.test.ts` pins the button contract.
They cover:

- no automatically injected decorative button arrows, and no hand-rolled trailing
  arrow disc in the shared components,
- cards and controls resolving to the agreed radius roles, and the roles being defined
  exactly once,
- the dark theme covering the light roles it must restate, including the `--ui-*`
  bridge aliases,
- control boundaries and focus using their own roles rather than the decorative
  divider, with no translucent focus tint,
- the dark theme defining every status role and the data hue,
- a targeted check for new hardcoded colours, arbitrary type sizes and duplicate
  implementations in the changed UI files.

**These checks are a floor, not a proof of visual quality.** They cannot see rendered
output, contrast in a real screenshot, or whether a layout clips at a specific width.
Passing them means the drift you already fixed has not come back. It does not mean the
website looks right.

## Documented exceptions

Each of these is deliberate. Do not "fix" one without changing this list.

| Exception | Where | Why |
|---|---|---|
| 4px radius on checkbox indicators | `src/components/ui/checkbox.tsx` | A 16px indicator at the 10px control radius reads as a circle and stops looking like a checkbox. |
| 2px radius on the tooltip arrow | `src/components/ui/tooltip.tsx` | A rotated 10px square; the control radius would visibly distort it. |
| `rounded-[calc(var(--r-ctl)-3px)]` on tab triggers | `src/components/ui/tabs.tsx` | Derived from the control role and the 3px inset, so the trigger nests inside the tab list. |
| Recharts colour defaults in the chart primitive | `src/components/ui/chart.tsx` | Library defaults, overridden per chart by the data hue. |
| White text over user artwork | `src/components/adstudio/editor/layered-canvas.tsx`, the Meta placement previews, the crop overlay | These sit on the customer's own image, not on a themed surface. Their contrast is the image's problem, and the crop handle has its own outline. |
| Artwork colours in the fabric canvas | `src/components/adstudio/editor/layered-canvas.tsx`, `vue-editor/fabric-scene.ts` | Content, not chrome. |
| Marketing display typography | homepage, landing, concept, pricing, guides sheets | Purpose-built marketing composition with its own scoped stylesheet. |
| The 12 September publish-history archive | `/ad-studio/publish-history` | Recovered layout kept as owner comparison evidence. Archived terminology and duplicated controls are historical evidence, not patterns. |
| `text-[Npx]` fine print in `creative-viewer.tsx` and `notice-bar.tsx` | app-level compositions | Pre-existing, outside the shared primitive set. Migrate when touched. |

## Known remaining gaps

Honest status as of the consolidation commit. These are not fixed.

- **Page-local arbitrary type sizes remain.** The named roles are defined and the
  shared primitives use them, but roughly 70 arbitrary sizes (`text-[9px]` through
  `text-[15.5px]`) survive in page and feature components: `home-dashboard.tsx`,
  `home-setup-card.tsx`, `leads-table.tsx`, `brand-studio.tsx`, `editor-shell.tsx`,
  `studio-shell.tsx`, `command-menu.tsx`. They are deliberately left rather than
  swept: most are 1 to 2px off a role, and replacing them by nearest number would
  change the density of tight rows and table cells that have not been visually
  re-reviewed. This is the next batch. Migrate a call site when you touch it, choosing
  the role that names the job. Sizes inside simulated provider previews (a mock Meta
  ad's own chrome) are content and stay.
- Roughly 250 generic radius utilities (`rounded-sm|md|lg|xl`) remain across
  `src/components/**`. They resolve through `--ui-radius` rather than a role. Migrate a
  call site to a role token when you touch it.
- About 27 top-level routes and the `(legal)` group do not carry the `.tw` scope, so
  they do not receive the scoped preflight or the base colour rule. Shared components
  still render correctly there because utilities are global and `[data-slot]` carries
  the preflight, but a page-level migration is outstanding.
- The `(legal)` layout still holds two inline hex colours (`#131b2e`, `#475569`) that
  should be tokens.
- Non-shared components still carry a small number of hardcoded colours. The named
  ones are `src/components/audit-claim-handler.tsx`, `src/components/trial-status-pill.tsx`,
  `src/components/research/audit-charts.tsx` (a parallel chart palette) and
  `src/components/operator/site-analytics-dashboard.tsx` (a one-off indigo).
- `--ui-sidebar*` is not bridged inside the dark block. Ad Studio does not use the
  shadcn Sidebar component, so it uses `--surface`/`--muted` for its own sidebar
  instead. Anything that starts using `--side-*` inside Ad Studio will be wrong.

## How to change this system

A new accent family, radius scale, typography system or navigation grammar is a system
change: it needs the owner's decision and a change to `DESIGN.md` and this guide in the
same commit. A purpose-built surface that reuses the existing vocabulary is not a
system change.

When you change an approved decision, update this guide in the same commit. When you
retune a colour, re-measure the contrast table above rather than eyeballing it.
