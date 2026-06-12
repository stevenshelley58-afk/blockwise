# Blockwise Production Readiness

Checked against the repo on 2026-06-12.

This is the current product go-live checklist. Older launch plans and
subsystem notes are implementation history, not launch approval.

Production readiness must be verified from Vercel Preview or Production URLs.
Do not use localhost or a local dev server as launch evidence.

## Real Verification Commands

These package scripts exist and are the release command set:

| Command | Purpose |
| --- | --- |
| `npm run check:nul` | Reject NUL-byte corruption |
| `npm run verify:hard-reset` | Research hard-reset static and contract checks |
| `npm test` | Full Node test suite |
| `npm run test:research` | Focused research-engine tests |
| `npm run typecheck` | TypeScript gate |
| `npm run build` | Next.js production build |
| `npm run verify-env` | Required env-var validation |
| `npm run trigger:deploy` | Trigger.dev task deployment |

There is no `lint` script and no `audit:repo` script. Do not reference either
as a release gate unless a later task adds real package scripts.

## Repo Gates Already Implemented

- [x] `next.config.ts` no longer uses `typescript.ignoreBuildErrors`.
- [x] GitHub CI runs `npm run verify:hard-reset`, `npm run typecheck`,
  `npm test`, and `npm run build`.
- [x] GitHub deploys Trigger.dev tasks after `main` branch checks pass through
  the `trigger-deploy` job.
- [x] `trigger.config.ts` pins the non-secret Trigger project ref and GitHub CI
  fails fast when Trigger deploy secrets are missing.
- [x] `/api/health` has public/basic and bearer-token detailed modes.
- [x] Google Ads env vars are provider-readiness fields, not top-level fatal
  env failures.
- [x] Legal pages and Meta data-deletion callback exist.
- [x] Provider writes are guarded by `BLOCKWISE_ENABLE_PROVIDER_WRITES`.
- [x] Meta publish worker records `failed` when execution throws after the plan
  enters `publishing`.
- [x] Meta publish, Meta mutation, non-manual lead delivery, and Trigger
  workers check approval/provider-write posture before external writes.
- [x] Manual export remains separate from live provider publish.
- [x] Rollback runbook exists for Vercel rollback, provider-write disablement,
  Trigger schedules/deployments, and Meta object cleanup.
- [x] Research runtime docs reflect Hermes as the active runtime owner.

## P0 - Must Finish Before Launch

