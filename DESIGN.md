---
name: Blockwise
description: Calm, exact tools for real-estate ad execution
colors:
  primary: "#16181d"
  primary-strong: "#0b0c10"
  primary-press: "#000000"
  primary-tint: "#f1f2f4"
  canvas: "#f6f7f9"
  surface: "#ffffff"
  ink: "#16181d"
  muted: "#545a66"
  faint: "#9aa0ad"
  line: "#e9ebef"
  line-heavy: "#d3d7df"
  success: "#006d38"
  warning: "#8a5a00"
  danger: "#ba1a1a"
typography:
  headline:
    fontFamily: "Manrope, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Manrope, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0"
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
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 18px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 18px"
    height: "44px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "44px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "16px"
---

# Design System: Blockwise

## 1. Overview

**Creative North Star: "The Quiet Operations Desk"**

Blockwise is a work-focused product used while a real-estate team is preparing,
checking, or improving live advertising. The interface should feel like a calm
operations desk: the next action is obvious, system state is legible, and visual
craft supports the work without competing with it.

The active product register is restrained. Neutral layers carry structure, the
near-black accent marks primary actions and current selection, and semantic
colors appear only when they communicate status. Familiar controls and dense,
well-grouped information are preferred over decorative novelty.

The system rejects parallel visual languages. AdStudio, Monitor, Operator, and
self-serve surfaces should consume the same token and component vocabulary. A
surface may be purpose-built, but it may not introduce a new accent family,
radius scale, typography system, or navigation grammar.

This qualitative language is a codification of the active monochrome theme,
checked-in design reviews, binding repository rules, and the approved AdStudio
architecture. Those sources are its provenance; explicit confirmation of this
working register remains required before UI implementation. This document is
not a redesign.

**Key Characteristics:**

- quiet, neutral work surfaces
- strong hierarchy with one dominant action or read
- familiar controls with complete interaction states
- honest progress, conflict, error, and partial-success feedback
- compact information density without crowding

## 2. Colors

The palette is near-monochrome and operational. Primary ink and action color are
the same near-black; separation comes from neutral layers, borders, and spacing.

### Primary

- **Operations Ink** (`primary`): primary buttons, active navigation, selected
  states, and the strongest text. Its rarity preserves action hierarchy.
- **Pressed Ink** (`primary-strong`, `primary-press`): hover and active feedback,
  never decorative background fill.
- **Selection Mist** (`primary-tint`): selected rows, quiet hover surfaces, and
  low-emphasis action context.

### Neutral

- **Work Canvas** (`canvas`): the page and workbench background.
- **Clean Surface** (`surface`): controls, panels, dialogs, and editable regions.
- **Body Slate** (`muted`): supporting text that still meets contrast targets.
- **Quiet Slate** (`faint`): nonessential metadata only, never body copy or form
  placeholders.
- **Hairline** (`line`) and **Control Line** (`line-heavy`): structural borders
  and input boundaries.

### Secondary

- **Verified Green** (`success`): accepted, connected, and completed states.
- **Attention Amber** (`warning`): review-required states that are not failures.
- **Blocking Red** (`danger`): destructive actions and release-blocking errors.

**The One Voice Rule.** Operations Ink is the only general action accent. Do not
introduce a second decorative accent for an individual route.

**The Semantic Color Rule.** Green, amber, and red communicate state. They never
decorate headings, cards, or illustrations.

## 3. Typography

**Display Font:** Manrope (with Inter and system sans fallbacks)

**Body Font:** Inter (with system sans fallbacks)

**Character:** Manrope gives page and panel headings firm, compact authority.
Inter carries controls, copy, and data without calling attention to itself.

### Hierarchy

- **Headline** (700, `headline`, 1.12): page titles and the single dominant
  heading on a task surface.
- **Title** (700, `title`, 1.2): panel and section ownership.
- **Body** (400, `body`, 1.5): instructions, descriptions, and product copy;
  prose stays within 65 to 75 characters where practical.
- **Label** (600, `label`, 1.4): controls, fields, compact status, and metadata.

**The Product Type Rule.** Display typography stops at headings. Buttons,
labels, data, and navigation use the body family and familiar product sizing.

**The Sentence Case Rule.** Labels and actions use sentence case. Uppercase is
reserved for very short platform-native metadata where the source convention
requires it.

## 4. Elevation

