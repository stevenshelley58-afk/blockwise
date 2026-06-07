---
name: Executive Precision
product: Blockwise
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
    letterSpacing: 0
  headline-xl-mobile:
    fontFamily: manrope
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: 0
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

## Product Context

Blockwise helps real estate teams create, review, approve, launch, and track Meta ad campaigns through their own Meta ad account. The landing page should make the first-run concept linear: local research, campaign brief, generated campaign assets, approval, account-controlled launch, and reporting.

Ad Radar is a research and intelligence surface. It helps teams review local real estate ad patterns before creating their own campaign brief. It should never be presented as the whole product, and it should avoid unsupported access or certainty claims unless those capabilities are explicitly present in the product.

## Brand & Style

The design system is engineered for professional real estate teams running controlled advertising workflows. The brand personality is authoritative, discerning, and efficient. It balances the precision of a technical dashboard with the calm confidence expected by real estate principals, marketing coordinators, and admin teams.

The visual style is corporate, modern, and minimal. It uses expansive whitespace, sharp hierarchy, and restrained color to keep complex campaign setup understandable. The page must feel like premium enterprise SaaS, not a colorful agency template or generic property portal.

## Colors

The palette is anchored by Deep Navy (#123E75), used for brand, primary actions, focus states, and the most important labels. Refined Green (#31C46F) is reserved for active, success, and positive status states. It should appear sparingly so it keeps meaning.

Neutral tones carry most of the interface. White and Slate Surface (#F8FAFC) create clear product zones, while slate text and subtle borders keep dashboard cards legible without making the page heavy.

## Typography

Manrope is used for headlines and product-card titles because it feels modern, precise, and slightly technical. Inter is used for body copy, labels, navigation, and dense dashboard text because it remains readable in product UI.

Hierarchy rules:
- Eyebrows are uppercase, small, and contextual.
- Headlines are tight, heavy, and direct, but letter spacing remains neutral.
- Lead copy is calm and operational, explaining the workflow without hype.
- Product UI labels use compact, high-contrast text for scanning.

## Layout & Spacing

The layout follows a fixed 1200px shell with 24px gutters and generous vertical rhythm. The first viewport should feel close to the reference: navigation, left-aligned editorial hero copy, a right-side product dashboard mockup, and enough whitespace for the next section to begin below the fold.

Section order for the live landing page:
1. Hero
2. Problem
3. Ad Radar
4. Product workflow
5. Campaign types
6. Approval, account permissions, and housing-ad workflow
7. Dashboard/reporting
8. Trial and managed setup
9. FAQ
10. Footer

## Elevation & Depth

The page uses subtle outlines and soft ambient shadows. Cards are white on light surfaces with 1px #DFE6F0 borders. Dashboard and reporting panels may use a slightly deeper but still diffused shadow. Avoid heavy shadows, colorful gradients, nested marketing cards, decorative orbs, and cartoon illustration treatments.

## Shapes

The shape language is precise and rectangular. Buttons, dashboard panels, cards, inputs, and product surfaces use small radii, usually 4px to 8px. Status pills may use full rounding because they represent compact state labels, not structural cards.

## Components

### Buttons

Primary buttons use Deep Navy (#123E75) with white text. Secondary buttons use white backgrounds, subtle slate borders, and navy or slate text. Trial and setup CTAs should remain direct: "Start free trial" and "Book 15-min setup."

### Product Dashboard

The hero dashboard is a live HTML/CSS mockup, not a flattened image. It should show a real estate Meta ad approval workflow, ad preview, lead form context, budget/schedule control, and reporting metrics. Use property photography only inside product UI, not as a full-bleed hero background.

### Ad Radar

Ad Radar uses a split layout with compact filters and local ad-pattern cards. It should feel like research before campaign creation. Use suburb names, agency examples, campaign angle tags, and simple metadata without overclaiming source access.

### Approval And Reporting

Approval surfaces should emphasize:
- Campaigns launch through the customer's Meta ad account.
- Nothing goes live until the team approves the campaign.
- Daily or lifetime budget is reviewed before launch.
- Campaign setup is structured for housing-ad review requirements.
- Spend, clicks, leads, and campaign status are tracked after launch.

### Forms

Inputs use white backgrounds, #CBD5E1 borders, visible labels, linked IDs, useful `name` attributes, input `type`, and relevant autocomplete. Focus moves to a navy outline or glow without removing accessibility affordances.

### Charts And Tables

Charts use navy for the primary trend and refined green for secondary status or comparison. Tables stay quiet: light borders, compact row height, clear labels, and example-data badges when values are illustrative.
