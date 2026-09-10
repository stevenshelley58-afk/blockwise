# Mobile Home pilot

Status: approved direction, implementation pilot limited to /self-serve.
Mode: Operate.

## Direction contract
- Thesis: A task-first native-feeling home, not a miniature website dashboard.
- References: Todoist list simplicity, Linear restraint, Stripe compact reporting.
- World: Existing Blockwise ink/surface/token bridge. Inter utility typography, consistent outline icons, thin separators, no decorative panels or shadows.
- Story: Next action first, real results second, useful tools next. Workspace administration opens only when requested.
- First viewport: One compact Home bar, exact activation action, honest compact results, useful rows, persistent five-tab navigation.
- Form: Continuous surface with flat rows, not a grid of cards. Details use accessible disclosures. Existing brand tokens retained.
- Scope: Home body and route-scoped mobile shell only. Other routes retain current design pending user approval.
- Seed: e233a07f; foreign challenger draw overridden by the user's explicit approved native utility references.

## Acceptance
Preserve workspace isolation, cached read-model shape, feature gates, activation source-of-truth routes and billing terms. Missing reporting never becomes zero. Completed setup remains accessible. Touch targets at least 44px; primary action 48px. No entrance/count-up animation. No horizontal clipping at 320, 375, 390, 414, 768 and desktop; do not hide overflow as a substitute for layout. One visible Home title. Natural short scrolling is acceptable on small phones; never reduce readable type to force fit.

## Implementation boundaries
Home dashboard, activation presentation, loading state, optional shared mobile primitives, route-scoped shell/nav styles, focused tests, DESIGN.md documentation. No source files deleted. No provider writes or worker activation.
