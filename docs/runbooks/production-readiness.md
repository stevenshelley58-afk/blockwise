# Blockwise Go-Live Checklist

This is the single product go-live checklist for Blockwise. Treat older
subsystem notes as implementation history, not launch approval.

Production readiness must be verified from Vercel Preview or Production URLs.
Do not use localhost or a local dev server as launch evidence.

## P0 - Must Finish Before Launch

- [ ] Vercel Preview and Production env vars are complete: `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, Supabase URL/anon/service-role keys, `TOKEN_ENCRYPTION_KEY`, Trigger keys, `META_APP_ID`, and `META_APP_SECRET`.
- [ ] Vercel deployment logs show `npm run verify-env`, `npm run check`, and `npm run build` passing from the configured `buildCommand`.
- [ ] `audit:repo` and `lint` are either added as real package scripts or removed from the release checklist.
- [ ] End-to-end tests run against a seeded Vercel Preview URL on desktop and mobile. Skipped Playwright tests do not count.
- [ ] `next.config.ts` no longer allows production builds to ignore TypeScript errors, or Vercel has an equivalent hard typecheck gate that cannot be bypassed.
- [ ] Billing is either fully implemented with Stripe checkout, portal, webhooks, and synced subscription state, or all billing/payment UI and claims are hidden until ready.
- [ ] Meta App Review is complete for the exact permissions requested by the app.
- [ ] Manual Check Required: current official Meta docs confirm the configured Graph API version, required permissions, lead-ad creative requirements, lead form requirements, and housing special-ad-category constraints.
- [ ] Meta OAuth is verified on Vercel with a real test business: connect, callback, token vault storage, ad account selection, Page selection, lead destination, privacy policy URL, currency, and timezone.
- [ ] Meta disconnect works through a server route that is compatible with RLS. Client-side writes to `provider_connections` must not be required.
- [ ] First-run navigation is linear: signup confirmation, returning login, `/home`, `/start`, `/self-serve`, onboarding, and first ad creation all send a new user to the same intended path.
- [ ] Ad Studio first-ad generation is verified from Vercel with a confirmed trial user and decrements the trial pack count correctly.
- [ ] Meta publish creates valid paused Meta campaign, ad set, lead form, creative, and ad objects from Vercel with real creative assets included.
- [ ] Publish UI distinguishes approval requested, queued, paused on Meta, active on Meta, failed, and blocked states. Do not label queued or paused objects as "live".
- [ ] Meta publish worker records failed state when execution throws after setting a plan to `publishing`.
- [ ] Human approval is verified for publish, activation, budget changes, lead export, and non-manual lead delivery.
- [ ] Provider writes remain disabled with `BLOCKWISE_ENABLE_PROVIDER_WRITES=false` until the previous Meta publish and approval checks pass on Vercel.
- [ ] Data deletion is real: workspace deletion, Meta data deletion callback, provider token deletion, lead deletion/anonymisation, audit retention, and backup retention match the public policy.
- [ ] Privacy Policy, Terms, and Data Deletion pages match implemented behavior and are reviewed for Australian use.

## P1 - Must Finish Before Real Customer Data Or Spend

- [ ] Add a field allowlist to `PATCH /api/adstudio/campaigns/[id]`; arbitrary request bodies must not be spread into campaign updates.
- [ ] Verify signup/signin production UX: terms/privacy links, password reset, email confirmation, invited-user flow, abuse protection, and clear errors.
- [ ] Make Turnstile or equivalent signup abuse protection mandatory in production, or document the Supabase-side rate-limit alternative.
- [ ] Verify Settings save paths under production RLS: account, workspace, team roles, invites, Meta setup, billing email, notification preferences, and deletion request.
- [ ] Verify Dashboard/Monitor uses live Meta data for connected accounts and clearly labelled sample data only for unconnected/demo workspaces.
- [ ] Verify valid-lead metrics come from real Blockwise lead labels, not provider-sync estimates or placeholders.
- [ ] Verify Leads page dedupe, manual review, CRM/webhook/email delivery attempts, approval creation, retry behavior, and PII export restrictions.
- [ ] Confirm ACMA compliance for any customer follow-up messaging: consent, sender identity, contact details, unsubscribe, and proof of consent.
- [ ] Confirm ACCC compliance for generated and landing-page claims: all claims are true, specific, and substantiated.
- [ ] Confirm Australian Privacy Principles obligations: collection notice, use/disclosure, overseas disclosure, security, access, correction, and deletion.
- [ ] Add CSP, HSTS, Permissions Policy, CSRF review, and route-level rate limiting for mutating public or authenticated endpoints.
- [ ] Configure recommended security env vars: `CLOUDFLARE_AI_GATEWAY_URL`, `CLOUDFLARE_AI_GATEWAY_TOKEN`, `AGENT_ALLOWED_OUTBOUND_DOMAINS`, and `SECURITY_AUDIT_LOG_DRAIN_URL`.
- [ ] Put operator/admin/workforce surfaces behind production access controls such as Cloudflare Zero Trust, SSO, and MFA.
- [ ] Verify Trigger.dev deployed tasks: Meta publish, Meta mutation, scheduled lead sync, token health, lead delivery, provider sync, and retry/failure visibility.
- [ ] Configure Sentry, analytics, audit log drain, and production alerting for route errors, failed jobs, provider failures, and security events.
- [ ] Create production operator, demo workspace, and smoke-test workspace with test Meta assets.

## P2 - Launch Polish

- [ ] Reconcile "10 campaigns", "10 ad packs", and "10 generations" wording across landing, signup, trial pill, onboarding, and Ad Studio.
- [ ] Complete mobile QA on Vercel for landing, signup, onboarding, Ad Studio, publish blockers, Dashboard, Leads, Settings, and operator approvals.
- [ ] Verify PWA install/offline behavior from Vercel or hide PWA affordances until ready.
- [ ] Remove stale launch/runbook docs that mention localhost, VPS-only deployment, or obsolete handoff steps for product go-live.
- [ ] Add a rollback runbook for Vercel deployment rollback, provider writes disablement, Trigger job pause, and Meta object cleanup.
- [ ] Add a support runbook for Meta connection failures, failed publish plans, stuck approvals, lead delivery failures, billing failures, and deletion requests.

## Final Launch Sign-Off

- [ ] Latest Vercel Preview URL is recorded.
- [ ] Production URL is recorded.
- [ ] Vercel deployment ID is recorded.
- [ ] Supabase project and migration version are recorded.
- [ ] Trigger.dev project and deployed task version are recorded.
- [ ] Meta app ID, Graph API version, approved permissions, and App Review approval date are recorded.
- [ ] `BLOCKWISE_ENABLE_PROVIDER_WRITES=true` change is approved by an operator.
- [ ] First paid/customer workspace has an assigned human owner for support and incident response.
