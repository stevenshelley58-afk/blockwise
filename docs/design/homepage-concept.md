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
