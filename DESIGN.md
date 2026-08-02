---
name: Blockwise Atlantic
description: A calm Atlantic command deck for trustworthy real-estate advertising work
colors:
  signal: "#F23B1D"
  signal-dark: "#FF5A36"
  atlantic-shell: "#06111F"
  atlantic-rail: "#081A2E"
  atlantic-card: "#0A213A"
  clear-white: "#FFFFFF"
  blue-white: "#F8FAFD"
  navigation-mist: "#F3F7FB"
  atlantic-ink: "#112A46"
  muted-navy: "#65768A"
  hairline: "#D5E1ED"
  acid-verified: "#B8F238"
  running-blue: "#6F9DF2"
  waiting-amber: "#F3BD4A"
  critical-red: "#EF5B5B"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 5vw, 5rem)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 3vw, 2.5rem)"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.3
  mono-label:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.12em"
rounded:
  indicator: "4px"
  control: "8px"
  card: "12px"
  panel: "16px"
  overlay: "24px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  3xl: "48px"
  4xl: "64px"
components:
  button-primary:
    backgroundColor: "{colors.atlantic-ink}"
    textColor: "{colors.clear-white}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-signal:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.atlantic-shell}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  input:
    backgroundColor: "{colors.clear-white}"
    textColor: "{colors.atlantic-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.card}"
    padding: "0 12px"
    height: "44px"
  card:
    backgroundColor: "{colors.blue-white}"
    textColor: "{colors.atlantic-ink}"
    rounded: "{rounded.card}"
    padding: "16px"
---

# Design System: Blockwise Atlantic

## Overview

**Creative North Star: "The Atlantic Advertising Desk"**

Blockwise is a calm command deck for creating, reviewing, publishing, and verifying real-estate advertising. Blue-white work surfaces keep long sessions clear; layered navy creates a grounded control environment; vermilion marks identity, focus, and consequential forward action.

The system is one visual language across marketing, customer, operator, monitor, legal, and editorial surfaces. Product content and density may change by job, but token roles, typography, geometry, focus, state, and responsive behavior do not.

**Key Characteristics:**

- blue-white light surfaces and layered Atlantic navy dark surfaces
- one vermilion identity/action signal
- acid green reserved for verified or actively healthy state
- Inter interface type with IBM Plex Mono operational metadata
- restrained 8/12/16px geometry with hairlines before shadows
- state communicated with text or icons, never color alone

## Colors

Atlantic is a restrained navy system expressed under two light conditions. The frontmatter tokens are normative; `src/design-system/atlantic.css` is the runtime source.

### Primary

- **Blockwise Signal:** Identity, focus, selected emphasis, and consequential forward action. It is never a decorative wash.
- **Atlantic Shell:** The deep command surface, central composer, and dark-mode canvas. Pure black is not part of the interface palette.

### Secondary

- **Acid Verified:** Verified, complete, or actively healthy state only.
- **Running Blue:** Running or in-progress state and quantitative display.
- **Waiting Amber:** Review, waiting, and approval state.
- **Critical Red:** Failure and destructive action.

### Neutral

- **Clear White / Blue-White / Navigation Mist:** Base, raised, and sunken light-mode layers.
- **Atlantic Rail / Atlantic Card:** Standard and raised dark-mode layers.
- **Atlantic Ink / Muted Navy / Hairline:** Primary text, supporting text, and persistent structure.

**The Signal Rule.** Vermilion marks Blockwise, focus, selection, and consequential action; it does not decorate headings, charts, or card collections.

**The Truthful State Rule.** Running, waiting, verified, blocked, and failed always pair color with a readable label or icon.

## Typography

**Display Font:** Inter (with native system sans fallback)
**Body Font:** Inter (with native system sans fallback)
**Operational Font:** IBM Plex Mono (with native monospace fallback)

Inter keeps the product direct and legible across dense control surfaces and public explanations. IBM Plex Mono is limited to short operational labels, timestamps, table headers, and evidence metadata.

### Hierarchy

