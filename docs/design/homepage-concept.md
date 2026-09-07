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

## Results reporting — smooth shared reveal

Use the headline “Know how your ads are going.” with “Your personal dashboard. Emails as often as you like. Even never. We get it.”

The chart uses smooth bounded cubic curves through the fixture points. One shared SVG clip reveals the line and fill together from left to right over 1.5 seconds whenever the chart enters the viewport or the reporting period changes. It resets immediately after leaving the viewport so the next entry redraws cleanly. This owner-requested marketing sequence is a deliberate exception to routine app entrance timing, using the shared reportingReveal token. Keyboard switches replay the reveal; reduced-motion paths stay immediate.

No email-frequency strip, scheduler controls, or floating email card. The email benefit lives only in the copy. Example data stays visibly labelled; no services are connected.

## Consolidated direction, 7 September

The complete preview is based on `e69e4d78`, including the `bac4d137` reporting
replay update. It consolidates recent decisions rather than reverting to an
older whole-page iteration:

- Hero: retain the exact competition headline and approved tagline, clean
  eight-placement Meta ad deck, automatic cycling, and no playback control or
  trial-button arrow (`bb566f85`, `0923b4c1`).
- Examples: retain four objective choices. Bring the separate process preview's
  obvious selection-and-text-replacement animation into this existing section,
  using a different property image. Do not restore the superseded standalone
  workflow explainer or its approval simulation (`b88ba2d7`, `118f6707`).
- Reporting: preserve the smooth line/fill reveal, replay on viewport entry and
  range changes, 1.5-second timing, full weekday labels, responsive month labels,
  and requested dashboard/email sentence (`d5d2039f`, `70a61899`, `bac4d137`).
- FAQ: preserve setup help first, approval control, separate Meta spend,
  customer account/data ownership and free self-management after the trial.
  Remove the redundant FAQ introduction, not the answers.
- Remove the old example explanation panel, duplicate control accordion and
  repeated trial feature copy. Link to current pricing and guides rather than
  copying independently maintained pages into this preview.
- Keep the email form and its validation/loading/success states explicitly
  mock-only. Nothing is saved, sent or connected to live services.

Page order: hero, editable ad examples, results, FAQ, email form, footer.
Existing Next.js, Motion and shared design tokens are reused. No additional
library or live integration is needed. New code is limited to adapting the
existing isolated animation to the retained examples surface.
