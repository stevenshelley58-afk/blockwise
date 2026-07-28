---
score: 20
p0: 0
p1: 4
method: dual-agent
timestamp: 2026-07-28T13-30-54Z
slug: src-components-adstudio-new-ad-dialog-tsx
---
# Ad Studio interaction critique

Method: two independent reviewers inspected the production interface, current source, and the supplied app-review recording before edits.

Score: 20/40

## Priority findings

- P1 — Listing “Fetch details” silently selected the first listing template and skipped the customer’s template choice.
- P1 — Ad Radar request failures were rendered as zero results, and save failures used a generic message with no useful recovery.
- P1 — Closing a partially completed ad discarded its listing, images, and copy without confirmation.
- P1 — The template gallery became a single column at the smallest supported viewport instead of matching Ad Radar’s two-column density.
- P2 — Brand Pack and campaign settings existed as mobile panels but had no reachable mobile navigation.
- P2 — Empty starter campaigns exposed archive and delete actions that could only fail.

## Direction applied

- Preserve the customer’s template decision after listing extraction.
- Distinguish service failure from a valid empty result and keep recovery next to the failed action.
- Protect in-progress work with the canonical confirmation primitive.
- Keep the gallery at two columns from 320px through desktop.
- Put secondary mobile destinations in the existing More menu.
- Only expose destructive campaign controls after a campaign has generated creatives and is persisted.

## Remaining structural observations

- Ad Studio still uses its legacy full-screen shell while the rest of the customer app uses the newer shell.
- The 71-template gallery is dense even at two columns; future product work should prioritize search or curated subsets without creating a second template-generation path.
