# Homepage motion and pricing mock-up

Status: working mock-up published for owner review. No approval to replace the public homepage.

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

Baseline reported by the delivery worker: 639,042 transferred bytes across 44 entries, CLS 0, unthrottled LCP 400ms desktop and 192ms mobile. These are controlled-browser observations, not production field metrics.

## Published preview

URL: https://blockwise.sale/homepage-preview/concept

Compiled UI revision: `23a03de88751e827699dc7d3a545f08efca6fb2e`. This document may be committed later than the deployed UI. The live homepage has not been replaced.

Parent browser review covered desktop hero and pricing, mobile workflow selection, email selection, 30-day report and pricing at 390px and 320px. Browser review caught and resolved hidden hero selectors, a report observer starting before the card was visible, the email appearing after its companion image on phones, and a monthly total overflowing its column. The final monthly metrics have no internal overflow at either narrow width. Screen selections held their chosen state. No errors were logged in the parent review browser.

The earlier homepage concept documents are historical. For this candidate, the latest owner direction above supersedes earlier requests for visible example badges or playback controls.

## Final browser and speed evidence

Evidence directory: `/srv/blockwise/e2e-runs/homepage-motion-preview-20260912`. Final browser artifact: `qa-final-23a03de.json`, with screenshots, page text and build/route logs. Fresh reduced-motion loading initially exposed a hydration mismatch. The final revision uses a hydration-stable preference and the fresh reduced-motion rerun has zero errors and zero running animations.

Controlled mobile comparison with cache disabled, 150ms latency, 1.6Mbps download, 750Kbps upload and 4x CPU slowdown:

| Observation | Baseline live | Final preview |
| --- | --- | --- |
| Largest visible content (LCP) | 1,628ms | 1,544ms |
| Transferred resources | about 586.6KB | 464,831 bytes |
| Layout shift (CLS) | 0 | 0 |

This is about 21% less transferred data in these runs. The small timing difference is not a statistically established speed improvement. Preview routing, cache behavior and disabled integrations differ from live. These are laboratory observations, not real-user field metrics or a Lighthouse score. The final normal desktop run observed LCP 912ms; normal 390px observed 904ms and 320px 448ms. An earlier desktop cold-start observation was slower (4,096ms), so no universal sub-second loading claim is made.

The final separate six-second throttled image trace had no failed requests and all visible hero images completed. An earlier one-off image request failure did not reproduce; its cause was not established.

Final checks cover selectors, mobile reflow, complete report values, no visible playback controls, no forbidden marketing wording, and offscreen report suspension. Design detector: two intentional Arial warnings inside the Meta-style ad frames, zero actionable findings. Production health remained on revision `6a76cc9a381e32229dc9c31cb9368ee1cde6a7e8`; the preview is read-only with no-index/no-store, blocked POST requests, and stripped credentials.

## Retained preview lifecycle

Active container: `blockwise-homepage-preview-23a03de88751e827699dc7d3a545f08efca6fb2e`; image: `blockwise-homepage-preview:23a03de88751e`. The delivery lane removed only its superseded preview containers. Other workers' retained previews were untouched.

Final boundary evidence is `security-final-23a03de.txt`. The scoped route currently depends on the product router's preview-network attachment and host mapping; a router recreation requires restoring that attachment/mapping and reapplying the scoped route. No router restart was performed.

To retire this preview, first remove only the preview route with `python3 scripts/vps/homepage-preview-route.py --remove --apply` from this worktree. Then remove only the container named above; its image can also be removed if no longer required. Do not restore a stale whole-router configuration or remove other workers' previews.

## Owner-directed workflow refinement

The owner confirmed the three steps are right but rejected the current proportions. The browser confirmed their displayed version was `23a03de88751e827699dc7d3a545f08efca6fb2e`, not an old preview. Its workflow heading measured 48px/800 while the shared section scale was 58px/760. The report uses a separate larger treatment and is outside this refinement.

This follow-up changes only the workflow section: heading scale, frame proportions, toolbar spacing, ad continuity and compact review details. Other homepage sections remain frozen. Browser acceptance covers Choose, Customise and Review at desktop and phone widths, manual selection retention, reduced-motion loading, and no new required image failures.
