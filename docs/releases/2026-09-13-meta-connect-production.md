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
assets, then return to the check/example preview. Preserve the existing
authenticated workspace boundary, confirmation gate, truthful waiting/missing
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

Until these conditions have evidence-backed resolution, do not deploy or call
Meta, and do not represent the manual UI as connected functionality.

## Verification plan when unblocked

Use an isolated controlled canary with outbound/provider writes disabled, a
valid dedicated test account and a fresh storage state. Run the existing
`e2e/meta-partner-guide-responsive.spec.ts` against `/connect-meta` and `/help`
at its five declared viewports, with storage state supplied out-of-band and
without printing cookies. Record the exact candidate SHA, canary receipt,
health/image match, and any provider-gate evidence before considering a
release. The authenticated suite must block non-GET/HEAD/OPTIONS mutations.

Pending evidence directory: `/srv/blockwise/e2e-runs/meta-connect-production-20260913`.

## Handoff boundary

No source edits, deployment, provider calls, user creation, password changes,
or production configuration changes were made by this handoff. The preview's
screenshots and UI checks do not establish Meta app review, system-user
assignment, capability checks, workspace asset correlation, lead access,
storage, or authentication readiness.
