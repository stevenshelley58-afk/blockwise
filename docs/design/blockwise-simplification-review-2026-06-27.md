# Blockwise UI Simplification Review

Date: 2026-06-27
Scope: marketing entry, self-serve onboarding, Ad Studio, Results, and Ad Radar.
Artifacts: [static mockup sheet](mockups/blockwise-simplification-mockups.html)

## Read

Blockwise is a work-focused B2B product for real estate ad execution. The design target should be premium utility: quiet surfaces, strong hierarchy, low choice cost, and one obvious route to a launched ad.

Design dials used for this review:

- Utility flow:friction target: 95:5.
- Leverage: primary action or information should be at least 1.5x the next priority, and solo hero leverage should be at least 2x.
- Rhythm: utility surfaces should live mostly in 8 to 16px spacing; narrative sections can use 24 to 32px; hero moments can use 64 to 96px.
- Disruption: one controlled accent or memorable move per screen.
- Transferability: the screen should still work at 80x80, in grayscale, without imagery, and with lorem ipsum text.

## Part 1: Findings

| Axis | Finding | Evidence | Standard Hit | Recommended Change |
| --- | --- | --- | --- | --- |
| Journey clarity | The first-ad path is split across landing CTAs, `/self-serve`, Ad Studio Home, Ad Studio rail, and Setup links. Users must decide where to start instead of being carried to the first useful outcome. | `src/app/(customer)/self-serve/page.tsx:42`, `src/app/(customer)/self-serve/page.tsx:50`, `src/app/(customer)/self-serve/page.tsx:58`, `src/app/(customer)/self-serve/page.tsx:81`, `src/app/(customer)/self-serve/page.tsx:85`, `src/components/adstudio/ad-studio-workbench.tsx:79`, `src/components/adstudio/ad-studio-workbench.tsx:910`, `src/components/adstudio/ad-studio-workbench.tsx:947` | Utility surfaces should be 95:5 flow:friction. The current entry path feels closer to a menu than a guided tool. | Make "Create first ad" the only primary first-run action. Move brand, media, copy, and publish readiness into one guided Ad Studio checklist. Remove the Ad Studio Home tools grid after first launch. |
| Visual system | Three active token systems are competing: global navy, monochrome override, and electric-blue landing. Self-serve adds its own `--h-*` system and serif display type. | `src/app/globals.css:16`, `src/app/theme-monochrome.css:29`, `src/app/landing.css:8`, `src/app/(customer)/self-serve/self-serve.css:2`, `src/app/(customer)/self-serve/self-serve.css:3` | Transferability and brand memory weaken when accent, radius, and typography change per surface. | Pick one application theme. Recommended: keep the monochrome neutral surface language, restore a restrained Blockwise navy as the action accent, and delete self-serve local tokens. |
| CSS ownership | Landing styles exist in both `globals.css` and `landing.css`, while `layout.tsx` imports `landing.css` globally. This makes the marketing system harder to reason about. | `src/app/layout.tsx:12`, `src/app/globals.css:5596`, `src/app/globals.css:7028`, `src/app/landing.css:8` | Delete over abstract. A single owner per surface reduces regression risk. | Move current landing styles into one owned file or route-level module. Delete stale landing blocks from `globals.css` after visual parity is confirmed. |
| Landing hierarchy | The landing page repeats eyebrow-driven sections and multiple CTA intents before the user reaches the first product action. | `src/app/page.tsx:674`, `src/app/page.tsx:727`, `src/app/page.tsx:762`, `src/app/page.tsx:876`, `src/app/page.tsx:897`, `src/app/page.tsx:911`, `src/app/page.tsx:663`, `src/app/page.tsx:717`, `src/app/page.tsx:753`, `src/app/page.tsx:883`, `src/app/page.tsx:967` | Eyebrows should be scarce. One screen should have one dominant action path. | Collapse the landing page to: problem proof, how Blockwise prepares the ad, results evidence, price, FAQ. Keep one CTA intent until pricing. |
| Ad Studio hierarchy | Ad Studio has a rail, a Home checklist, a preview card, and a four-card tools grid that all point to the same work. | `src/components/adstudio/ad-studio-workbench.tsx:79`, `src/components/adstudio/ad-studio-workbench.tsx:910`, `src/components/adstudio/ad-studio-workbench.tsx:947`, `src/components/adstudio/styles.ts:48`, `src/components/adstudio/styles.ts:69` | Primary leverage should be at least 1.5x the next priority. Duplicate navigation flattens hierarchy. | Replace Home with a compact "Brief, Media, Copy, Review" command path. Keep preview central and make the next incomplete task the single primary action. |
| Control scale | Ad Studio ships a local 38px button scale while global buttons are 40px. This is small, but it is a visible sign of component drift. | `src/components/adstudio/styles.ts:21`, `src/app/globals.css:763` | Controls should feel shared across the product and maintain 40px minimum hit targets. | Convert Ad Studio buttons to the shared control scale and extract repeated overlays, menus, and dialog shells. |
| Results density | Results renders six KPIs, three charts, a campaign hierarchy table, ad breakdowns, secondary charts, and angle performance in one long page. There is no strong "what needs attention" leverage point. | `src/components/monitor/MetaMonitorDashboard.tsx:160`, `src/components/monitor/MetaMonitorDashboard.tsx:244`, `src/components/monitor/MetaMonitorDashboard.tsx:278`, `src/components/monitor/MetaMonitorDashboard.tsx:284` | Utility dashboards need one high-leverage read before detail. | Add a top "Needs attention" strip with 2 to 3 operational recommendations. Move deep hierarchy into drilldown and show mobile campaign cards instead of the full hierarchy table by default. |
| Ad Radar empty state | Ad Radar hides metrics and results until a search is run, so the first view has little evidence value. | `src/components/research/ad-radar-search-panel.tsx:79`, `src/components/research/ad-radar-search-panel.tsx:362`, `src/components/research/ad-radar-search-panel.tsx:371` | The first viewport should prove the tool before asking for effort. | Show a default market snapshot, recent saved examples, and recommended searches before input. Keep filters collapsed until a query exists. |
| Pricing implementation | Pricing is clearer than before, but the card is still a one-off inline layout that does not share the product panel system. | `src/app/pricing/page.tsx:51`, `src/app/pricing/page.tsx:78`, `src/app/pricing/page.tsx:170`, `src/app/pricing/page.tsx:183` | Repeated commercial surfaces should share components to preserve rhythm. | Extract a pricing panel and reuse the same CTA, checklist, and supporting-note components as landing. |

