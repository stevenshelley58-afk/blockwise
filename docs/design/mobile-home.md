# Customer Home: creative-first direction

This document supersedes the earlier September 2026 mobile Home pilot guidance.
It applies only to `/self-serve` and refines the existing Blockwise design
system. It does not change Ads, Results, Leads, operator pages, or the shared
navigation contract.

## Product intent

Home is a calm creative workbench, not a status dashboard. Lead with the
customer's actual ad creative or a truthful preview-unavailable state. Follow
with a small number of useful recommendations that help the customer decide
what to make or improve next.

Recommendations must come from the existing HomeData/read models and approved
resolver/provider data. Show source, freshness, and pending or unavailable
states when those facts are known. Never invent a recommendation, metric,
connection state, completion state, or asset. If recommendations cannot load,
say so and offer the existing recovery path.

Home must not become an identity, setup, reporting, or administration surface:

- Do not repeat workspace or account identity in the Home title area. Account
  details remain available inside the accessible account menu.
- Do not put a setup checklist, progress dashboard, activation summary, or
  onboarding administration panel on Home.
- Do not put Results metrics, performance telemetry, billing, provider controls,
  or operator/admin tools on Home. Link to the permitted route when needed.
- Do not use placeholder “recommended” cards to fill an empty state.

## Layout and hierarchy

- Use one `Home` title in the shell. The title is present across breakpoints;
  the desktop breadcrumb does not repeat workspace identity.
- Start with the creative preview. Use the existing shared preview/card
  primitives, readable at 320px, and branch honestly for image, video,
  text-only, failed, or unknown media.
- Keep the surface continuous and quiet. Use hairlines, spacing, and the
  established neutral tokens before adding cards. Rounded panels are for
  meaningful grouping, not decoration.
- Place one obvious, bounded next action near the creative. It must be a real
  route or resolver-backed action and must preserve return/back state.
- Keep recommendations secondary to the creative. Show only useful, actionable
  items, with a concise rationale when the rationale is supplied by data.
- Avoid identity/setup/results/admin summaries, decorative hero copy, and
  repeated headings.

## Actions and controls

- **Absolute rule: no full-width CTA on Home.** Primary actions are bounded by
  their content or a sensible max width on every viewport, including 320px.
  They remain reachable, at least 44px high, and never cause horizontal scroll.
- Use the existing ink action colour, `--r-ctl`, and shadcn/Tailwind bridge.
  Do not introduce a page-local button style or accent.
- Keep account details behind the account menu. The closed trigger is a plain,
  compact `UserRound` control with no initials, avatar box, or decorative
  container; it remains an accessible 44px target on mobile.
- Home does not show the sidebar theme toggle. This does not add a full-page
  dark Home theme; the existing sidebar theme behavior remains intact.
- The five mobile destinations remain Home, Ads, Results, Leads, and More.
  Home's pilot vocabulary is `House`, `Megaphone`,
  `ChartNoAxesCombined`, `UsersRound`, and `Ellipsis`, using consistent 22px
  strokes. Other routes retain their current navigation treatment.

## States and safety

Use the existing HomeData and activation/recommendation resolvers. Preserve
truthful loading, empty, partial, and error states. Empty creative state should
explain the next real recovery action, not display a zeroed dashboard. Save,
retry, cancel, and Back remain visible and recoverable in every layered flow.
Do not write provider data or bypass auth to make a recommendation appear.

The customer Home surface is light-only. Use existing `--surface`, `--line`,
ink, muted, and semantic tokens. Sidebar theme support is not permission to
create a new Home dark-mode treatment.

## Responsive and accessibility targets

Design at 390 × 844 first, then verify 320px and desktop. Preserve safe-area
insets and space for the shared fixed navigation. No horizontal overflow,
clipped labels, or controls below 44px. Keep preview media legible and retain
meaningful accessible names when an image or video is unavailable. Respect
reduced motion and keep overlays above navigation without covering consent or
keyboard focus.

## Review checklist

- Is the first useful thing the customer's real creative or an honest
  preview-unavailable state?
- Are every recommendation and action backed by existing product data and a
  real route?
- Is the CTA bounded rather than full width at every viewport?
- Is Home free of identity, setup, Results, billing, and admin summaries?
- Does the account menu retain details without putting them in the closed
  header?
- Does the Home-only icon/header treatment leave other routes unchanged?
