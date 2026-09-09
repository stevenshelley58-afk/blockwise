# Homepage pricing cards, 8 September 2026

Historical preview release `3c5ac511636a3639edaad600ade08067f8f13c6d` adds the three current pricing-page plans directly above FAQ. The combined revision also retains the concurrent campaign-controls update. The earlier intermediate build was not published because its revision preceded that component's commit.

Prices, features, terms and destinations are sourced from the public pricing page and its serving revision `674b512139961927191f3659a64737a2e0db1cdd`. The isolated content module is `src/lib/homepage-concept/pricing.ts`; the homepage presentation is `src/components/homepage-concept/homepage-pricing.tsx`. The production pricing page itself is unchanged. Links navigate to existing signup, managed-call and plan-detail destinations; no backend writes or analytics were added.

## Design and verification

Hallmark component guidance preserves the Manrope/Inter typography and existing neutral tokens. Impeccable refinement principles govern hierarchy, spacing and a bounded visual pass. Its context helper was unavailable on the VPS, so the existing DESIGN.md, CSS and incumbent components were inspected manually. Emil's guidance is applied through restrained, interruptible pointer feedback and reduced-motion support. No new design system or decorative entrance animation was introduced.

| Before | After | Why |
| --- | --- | --- |
| Pricing available only on a separate page | Three plans directly before FAQ | Compare plans without leaving the homepage |
| Separate-page styling | Existing homepage tokens, aligned prices and actions | Keep the page visually coherent |
| Equal visual emphasis | Dark self-serve card | Distinguish the existing featured plan without adding a popularity claim |

NUL check, typecheck, full tests and production build passed from an isolated committed checkout. Tests: 945 passed, one existing root-permissions skip, zero failed. Public HTML matched the candidate, including its compiled revision. Caddy configuration comparison confirmed only the preview route changed; product health passed.

Browser: desktop 1440px and mobile 375px visually inspected. At 320, 375, 414 and 768px all cards fit, buttons had at least 44px targets and no horizontal overflow was observed. Prices and CTA destinations matched the source. Pricing's next section is FAQ. No console errors. Temporary viewport overrides were cleared.

## Retention

- Live container/image: `blockwise-homepage-preview-3c5ac511636a` / `blockwise-homepage-preview:3c5ac511636a`.
- Immediate protected rollback: `blockwise-homepage-preview-bc3237a6db4b` and its image.
- Source: `/projects/blockwise-homepage-chat-reconciled-20260907`.
- Exact build source/evidence: `/projects/blockwise-gallery-build-20260908`, `work/homepage-pricing/`.
- Unpublished intermediate `4ae94b4d78be` retired. Exact-build dependencies and generated outputs retired after consumer check. Source, evidence and protected releases retained.
