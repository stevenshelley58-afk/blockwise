# Homepage motion and pricing mock-up

Status: preview candidate only. No approval to replace the public homepage.

## Owner direction

Preserve the existing visual identity and lead-first headline. Refine the three product demonstrations and pricing. Use the house-copy and house-website-content skills. No campaign jargon, geographic positioning, added sample badges or separate playback controls. Screen selectors at the top right choose a complete screen and stop its automatic progression. Page speed is a release concern, not a cosmetic afterthought.

## Boundaries

Worktree: `/worktrees/homepage-motion-preview-20260912`. Branch: `homepage-motion-preview-20260912`. Build only with the secret-free homepage-preview flag and the existing narrowly scoped preview router. Do not merge this candidate to main, change commercial terms, enable analytics or provider writes, or mutate customer data. The mock-up is the review artifact before production implementation.

## Browser acceptance

- Review the actual preview at desktop and 390px, with a 320px selector/reflow check.
- Hero, Choose/Customise/Review and 7 days/30 days/Email selections remain visible, keyboard-accessible and readable.
- A manual selection stays selected after a normal autoplay interval; no play/pause/replay button is rendered.
- Moving a demonstration offscreen or hiding the document suspends all its work, including typing.
- Reduced motion shows complete readable states without spatial movement.
- Reporting never renders a blank scene while switching. Pricing/FAQ information remains accessible.
- No horizontal content clipping, console errors, failed required assets or content-shifting animations.
- Measure transferred resources, lab LCP and CLS using the same browser settings before and after. Distinguish routing/cache differences and preview-disabled integrations from UI changes. Never treat these measurements as real-user field data.

## Evidence

Candidate source checks: 28 focused homepage tests pass; typecheck, package tests, NUL scan and diff whitespace check pass. The integration root suite found one unrelated infrastructure assertion after reconciling obsolete homepage expectations. The identical assertion was reproduced directly against the retained immutable live source at `6a76cc9a381e32229dc9c31cb9368ee1cde6a7e8`: `tests/oss-product-infrastructure.test.mjs:98` expects `TRUSTED_PROXY_RANGES=172.30.0.2/32` in the example environment. No infrastructure assertion or environment was weakened or changed. This is quarantined, not a claim that the full suite is green.

Pending final preview build and browser review. Baseline reported by the delivery worker: 639,042 transferred bytes across 44 entries, CLS 0, unthrottled LCP 400ms desktop and 192ms mobile. These are controlled-browser observations, not production field metrics.
