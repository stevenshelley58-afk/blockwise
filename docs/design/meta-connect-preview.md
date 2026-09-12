# Meta connection preview surface brief

## Scope

This scoped record covers the shipped `/meta-connect-preview` concept. It does
not replace the binding root `DESIGN.md`. The surface extends the existing
Blockwise language: neutral surfaces, near-black ink actions, Manrope display
headings, Inter body/UI text, shared shadcn controls and incumbent radii.

## Composition

- Three-step task flow beside a result/check panel on desktop, one column on narrow screens.
- Step one opens external Meta Business Settings; step two exposes the public Business ID with copy; step three names minimum Page/ad-account access, with Instagram and pixel optional.
- Result states are Not checked, Checking, Missing access, Waiting and Connected. Connected shows fictional Harbour & Home assets and a local-only Continue transition.

## Durable surface rules

- Keep provider terminology exact where the user follows Meta's external screen; keep surrounding instruction plain and concise.
- Make one next action explicit per state. Keep waiting, missing and connected truthful.
- Preserve labelled controls, live status feedback, visible focus, reachable 44px-class targets and reduced-motion-safe feedback.
- Keep the preview visibly synthetic. It has no Meta API, provider write, storage, auth or analytics.

## Boundary

The public route is no-index/no-store and isolated from production. It uses only the existing brand SVG and no route-local token system. Future real integration must separately verify workspace asset correlation, capability checks, system-user assignment, lead access and the Meta app gate.

See `docs/releases/2026-09-12-meta-connect-preview.md` for immutable release evidence.

## Revision 2

The refined surface uses four numbered panels with responsive 4/2/1-column
behavior, shorter copy, and a scoped data-blue treatment for CTA, numbers and
icons. The full Meta walkthrough is closed below the panels and uses the four
actual Meta screenshots from `META_PARTNER_STEPS`, each captioned for Manage
campaigns and View performance while leaving Full control off. `Copy`/`Copied`
feedback is announced live; the Business ID row wraps at 320px. The preview
state selector remains below the walkthrough and simulation behavior is retained.

Interim instructional screenshots are privacy-redacted Sellforte crops, used
temporarily and tracked by `evidence/meta-partner-screenshots/manifest.json`;
replace them at the next Meta proof pass.
