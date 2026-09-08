# Quiet card: performance and creative context

## Scope and direction

Surface: the daily summary, weekly performance report and new-lead alert, with
existing email-library and focused preview routes retained. Mode: Read, followed
by one useful action in the authenticated product. This is a scoped composition
redesign within the approved Blockwise world, not a new global design system.

The user rejected flat, text-only reports and asked for charts and images of ads.
The selected Quiet card shell, six-cell mark, neutral controls, data-blue chart
voice and source DESIGN.md remain authoritative. No new customer-app visual
language, page tree or sending integration is introduced.

## What changes

- Daily: an activity-led brief. Read the reporting window, see when enquiries
  arrived, connect the results to an ad creative and scan recent leads.
- Weekly: a performance-led report. Read a labelled seven-day distribution and
  prior-window context, then compare creatives with their campaign results.
- New lead: an action-led notification. Identify the enquiry and originating ad,
  then open the lead. No chart is added where there is no meaningful series.

Structure and imagery carry the improvement, not bigger pills or extra shadows.
Avoid a giant isolated number as the composition, repeated boxes, decorative
sparklines and unlabelled trend claims. Use actual quantities and text labels.

## Skill adaptations

Hallmark supplies the non-destructive structural rebuild and anti-generic review.
Impeccable supplies inherited-world discipline, a written direction and bounded
visual QA. Emil supplies careful spacing, optical alignment, legible hierarchy
and instantly available controls. None authorizes animation or scripts in email.
The existing no-external-font choice is deliberate for email speed and fallback.

Named brand tokens are compiled into literal inline styles because many email
clients do not reliably support CSS custom properties. Table-based charts keep
values readable without images, JavaScript or SVG support. Stable raster ad
previews have explicit dimensions and alternative text; their descriptive text,
results and actions remain HTML. Browser media queries adapt the reviewed layout;
received-inbox testing remains required before a sender is activated.

## Data truth and empty states

The preview uses fictional examples, not customer performance. Illustrative ad
creative must never be represented as actual attribution or a production asset.
Daily and weekly series must add to their reported totals. Campaign totals and
cost-per-lead examples must reconcile. No fabricated ROI, predicted lead quality,
statistical significance or winner label is allowed.

Quiet reporting is not missing reporting: zero-lead periods must not divide by
zero, and delayed data must not invent zero-valued series or retain stale rows.
All meaningful visual information also belongs in the plain-text companion.

## Compatibility and delivery boundary

Target 600px maximum email width, usable at 320px, with a 44px primary action.
Light and dark palettes remain part of one message, chosen locally by supporting
mail clients. Image-blocked messages must retain every critical fact and action.
Images are additional network bytes; report HTML bytes separately from assets.
No tracking pixels, remote fonts, client-side charts or extra dependencies.

This task modifies the shared email renderer, typed catalogue/examples, focused
preview and email tests; adds approved sample assets and documentation; extends
the existing export package. It deletes no production source files. Frank stores
an immutable new library version, preserving earlier ones. Settings, provider
configuration, queues and schedules remain unchanged.
