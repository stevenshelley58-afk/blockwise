# Homepage value walkthrough — 7 September 2026

## Released scope

- Public preview: https://blockwise.sale/homepage-preview/concept#results
- Compiled application revision: `bb1cdf2d8e844b7949a6eada2b2df439b9e27675`.
- Image/container: `blockwise-homepage-preview:bb1cdf2d8e84` / `blockwise-homepage-preview-bb1cdf2d8e84`.
- Source: `/projects/blockwise-homepage-value-20260907`, branch `codex/homepage-value-redesign-20260907`.
- Replaces only the old results/reporting section with a benefit-led, interactive create → approve → enquiries walkthrough. Reuses existing creative assets, brand typography, neutral surfaces and blue accents; adds no dependency.
- Integrated the concurrently released hero/process revision `8658e40c449751e32c967c08d2257ff9046ade83` and documentation `5552bd8d`. All six surrounding sections were compared against that deployed version and are unchanged.
- No production homepage, database, authentication, billing, email, or provider-write changes. Production readiness and compiled provenance remain verified at `6ee635b3416ee694badc3d5b8f2ea99a9981be13`.

## Product and interaction boundaries

The reusable component is `src/components/homepage-concept/results-walkthrough.tsx`. Static steps, budget parameters and example enquiries live in `src/lib/homepage-concept/walkthrough.ts`; existing creative fixtures remain in `content.ts`. All data is visibly illustrative. Creative choices, budget adjustment and example approval are client-only; changing a budget or creative invalidates example approval. Planned spend is not labelled a guaranteed maximum. No real ad can publish or spend.

Emil Kowalski's [design-engineering guidance](https://github.com/emilkowalski/skills) informed finite, fast, user-triggered transitions; Impeccable informed hierarchy, content-first layout and responsive review. The initial server-rendered walkthrough is visible without waiting for animation/hydration. Keyboard and reduced-motion changes are immediate. No autoplay was added to this section.

## Verification

- `npm run check:nul`: passed.
- Full integrated suite: 934 tests, 933 passed, zero failures, one existing root-permissions skip.
- `npm run typecheck`: passed. Final Next production build also completed TypeScript verification.
- Final focused concept/walkthrough tests: 5/5 passed, including SSR visibility and the no-live-service boundary.
- Production preview build and image build passed; compiled HTML and public metadata match the exact application revision above.
- HTTPS GET 200 with noindex; preview POST 405; preview product API GET 404.
- All three walkthrough states checked at actual CSS widths 320, 390, 767, 1440 and 2560: no off-screen elements. Final desktop, wide-desktop and phone renderings were visually inspected. These are responsive Chromium checks, not physical-device certification.
- Creative switching updates the message and artwork. Budget changes recalculate planned spend ($35/day × 14 days = $490), approval records an example-only state, and further changes reset approval. Arrow/Home keyboard navigation, focus, reduced motion and trial anchor verified.
- Browser network observation across load and interactions: 80 GET requests, zero non-GET, zero application API or external HTTPS requests; no application console errors. Unrelated browser-extension warnings are not app errors.
- New muted metadata contrast measured at 5.01:1 on white and 4.63:1 on the light vignette surface; body text 6.41:1.
- Impeccable detector ran once: 55 advisory token/ramp differences against the customer-app design document, no non-advisory findings. This marketing section inherits the established concept surface rather than rewriting the global customer design system.
- Bounded review corrected cramped desktop type/columns and the initial animation-hidden state. No routine reviewer-agent gate was added.

## Deployment and rollback

The secret-free, non-root preview container retains the existing read-only filesystem, 1 GB memory limit, dropped capabilities, no-new-privileges, internal-only network and no host port. The preview-only route update backed up current router configuration and preserved production routes. Source and public revision checks guarded against overwriting a newer concurrent release.

To reapply this revision after a product-router restart:

```sh
python3 scripts/vps/homepage-preview-route.py --upstream blockwise-homepage-preview-bb1cdf2d8e84:3000 --apply
```

Previous preview `blockwise-homepage-preview-8658e40c4497` remains available for rollback; start its container if needed, then use the same route script with that upstream. Do not restore a whole saved router configuration over other changes. Later homepage work must retain this results-section revision when it replaces the preview.
