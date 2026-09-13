# Meta Connect production-readiness handoff, 13 September 2026

## Decision

**NOT DEPLOYED. NO CANARY ACCEPTANCE.** The approved four-panel Meta sharing
preview is a candidate for the real `/connect-meta` manual request flow only.
This handoff does not authorize a fake connection, provider mutation, app
activation, or production release. Production remains revision
`367e77855c8b654c5d2cbafd31eb69842c6b140a`.

## Intended port

Port the four numbered panels and per-panel expanders into the real customer
manual flow: Partners; Give access plus Business ID; permissions; Assign
assets, then return to the real manual-request status. Preserve the existing
authenticated workspace boundary, one-tap confirmation, truthful waiting/missing
states, read-only provider-owned values, and no typed asset IDs. This is a
manual request flow, not evidence of a live Meta connection.

## Blocking no-go conditions

- Partner feature flag is off.
- System-user token is absent.
- `META_APP_SECRET` is absent.
- Platform vault has no Meta lane.
- No later external Meta proof is available.
- Current Meta app mode, tier and permissions are unknown.
- Authenticated QA cannot proceed: the saved state is expired and the
  existing dedicated test credentials were rejected. Do not reset the password
  or create a user to bypass this blocker.

The authentication blocker prevents release acceptance for the manual UI.
The Meta prerequisites separately block automated connection and provider
writes. They do not prevent shipping an honestly labelled manual flow after
its normal release checks pass. Never represent the manual UI as an API
connection.

## Verification plan when unblocked

Use an isolated controlled canary with outbound/provider writes disabled, a
valid dedicated test account and a fresh storage state. Run the existing
`e2e/meta-partner-guide-responsive.spec.ts` against `/connect-meta` and `/help`
with the four-panel tests at desktop, 390px and 320px and retained Help tests
at five viewports, with storage state supplied out-of-band and
without printing cookies. Record the exact candidate SHA, canary receipt,
health/image match, and any provider-gate evidence before considering a
release. The authenticated suite must block non-GET/HEAD/OPTIONS mutations.

Pending evidence directory: `/srv/blockwise/e2e-runs/meta-connect-production-20260913`.

## Handoff boundary

The candidate contains UI changes and a workspace-isolation fix for manual
request idempotency. No deployment, provider calls, user creation, password
changes or production configuration changes were made. The preview's
screenshots and UI checks do not establish Meta app review, system-user
assignment, capability checks, workspace asset correlation, lead access,
storage, or authentication readiness.

## Candidate checks observed on 13 September

- `npm run check:nul`: passed, 1,420 text files.
- Full `npm test`: 1,342 passed, zero failed, two existing package tests skipped
  (1,066 root; 248 contract; 11 renderer; 17 layout).
- `npm run build`: passed. This is a source build, not an immutable release
  image, canary acceptance or proof of a live integration.
- TypeScript check: passed after correcting an intermediate file-transfer
  encoding error; the failed intermediate log is retained.
- Manual request isolation tests: 10/10 passed, including cross-workspace
  duplicate insertion and retry input mismatch.
- Updated browser suite discovers 10 tests. These have NOT passed against
  the candidate: authenticated execution is blocked by the test-login failure.
- No release acceptance receipt was created and nothing was pushed to main.

Use the branch `codex/meta-connect-production-20260913` as the resumable
candidate. Do not merge the old preview branch or its synthetic state controls.
