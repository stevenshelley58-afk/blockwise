# Product contract

Blockwise is a customer-facing ad-creation product for frustrated, nontechnical real-estate agents who want more leads without Ads Manager or agency complexity. Its core loop is:

Frank template pack -> customer inputs -> edit -> save/render -> review -> gated publish

Customers choose a layered template pack, upload or select brand/property assets, edit text and layout in AdStudio, save the latest revision, export Feed and Story creatives, and review a frozen publish state. Publishing remains approval- and provider-configuration-gated; a healthy app does not prove Meta access, SMTP, billing, or provider writes.

The product benefit is consistent, useful ads that support more lead opportunities; it does not guarantee linear volume or sales outcomes. The hero wording and urgency are product copy and must remain exactly unchanged. Long real-estate conversion cycles mean Blockwise must not invent ROI, appointment conversion, predicted lead quality, winner/loser labels, or an unreviewed lead failure.

## Ownership boundaries

- Frank generates and maintains template packs and their provenance.
- Blockwise stores workspace-scoped assets, edits, renders, campaign drafts, approvals, leads, and audit state.
- The VPS worker handles durable jobs only when its explicit provider-write gate is enabled; provider and lead-delivery activation remain separate, evidence-backed gates.
- Hermes is a separate research/agent runtime, not a hidden product dependency.

## Current status

The controlled public deployment is health-ready; its exact revision is recorded in the production runbook. This does not establish that provider writes, SMTP, billing, data migration, or Meta App Review are complete. Treat those as separate evidence-backed gates in the [production-readiness runbook](docs/runbooks/production-readiness.md).

## Design behavior

Keep the existing calm, exact, professional identity in `DESIGN.md`: near-black
controls, neutral surfaces, Manrope/Inter typography and a single data hue.
Make the next useful action obvious; reduce duplicate choices and terminology.
Never imply an edit, save, export or publish succeeded while it is pending,
failed or stale. Preserve inputs and offer a clear recovery path on errors.

Use ordinary language in the first-party flow; retain exact Meta or other-provider
labels only where an external screen must be followed accurately. Keep advanced
controls available as an optional path without hiding explicit budget, location,
approval, or legal details.

Support keyboard use, visible focus, labelled controls, screen-reader-readable
feedback, reduced motion, AA contrast and mobile reflow. Compact visible controls
still need usable touch targets. Do not replace these requirements with a
new visual language or a generic dashboard framework.
