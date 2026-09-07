# Homepage concept — 6 September 2026

## Approved direction

Keep Blockwise's existing near-black, white, light-neutral and blue palette and Manrope/Inter typography. No eyebrows. Explain the core ads application within the first few phone screens with clear trial actions; retain useful detail lower on the page. Remove Property Check from this concept. Use very concise copy, legible ad imagery and visual workflow explanations. Say "Start free trial" and "No card required", never promote a numbered free-ad allowance.

The owner requested mobile and desktop mockups and an email capture form. This is not approval to replace the live homepage or activate lead collection.

## Implementation boundary

- Real existing Next.js frontend, isolated `/concept` route, reusable components and typed mock fixtures.
- `BLOCKWISE_HOMEPAGE_PREVIEW=true` builds under `/homepage-preview`. The compiled flag disables analytics, consent UI and service-worker registration; middleware bypasses auth and refuses other application endpoints.
- Forms validate and demonstrate pending/success states without storing email, sending mail, authenticating or contacting production services.
- Existing public creative assets are reused; no extra dependencies or a second framework. Small preview configuration is needed to run this real frontend beside the production app without sharing its integrations.
- Root homepage and normal production behavior remain unchanged when the preview flag is absent.

## Preview hosting

Production-built, secret-free, read-only container on a separate internal Docker network. The product router receives only a narrowly matched `/homepage-preview*` route, strips credentials, accepts GET/HEAD only and adds no-index headers. No production app, database, authentication, billing, Meta or shared Frank edge deployment is replaced.

`python3 scripts/vps/homepage-preview-route.py` validates the route update. `--apply` loads it after checking current router state and saving a backup. `--upstream blockwise-homepage-preview-<revision>:3000 --apply` switches the preview atomically to a validated container. `--remove --apply` removes only this preview route while preserving other current routes. The mounted production Caddyfile is untouched; after a product-router restart/reload, reapply the preview route if still needed. Never restore an old full router configuration over concurrent work.

## Verification

See the release evidence record for compiled revision, required checks, browser measurements, form behavior and public preview acceptance.

## Results reporting — corrected owner brief

Persuade agents that they can know how their ads are going without guessing or waiting for agency updates. The rest of the homepage already explains ad creation; this section must not repeat that workflow.

A full-width dark section pairs a legible personal dashboard with a scheduled email preview. Leads, spend and cost per lead answer the visitor's practical questions. The 7/30-day dashboard switch updates consistent synthetic chart and campaign data. Daily, weekly and custom 1–30-day email controls visibly change the illustrative summary and schedule. Both benefits are visible without interaction; no carousel, stage gate or continuous animation hides the message.

Reuse incumbent Manrope/Inter, near-black/white and blue, installed Motion and Lucide. Small authored chart markup is appropriate for this labelled, fixed demonstration, avoiding additional chart machinery. Pointer changes use finite ease-out chart/email transitions; keyboard and reduced-motion changes are immediate. Mobile stacks dashboard then email with 44px controls. All data is explicitly synthetic and nothing sends or saves.

Product boundary: current customer settings expose a weekly-digest toggle, not a general configurable reporting scheduler. The owner's requested flexible cadence is demonstrated here as a concept only, not activated or claimed as shipped scheduling. Production email scheduling must be implemented and verified separately before this concept replaces the public homepage.
