# Customer UX swarm lane 3 — draft evidence (8 September 2026)

> **DRAFT — NOT DEPLOYED.** This record describes the lane-3 customer UX work
> prepared from baseline 674b512139961927191f3659a64737a2e0db1cdd. It is not
> a release approval or proof of the current production revision.

## Intended improvements

- Use one consistent customer shell and naming model: Ads and Results, with
  shared desktop/mobile navigation and existing monitor restrictions preserved.
- Give Results a truthful disconnected state with a primary Connect Meta action
  and an explicitly opt-in example report; connected Results use compact primary
  KPIs, a switchable chart, prioritized attention/results rows, and deliberate
  reporting/detail and campaign-management drilldowns.
- Keep Leads connection-aware without introducing CRM functionality.
- Make Settings a focused category index with deep links, browser back behavior,
  and focus restoration; keep Team, Notifications, Billing, Security, and
  deletion safeguards scoped and truthful.
- Keep Meta connection guidance reassuring and provider-specific, with optional
  help imagery collapsed by default and direct-versus-assisted status stated
  honestly.

## Safety boundaries

- No public homepage redesign and no backend access, pricing, credits, billing
  data, provider gates, or deletion safeguards were changed.
- Existing palette, fonts, shadcn patterns, navigation restrictions, and focused
  editor behavior remain the design baseline.
- Browser acceptance uses the controlled authenticated fixture and blocks
  non-read-only requests; it must not perform real saves, invites, connects, or
  deletion requests.

## Evidence recorded for this draft

- Focused Node test set: **37 passed** (shell routing, settings/mobile shell,
  publish lifecycle, Leads, monitor/reporting, Meta guide, and reporting
  honesty).
- npx tsc --noEmit --incremental false --pretty false: **passed**.
- git diff --check: **passed**.
- Prepared browser acceptance: e2e/customer-ux-flows.spec.ts, 8 tests listed
  across Chromium and mobile projects. The controlled canary URL was not
  running, so no live browser result is claimed.

Evidence and run artifacts are associated with
/srv/blockwise/e2e-runs/ux-swarm-20260908/ (including the approved review and
test log). Parent release work will record the final candidate revision and
results separately.

## Pending release gates

- Parent-owned full test gates and integrated build.
- Authenticated controlled-canary browser QA, including responsive Results,
  Settings focus/back, Leads, and Meta guidance flows.
- Production verification, deployment, and post-deploy checks.

Until those gates are complete, this lane remains a draft and **not deployed**.
