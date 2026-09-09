# Homepage reporting email selector: 8 September 2026

## Objective

The homepage reporting concept now presents one selector with three views:

- `7 days`: the short reporting window.
- `30 days`: the longer reporting window.
- `Email`: the matching sanitized reporting-email preview.

The email state makes the chart-to-inbox transition legible while keeping the
reporting interaction small and product-shaped.

## Sample provenance

The sample copy and metric order come from the earlier homepage reporting
implementation at commit `62dfd2ba2`:

- Source fixture: `/projects/blockwise-homepage-chat-reconciled-20260907/src/lib/homepage-concept/reporting.ts`
- Historical email rendering: `/projects/blockwise-homepage-chat-reconciled-20260907/src/components/homepage-concept/results-reporting.tsx`
- Historical sample subject: `Your week in ads`
- Historical intro: `Here’s how your ads are going.`
- Historical period and metrics: `Last 7 days`, `New leads`, `Ad spend`, `Cost per lead`
- Historical closing: `The numbers you need. No follow-up email required.`

The reusable fixture is `/projects/blockwise-homepage-chat-reconciled-20260907/src/lib/homepage-concept/reporting-email.ts`.
Its footer link is a sanitized adaptation required by the fixture shape and is
not claimed as historical sample copy.

## Boundaries and copy constraints

This remains a mock-only homepage concept. The email state uses public synthetic
values and does not fetch, save, address, deliver, integrate with providers, or
send messages. No private inbox content or personal recipients are represented.

The existing no-em-dash rule for user-facing frontend copy is preserved. The
`Example data · AUD` disclosure removed by the preceding reporting conversion
work remains removed from the concept.

## Release evidence

- Compiled revision: `ac31fbea9058a837282993efd93ada6c53da0803`
- Preview container: `blockwise-homepage-preview-ac31fbea9058`
- Preview image: `blockwise-homepage-preview:ac31fbea9058`
- Immediate pre-task rollback retained: `969f80e19fc69c96b07324c08eb83de7400bc62e`
- Candidate and public HTML matched byte-for-byte with all seven homepage sections.
- Non-preview Caddy configuration was identical before and after the switch.

Repository and preview checks passed: `npm run check:nul`, `npm run test`,
`npm run typecheck`, preview build, and `git diff --check`.

Browser evidence at 1440, 390, and 320 CSS pixels found no overflow and 44px
interactive targets. The final layout retained a 451px chart height, metrics
margin of `19px 0 18px`, and email bottom spacing of `24px`. Browser errors were
empty. Reduced-motion loading verified zero transforms and the instant toggle.
Dynamic operating-system setting changes were not verified.

Functional checks confirmed `7 days` at 18 leads and `$324`, `30 days` at 62
leads and `$1,116`, and `Email` using the original sample at 18 leads and
`$324`. The `View report` button returns to `7 days`; the hidden email state is
inert.

The final 650ms, 41-frame sample had no blank frames, 14 crossfade frames, and
constant 451px height. The 30-day value of 62 remained visible during the
transition. A rapid-switch sample covering 66 frames was also stable with no
blank frames.

Evidence is retained under `/projects/blockwise-homepage-chat-reconciled-20260907/work/reporting-email/`.

## Remaining acceptance ownership

Parent-owned POST 405, API 404, and product-gate acceptance are not restated as
completed here. No additional verification or deployment claim is made beyond

## Final operational acceptance

- Preview POST 405 and preview API 404 verified.
- Current product health gate passed at `674b512139961927191f3659a64737a2e0db1cdd`, unchanged by this preview task.
- Intermediate preview container/image `d4ccc7a88f41` retired after verifying no active route or other container use. Live `ac31fbea9058` and rollback `969f80e19fc6` remain protected.
- Regenerable `.next`, `node_modules` and both template-package `dist` directories removed after active-consumer checks. Source and all release evidence retained.