- [ ] Vercel Preview and Production env vars are complete and non-placeholder:
  `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, Supabase URL/anon/service-role keys,
  `TOKEN_ENCRYPTION_KEY`, Trigger keys, `META_APP_ID`, `META_APP_SECRET`,
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, `CRON_SECRET`,
  and notification/provider keys needed for the enabled flows.
- [ ] Vercel deployment logs show the configured build command runs the real
  release gates: `npm run verify-env`, `npm run typecheck`, `npm test`, and
  `npm run build`, or an equivalent `npm run check && npm run build`.
- [ ] `npm run verify-env` is run against Production env vars. Preview may warn
  on incomplete env; Production must fail on missing required env.
- [ ] Latest Vercel Preview URL is recorded and tested on desktop and mobile.
- [ ] End-to-end tests run against a seeded Vercel Preview URL. Skipped
  Playwright tests do not count as launch evidence.
- [ ] Stripe is either fully implemented and verified with checkout, portal,
  webhooks, and synced subscription state, or billing/payment UI and paid
  claims stay hidden behind the current fallback messaging.
- [ ] Meta App Review is approved for the exact permissions requested by the
  app.
- [ ] Current official Meta docs are checked for Graph API version, required
  permissions, lead-ad creative requirements, lead form requirements, and
  housing special-ad-category constraints.
- [ ] Meta OAuth is verified on Vercel with a real test business: connect,
  callback, encrypted token storage, ad account selection, Page selection, lead
  destination, privacy policy URL, currency, and timezone.
- [ ] Meta disconnect is verified on Vercel through the server route; client
  writes to `provider_connections` are not required.
- [ ] First-run navigation is verified on Vercel: signup confirmation,
  returning login, `/home`, `/self-serve`, onboarding, and first ad creation
  send a new user to the intended path without dead-end hops.
- [ ] Ad Studio first-ad generation is verified from Vercel with a confirmed
  trial user and decrements the trial pack count correctly.
- [ ] Meta publish is verified from Vercel with real creative assets and creates
  valid paused Meta campaign, ad set, lead form, creative, and ad objects.
- [ ] Publish UI is verified to distinguish approval requested, queued,
  publishing, paused on Meta, failed, and blocked states. Queued or paused
  objects must not be labelled live.
- [ ] Human approval is verified for publish, activation, budget changes, lead
  export, and non-manual lead delivery.
- [ ] `BLOCKWISE_ENABLE_PROVIDER_WRITES=false` remains set in Vercel and
  Trigger.dev until Meta publish and approval checks pass on Vercel.
- [ ] Data deletion is verified end to end: workspace deletion, Meta
  data-deletion callback, provider token deletion, lead deletion/anonymisation,
  audit retention, and backup retention match the public policy.
- [ ] Privacy Policy, Terms, and Data Deletion pages match implemented behavior
  and are reviewed for Australian use.

## P1 - Must Finish Before Real Customer Data Or Spend

- [ ] Verify signup/signin production UX: terms/privacy links, password reset,
  email confirmation, invited-user flow, abuse protection, and clear errors.
- [ ] Make Turnstile or equivalent signup abuse protection mandatory in
  production, or document the Supabase-side rate-limit alternative.
- [ ] Verify Settings save paths under production RLS: account, workspace, team
  roles, invites, Meta setup, billing email, notification preferences, and
  deletion request.
- [ ] Verify Dashboard/Monitor uses live Meta data for connected accounts and
  clearly labelled sample data only for unconnected/demo workspaces.
- [ ] Verify valid-lead metrics come from real Blockwise lead labels, not
  provider-sync estimates or placeholders.
- [ ] Verify Leads page dedupe, manual review, CRM/webhook/email delivery
  attempts, approval creation, retry behavior, and PII export restrictions.
- [ ] Confirm ACMA compliance for customer follow-up messaging: consent, sender
  identity, contact details, unsubscribe, and proof of consent.
- [ ] Confirm ACCC compliance for generated and landing-page claims: all claims
  are true, specific, and substantiated.
- [ ] Confirm Australian Privacy Principles obligations: collection notice,
  use/disclosure, overseas disclosure, security, access, correction, and
  deletion.
- [ ] Configure and validate CSP, HSTS, Permissions Policy, CSRF review, and
  route-level rate limiting for mutating public or authenticated endpoints.
- [ ] Configure recommended security env vars:
  `CLOUDFLARE_AI_GATEWAY_URL`, `CLOUDFLARE_AI_GATEWAY_TOKEN`,
  `AGENT_ALLOWED_OUTBOUND_DOMAINS`, and `SECURITY_AUDIT_LOG_DRAIN_URL` where
  supported.
- [ ] Put operator/admin/workforce surfaces behind production access controls
  such as Cloudflare Zero Trust, SSO, and MFA.
- [ ] Verify Trigger.dev deployed tasks in the dashboard: Meta publish, Meta
  mutation, scheduled lead sync, token health, lead delivery, provider sync,
  and retry/failure visibility.
- [ ] Verify the paid-service watchdog as the Vercel Cron configured in
  `vercel.json` for `/api/alerts/paid-service-watchdog`.
- [ ] Configure Sentry, analytics, audit log drain, and production alerting for
  route errors, failed jobs, provider failures, and security events.
- [ ] Create production operator, demo workspace, and smoke-test workspace with
  test Meta assets.

## P2 - Launch Polish

- [ ] Reconcile trial wording across landing, signup, trial pill, onboarding,
  and Ad Studio. Current target phrase is "10 free ad packs".
- [ ] Complete mobile QA on Vercel for landing, signup, onboarding, Ad Studio,
  publish blockers, Dashboard, Leads, Settings, and operator approvals.
- [ ] Verify PWA install/offline behavior from Vercel or hide PWA affordances
  until ready.
- [ ] Remove or supersede stale launch/runbook docs that mention localhost as
  acceptance evidence, VPS-only product deployment, or obsolete handoff steps
  for product go-live.
- [ ] Add a support runbook for Meta connection failures, failed publish plans,
  stuck approvals, lead delivery failures, billing failures, and deletion
  requests.

## Final Launch Sign-Off

- [ ] Latest Vercel Preview URL is recorded.
- [ ] Production URL is recorded.
- [ ] Vercel deployment ID is recorded.
- [ ] Supabase project and migration version are recorded.
- [ ] Trigger.dev project and deployed task version are recorded.
- [ ] Meta app ID, Graph API version, approved permissions, and App Review
  approval date are recorded.
- [ ] `BLOCKWISE_ENABLE_PROVIDER_WRITES=true` change is approved by an operator
  after the Vercel publish checks pass.
- [ ] First paid/customer workspace has an assigned human owner for support and
  incident response.

## Definition Of Live

Blockwise is live only when the P0 list is complete, the final sign-off fields
are recorded, and provider writes are deliberately enabled in both Vercel and
Trigger.dev after approval-gated Meta publish checks pass.