Blockwise uses tonal layering and one-pixel boundaries first. Resting surfaces
use a very soft structural shadow; floating menus and dialogs use a broader
ambient shadow. Elevation must explain stacking or interaction, not decorate a
card grid.

### Shadow Vocabulary

- **Resting surface** (`0 1px 2px rgba(16,18,23,.04), 0 5px 18px
  rgba(16,18,23,.05)`): panels that need separation from Work Canvas.
- **Floating surface** (`0 10px 30px rgba(16,18,23,.09)`): dialogs, menus, and
  intentionally raised interactive surfaces.
- **Focus ring** (`0 0 0 3px rgba(22,24,29,.14)`): the canonical visible focus
  treatment when a component has no more specific accessible focus style.

**The Flat-First Rule.** If border and tonal layer explain the hierarchy, do not
add a shadow. Nested card shadows are prohibited.

## 5. Components

### Buttons

- **Shape:** full pill for shared product buttons (`pill`), with a 44-pixel
  minimum height.
- **Primary:** Operations Ink background, Clean Surface text, compact horizontal
  padding, and a clear disabled/loading state.
- **Hover / Focus:** Pressed Ink on hover; the canonical focus ring on keyboard
  focus; no bounce or decorative transform.
- **Secondary:** Clean Surface with Control Line boundary and Operations Ink
  label. Ghost actions are reserved for low-priority inline tools.

### Chips

- **Style:** full pill, compact label, tinted neutral or semantic background.
- **State:** selected chips use Operations Ink with white text. Status chips use
  semantic color only when the status meaning is explicit in text.

### Cards / Containers

- **Corner Style:** gently rounded cards (`card`) and larger work areas (`panel`).
- **Background:** Clean Surface over Work Canvas or Selection Mist.
- **Shadow Strategy:** flat first; Resting Surface only where separation is weak.
- **Border:** Hairline for grouping; Control Line for interactive boundaries.
- **Internal Padding:** 16 pixels for compact cards, 24 pixels for primary work
  sections.

### Inputs / Fields

- **Style:** Clean Surface, Control Line border, `control` radius, 44-pixel
  minimum height, and labels outside the value area.
- **Focus:** Operations Ink boundary plus visible ring/tint; never color alone.
- **Error / Disabled:** error text and boundary remain readable; disabled fields
  retain their value and label without appearing interactive.

### Navigation

Shared navigation uses familiar side rail, top bar, and mobile bottom navigation
patterns. Active items have one solid or tinted selection treatment. Hover,
focus, active, and current-page states must remain distinguishable in both light
and dark sidebar modes.

### Creative Workbench

The ad is the visual focus. Editing controls live beside or directly on the ad
without covering important content. Every image-region interaction has a field
list alternative, and Feed/Story status is visible together when shared copy is
changing.

## 6. Do's and Don'ts

### Do:

- **Do** make one next action or operational read visibly dominant.
- **Do** use the shared near-black accent, neutral layers, radius scale, Inter,
  and Manrope before adding route-local values.
- **Do** provide default, hover, focus, active, disabled, loading, error, and
  success states for every interactive component.
- **Do** use 150 to 250 millisecond state transitions and honor reduced motion.
- **Do** keep touch targets at least 44 by 44 pixels even when the visible
  control is compact.
- **Do** show partial success, stale formats, QA blockers, and retry state with
  explicit text.

### Don't:

- **Don't** build menu-heavy SaaS dashboards that offer several equivalent
  starting points.
- **Don't** use generic AI styling: gradient text, decorative glass, cream SaaS
  palettes, repetitive card grids, or gratuitous motion.
- **Don't** expose design-tool complexity, layers, provider jargon, model
  controls, or implementation vocabulary to ordinary AdStudio users.
- **Don't** make template galleries whose ads share one layout skeleton or
  visual archetype.
- **Don't** imply success while generation, QA, persistence, or export is
  incomplete or stale.
- **Don't** create parallel component, token, typography, or navigation systems
  across product surfaces.
- **Don't** use colored side-stripe card accents, gradient text, default
  glassmorphism, decorative hero metrics, or nested cards.

## 7. Implementation Governance

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
- Operator and monitor surfaces remain on the existing CSS shell until their
  own migration; the two systems coexist via the scoped, no-preflight Tailwind
  setup and must not be mixed within one route.
- This register remains "the quiet operations desk": shadcn is the delivery
  mechanism, not a new visual language. Density, restraint, and the one-voice
  accent rule still govern every component choice.