## Part 2: Verdict

Decision: **Block visual expansion, approve simplification-first iteration.**

The current build is functionally credible, but the interface is accumulating parallel patterns. Adding more polish before simplifying the first-ad path would lock in extra code and extra user decisions. The highest-value change is not a new visual style. It is removing duplicate entry points, then letting the remaining surfaces share one system.

Impact tiers:

- P0: First-ad journey. One primary action, one guided checklist, one launch path.
- P1: Token convergence. One accent, one radius scale, one type system, one landing CSS owner.
- P2: Dashboard leverage. Results and Ad Radar should open with an answer, not a set of controls.
- P3: Interaction polish. Button scale, dialog shells, motion durations, focus states, and copy cleanup.

## Proposed Information Architecture

### Current

1. Landing page offers trial, property check, prepared ad, walkthrough, and demo.
2. `/self-serve` offers launch, templates, setup checklist, and banner.
3. Ad Studio offers Home, Templates, Media, Text, Publish, Settings.
4. Results and Ad Radar each require the user to interpret dense operational data.

### Proposed

1. Landing has one commercial path: "Create your first ad".
2. `/self-serve` becomes a first-run command center with one primary action and a small readiness checklist.
3. Ad Studio owns creation. It has four work states: Brief, Media, Copy, Review.
4. Results opens with recommendations, then metrics.
5. Ad Radar opens with market evidence, then search.

## Phased Plan

### P0: Make First Launch Obvious

- Replace `/self-serve` dual CTAs with one primary action: "Create first ad".
- Carry incomplete setup tasks into Ad Studio as non-blocking readiness checks.
- Remove the Ad Studio Home tools grid once the user has a draft.
- Route "View templates" into the same create flow as a starting option, not a sibling destination.
- Success metric: a new user can identify the next action in under 5 seconds on desktop and mobile.

### P1: Collapse Visual Systems

- Decide the canonical theme in `globals.css` and `theme-monochrome.css`.
- Remove `--h-*` tokens and `Newsreader` from self-serve.
- Change `landing.css` to consume global action tokens or explicitly scope all landing-only tokens to the landing route.
- Delete stale landing blocks from `globals.css` after parity.
- Success metric: one accent color family and one control/radius scale across app surfaces.

### P2: Rebuild The High-Leverage Reads

- Results: add a "Needs attention" strip above KPIs and move deep hierarchy into drilldown.
- Results mobile: show campaign/ad cards first, not the full table.
- Ad Radar: show default market snapshot, saved examples, and suggested searches before the first query.
- Landing: reduce section count and keep one CTA intent until pricing.
- Success metric: every major surface has one 1.5x dominant read or action.

### P3: Finish The Craft Pass

- Normalize buttons to the 40px shared scale.
- Replace local dialog/menu patterns with shared shells.
- Use 150ms interaction transitions for controls and avoid broad transitions.
- Add tabular numbers to KPI and pricing values.
- Remove visible em dash copy from marketing and first-run screens.
- Success metric: the same screen works in grayscale, at 80x80, without images, and with placeholder text.

## Mockups

The mockup sheet is a static artifact at:

`docs/design/mockups/blockwise-simplification-mockups.html`

It contains four proposed views:

1. First Ad Command Center.
2. Simplified Ad Studio.
3. Results With Needs Attention.
4. Ad Radar With Default Evidence.

These are not final production UI. They are direction-setting layouts for the simplification pass.

## Implementation Notes

- Keep the first production PR narrow: self-serve plus Ad Studio Home only.
- Do not start by restyling every surface. The first win should be removing duplicated decisions.
- Keep existing routes working while changing their first viewport and primary CTA behavior.
- Treat stale landing CSS deletion as a separate PR so visual parity can be checked cleanly.
