# Mobile Home pilot

This is the visual and interaction guide for the approved mobile Home pilot at
`/self-serve`. It extends Blockwise Premium v2 for this route only. It does not
change other customer screens, operator pages, or navigation on other routes. Home has a route-scoped mobile title bar and tab treatment.

## The intended feel

A quiet, useful operations desk. The customer should see the next safe task
first, understand current progress, and reach the rest of the workspace without
searching through dashboard decoration.

## Building blocks

- **Continuous surface:** one white customer surface, with
  existing hairline `--line` separators. Avoid a page made from stacked cards.
- **Primary task:** one resolver-backed CTA using the exact activation action and
  path. It is 48px high, full width on mobile, uses `--r-ctl` (10px), and uses
  semantic primary colours.
- **Progress:** show a small honest setup count and bar. Put completed milestones
  behind a native disclosure.
- **Results:** use three compact inline columns on mobile for leads, cost per
  lead, and ads. Keep values tabular and compact large numbers with a full
  accessible value. Keep credits in Workspace details.
- **Tool rows:** use simple reachable rows with a meaningful icon, a 15px action
  label, 13px supporting text, and one trailing chevron. Filter rows by enabled
  features.
- **Workspace details:** collapse plan and billing, direct Meta connection,
  onboarding call, and render credits into one disclosure below the tool rows.
  Preserve truthful pending and unavailable copy, including direct versus
  assisted connection context.
- **Mobile navigation:** the shared shell provides one five-destination bar:
  Home, Ads, Results, Leads, and More. Keep body content clear of it and of
  safe-area insets.

## Data and states

Use the existing HomeData read model and activation resolver. Never manufacture
zeroes, timestamps, connection states, payment states, or completed milestones.
For unavailable reporting, say what is unavailable and provide the most relevant
recovery link. Keep the exact incomplete activation CTA and resume path.

The current customer surface is light-only. Sidebar theme support does not imply
a full-page dark Home theme.

## Responsive target

Design at 390 by 844 first. The purpose, progress, CTA, and the start of results
should be visible without unnecessary scrolling. At 320px, allow natural vertical
scrolling; do not clip labels or create horizontal overflow. All interactive
controls remain at least 44px, with the primary CTA at 48px.

## Future extension (not applied yet)

These rules are practical defaults for future Home-like screens, not a global
rollout: prefer flat sections over nested card grids, use one obvious action,
keep supporting copy to 13px or larger, and reserve compact notation for values
with a complete accessible label. Each route still needs its own review before
adopting the pilot pattern.
