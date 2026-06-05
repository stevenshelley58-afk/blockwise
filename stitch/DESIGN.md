---
name: Executive Precision
colors:
  surface: '#faf8ff'
  surface-dim: '#d2d9f4'
  surface-bright: '#faf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f3ff'
  surface-container: '#eaedff'
  surface-container-high: '#e2e7ff'
  surface-container-highest: '#dae2fd'
  on-surface: '#131b2e'
  on-surface-variant: '#434750'
  inverse-surface: '#283044'
  inverse-on-surface: '#eef0ff'
  outline: '#737781'
  outline-variant: '#c3c6d1'
  surface-tint: '#395f97'
  primary: '#002855'
  on-primary: '#ffffff'
  primary-container: '#123e75'
  on-primary-container: '#87aae8'
  inverse-primary: '#a9c7ff'
  secondary: '#006d38'
  on-secondary: '#ffffff'
  secondary-container: '#70fa9e'
  on-secondary-container: '#00723a'
  tertiary: '#19293d'
  on-tertiary: '#ffffff'
  tertiary-container: '#2f3f54'
  on-tertiary-container: '#9aaac3'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d6e3ff'
  primary-fixed-dim: '#a9c7ff'
  on-primary-fixed: '#001b3d'
  on-primary-fixed-variant: '#1e477e'
  secondary-fixed: '#73fda1'
  secondary-fixed-dim: '#53e087'
  on-secondary-fixed: '#00210d'
  on-secondary-fixed-variant: '#005228'
  tertiary-fixed: '#d3e4fe'
  tertiary-fixed-dim: '#b7c8e1'
  on-tertiary-fixed: '#0b1c30'
  on-tertiary-fixed-variant: '#38485d'
  background: '#faf8ff'
  on-background: '#131b2e'
  surface-variant: '#dae2fd'
  slate-surface: '#F8FAFC'
  border-subtle: '#DFE6F0'
  border-heavy: '#CBD5E1'
  success-muted: '#ECFDF5'
typography:
  headline-xl:
    fontFamily: manrope
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: manrope
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: manrope
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  headline-md:
    fontFamily: manrope
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  eyebrow:
    fontFamily: inter
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.1em
  body-lg:
    fontFamily: inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-bold:
    fontFamily: inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
  label-caps:
    fontFamily: inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  container-max: 1200px
  gutter: 24px
  section-v-padding: 80px
  section-v-padding-tight: 48px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 24px
---

## Brand & Style

The design system is engineered for the high-stakes world of institutional and professional real estate. The brand personality is **Authoritative, Discerning, and Efficient**, moving beyond typical SaaS aesthetics into a "Premium Professional" territory. It balances the cold precision of data with the high-touch feel of a luxury brokerage.

The visual style is **Corporate / Modern** with a lean toward **Minimalism**. It utilizes expansive whitespace to denote "room to breathe" and strategic use of sophisticated color to guide the eye. The interface avoids trendy gimmicks, opting instead for structural integrity, clear hierarchies, and a sense of permanence. Every element should feel intentional, reinforcing the platform's reliability as an enterprise-grade tool.

## Colors

The palette is anchored by **Deep Navy (#123E75)**, providing a foundation of trust and institutional stability. **Refined Green (#31C46F)** is used sparingly for growth indicators, primary actions, and success states, ensuring it retains its impact without appearing "neon" or distracting.

**Neutral Tones** play a critical role in the premium feel. We use a range of slate grays for text and UI borders to avoid the harshness of pure black. Surfaces primarily use white or a very light Slate Surface (#F8FAFC) to create distinct "zones" of information. High-contrast typography against these clean backgrounds ensures maximum legibility for data-heavy real estate metrics.

## Typography

This design system uses a dual-font strategy. **Manrope** is used for headlines to provide a modern, refined, and slightly technical character. Its geometric clarity conveys sophistication. **Inter** is the workhorse for body copy and UI labels, chosen for its exceptional legibility in data-dense environments and its neutral, systematic aesthetic.

A strict hierarchy is enforced:
- **Eyebrows** always appear in uppercase with increased letter spacing to provide context without competing with the main title.
- **Display titles** use tight letter spacing to feel "locked" and professional.
- **Lead text** (Body-LG) is used for section summaries to maintain the spacious, premium feel of the layout.

## Layout & Spacing

The layout follows a **Fixed Grid** philosophy for desktop, centering content within a 1200px "Shell" to ensure consistent line lengths and professional scanning patterns. We use a 12-column grid with 24px gutters.

**Vertical Rhythm:**
- Sections are separated by generous 80px padding to create a high-end, uncluttered experience.
- Functional groups (like form elements or card contents) use a strict 8px-based spacing system (stack-sm, stack-md, etc.).
- On mobile, side margins transition to 20px, and section padding reduces to 48px to maintain momentum while preventing "wall-of-text" fatigue.

## Elevation & Depth

To maintain a "Premium Professional" feel, the system avoids heavy drop shadows, instead using **Tonal Layers** and **Subtle Outlines**.

- **Primary Surface:** White (#FFFFFF).
- **Secondary Surface:** Slate-Surface (#F8FAFC) used for background containers to group related content.
- **Cards:** Defined by a 1px border (#DFE6F0) rather than a shadow. This creates a crisp, architectural look.
- **Active States:** Only active or hovered cards may use a very soft, highly diffused ambient shadow (0px 4px 20px rgba(15, 23, 42, 0.05)) to suggest interactivity without breaking the flat aesthetic.
- **Separators:** Use a subtle 1px divider (#DFE6F0) for horizontal rules in lists or tables.

## Shapes

The shape language is **Soft (0.25rem)**. This subtle rounding takes the edge off the "brutal" corporate feel while maintaining a sense of precision. 

- **Standard Elements:** Buttons and Input fields use 4px (0.25rem) corners.
- **Containers:** Feature cards and dashboard "App Windows" use 8px (0.5rem) to feel distinct from smaller UI components.
- **Status Pills:** Use a full pill shape (rounded-full) to clearly distinguish them from interactive buttons or structural cards.

## Components

### Buttons
- **Primary:** Deep Navy (#123E75) background, white text. No shadow.
- **Secondary/Ghost:** 1px border (#DFE6F0), Deep Navy text. Transitions to a light slate background on hover.
- **Success/CTA:** Refined Green (#31C46F) background. Used specifically for the "Start Trial" or "Launch Ad" actions.

### Data Displays (Cards)
Cards should have no background fill when placed on the Slate-Surface, or a White fill when on a Navy background. All cards feature a 1px #DFE6F0 border. Headers within cards should use `label-caps` for a disciplined, organized look.

### Input Fields
Inputs use a white background with a 1px #CBD5E1 border. On focus, the border shifts to Primary Navy with a subtle 2px glow of the same color at 10% opacity. Label text is always `label-bold`.

### Chips & Badges
- **Status Badges:** Use `success-muted` background with the Refined Green text for "Active" states.
- **Location Pills:** Small, neutral gray chips used in the "Radar" view to categorize data without drawing attention away from primary metrics.

### Charts & Graphs
Charts utilize the Primary Navy for main trend lines and Refined Green for secondary comparative data. Grid lines must be the Light Neutral Gray (#EDF1F6) to remain unobtrusive.