- **Display** (600, 40–80px fluid, 1.15): marketing and meaningful empty-state moments; maximum 6rem.
- **Headline** (650, 28–40px fluid, 1.2): the single screen title.
- **Title** (600, 18–28px, 1.25–1.3): section and panel ownership.
- **Body large** (400, 16px, 1.55): persuasive and long-form reading.
- **Body** (400, 14px, 1.5): standard product copy; keep readable measures near 65–75ch.
- **Label** (600, 12px, 1.3): controls and states.
- **Mono label** (600, 10–11px, 0.12–0.16em): uppercase operational metadata only.

**The Operational Mono Rule.** Monospace communicates measurement, provenance, or machine state; it is never a decorative technology costume.

## Layout

The product scales from one focused surface on compact screens to a 240px rail, fluid workspace, and optional 320–360px contextual frame on desktop. Reading width caps near 760px while work canvases may grow to 1600px. The base rhythm is 4px, with 8, 12, 16, 24, 32, 48, and 64px preferred jumps.

- **0–599px:** top bar, one task surface, bottom navigation, 44px minimum targets.
- **600–767px:** wider compact composition and full-width sheets.
- **768–1023px:** collapsible rail and contextual drawers.
- **1024–1439px:** persistent 240px rail and workspace.
- **1440px+:** 360px optional frame; shell caps at 1600px.

Mobile reorganizes information instead of shrinking controls. Tables become labeled cards unless side-by-side comparison is essential.

## Elevation & Depth

Persistent structure uses adjacent tonal layers and 1px semantic borders. Shadows are reserved for floating menus, sheets, dialogs, and temporary elevation; resting cards remain flat when border and tone already explain the hierarchy.

- **Inline:** 1px semantic hairline.
- **Floating:** `0 12px 34px rgb(6 17 31 / 12%)`.
- **Overlay:** `0 24px 64px rgb(6 17 31 / 16%)`.
- **Focus:** 3px vermilion halo plus border contrast.

**The Hairline-First Rule.** If tone and a 1px boundary establish the layer, no shadow is added.

## Shapes

Atlantic uses 4px for indicators, 8px for compact controls and list selections, 12px for fields/cards/menus, 16px for primary panels and work composers, and 20–24px for sheets/modals. Full pills are limited to avatars, status dots, and genuinely compact chips; buttons are not universal pills.

## Components

### Buttons

- **Primary:** Atlantic ink on light surfaces and cool white on dark surfaces; one dominant action per region.
- **Signal:** Vermilion with deep Atlantic text; reserved for forward/consequential action.
- **Secondary:** Transparent or raised surface with a strong border.
- **Destructive:** Critical red plus an explicit destructive verb.
- **States:** 140ms hover/focus, 220ms state change, 3px visible focus, 44px compact target.

### Cards / Containers

Cards use a 12px corner, semantic surface, 1px boundary, and 16–20px padding. Primary panels use a 16px corner. Nested card shadows are prohibited.

### Inputs / Fields

Fields keep persistent labels, reserve help/error space, use a 12px corner, and show a vermilion focus halo. Placeholders never replace labels.

### Navigation

Active location uses shape, label, and a signal tint or border—not color alone. Desktop uses a persistent/collapsible rail; mobile uses no more than five primary destinations plus More.

### Status

Running, verifying, verified, waiting, blocked, and failed variants always include readable text. Determinate progress uses a bar plus percentage or step count; indeterminate work uses text and a restrained state indicator.

## Do's and Don'ts

### Do:

- **Do** consume semantic Atlantic variables or shadcn tokens instead of literal palette values.
- **Do** keep the next useful action and the current system state visible.
- **Do** use borders and tonal layering before shadows.
- **Do** preserve 44×44px mobile targets, visible focus, reduced motion, and reflow to 320px.
- **Do** provide loading, empty, success, error, disabled, and partial-success states.

### Don't:

- **Don't** introduce route-local palettes, typography systems, radius scales, navigation grammars, or token overrides.
- **Don't** use pure black, gradient text, decorative glass, cream SaaS styling, or generic neon AI chrome.
- **Don't** use vermilion as chart decoration or acid green outside verified/healthy state.
- **Don't** turn product surfaces into repetitive same-size card grids or expose internal provider/model language to customers.
- **Don't** communicate success while generation, QA, persistence, publication, or export remains incomplete.
