# Progressive onboarding rollout (historical managed runtime)

> HISTORICAL ONLY: This rollout document assumes Vercel Preview/Production and
> managed Supabase. It is not a current product deployment or go-live runbook.
> Use `docs/runbooks/production-readiness.md` and
> `docs/runbooks/oss-product-migration.md` for the self-hosted VPS target.

This runbook controls the progressive email-only activation, regional
self-serve offer, assisted Meta launch, managed service, and public-copy
release. Runtime acceptance is performed on Vercel Preview or Production URLs,
never on localhost.

The offer contract is fixed:

- three complete Feed and Story ads before payment;
- one free live-campaign setup after Meta connection and card collection;
- US$99 or A$99 when the first campaign launches or seven days after Checkout,
  whichever comes first;
- US$499 or A$499 monthly thereafter until cancelled;
- Meta ad spend paid separately by the customer;
- 100 monthly render credits, one workspace, one Brand Pack, one Meta Business
  Portfolio, one primary ad account, and five named verified members;
- managed service from US$1,500 or A$2,500 monthly plus ad spend, with the scope
  in the Terms of Service.

Do not publish the offer while entitlements, test billing, legal copy, and the
country-specific Checkout path disagree.

## Server-only rollout flags

Configure these in Vercel Preview and Production. They must not use a
`NEXT_PUBLIC_` prefix.

| Variable | Safe default | Contract |
| --- | --- | --- |
| `BLOCKWISE_PROGRESSIVE_FOUNDATIONS_ENABLED` | `false` | Enables the migrated activation, credit, billing, claim, booking, seat, and analytics foundations for internal verification. |
| `BLOCKWISE_PROGRESSIVE_ACTIVATION_ENABLED` | `false` | Enables email-only activation, verified workspace bootstrap, Brand Pack handoff, three free ads, and server-resolved resume state. Requires foundations. |
| `BLOCKWISE_PROGRESSIVE_BILLING_ENABLED` | `false` | Enables regional Checkout, seven-day conversion, free-live claim, invoice entitlements, cancellation, and managed Checkout. Requires activation. |
| `BLOCKWISE_PROGRESSIVE_PUBLIC_LAUNCH_ENABLED` | `false` | Enables public calls to action, pricing, FAQs, and launch copy. Requires billing and all preview gates. |
| `BLOCKWISE_PROGRESSIVE_MARKETS` | empty | Comma-separated allowlist containing `AU`, `US`, or both. Empty exposes no market. |
| `BLOCKWISE_PROGRESSIVE_EXPOSURE_PERCENT` | `0` | Integer from `0` to `100`, assigned deterministically by workspace (or verified user before workspace creation), never randomly on each request. |

An enabled later phase never overrides a disabled prerequisite. Invalid market
or percentage values fail closed. `BLOCKWISE_ENABLE_PROVIDER_WRITES` remains a
separate Meta mutation kill switch and stays `false` until the Meta preview
checks pass.

## Migration order

Apply and record these migrations in timestamp order:

1. `202607270002_progressive_activation_credit_ledger.sql`
2. `20260727022000_progressive_billing_foundation.sql`
3. `20260727023000_meta_free_live_claim_registry.sql`
4. `20260727024000_onboarding_booking_foundation.sql`
5. `20260727025000_paid_team_seat_enforcement.sql`
6. `20260727026000_billing_event_security_hardening.sql`
7. `20260727028000_progressive_funnel_analytics.sql`
8. `20260727029000_verified_trial_workspace_bootstrap.sql`

Before applying, confirm the target project and take the normal Supabase backup.
Run the local database/RLS gate with `npm run test:db`, then apply through the
normal Supabase migration path. Confirm the migration ledger in the target
project before changing a rollout flag.

The funnel table is service-role-only: RLS is enabled with no anon or
authenticated policy. Event writers use opaque idempotency keys and do not put
emails, payment data, provider tokens, or raw webhook/request payloads in event
properties.

## Stripe test configuration

Configure test-mode resources before setting the billing flag:

- recurring self-serve Prices: USD 499 tax-exclusive and AUD 499
  tax-inclusive;
- once-only introductory Coupons: USD 400 off and AUD 400 off;
- recurring managed Prices: USD 1,500 and AUD 2,500 base monthly prices;
- Stripe Tax, billing-address collection, applicable business tax-ID
  collection, receipts, and the seven-day trial reminder;
- a Checkout subscription requiring a reusable payment method and using the
  normal 499 recurring Price plus the market Coupon;
- Customer Portal cancellation, payment-method, and invoice features;
- webhook endpoint and secret for Checkout, subscription, paid/failed invoice,
  refund, and dispute events supported by the billing domain.

Set the IDs in:

- `STRIPE_SELF_SERVE_USD_PRICE_ID`
- `STRIPE_SELF_SERVE_AUD_PRICE_ID`
- `STRIPE_MANAGED_USD_PRICE_ID`
- `STRIPE_MANAGED_AUD_PRICE_ID`
- `STRIPE_SELF_SERVE_USD_INTRO_COUPON_ID`
- `STRIPE_SELF_SERVE_AUD_INTRO_COUPON_ID`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Use Stripe test clocks for both markets. Verify:

1. Checkout starts trialing with a reusable payment method.
2. A reconciled successful first Meta launch ends the trial and invoices 99 in
   the workspace currency.
3. No launch converts automatically after seven days and invoices 99.
4. A publish failure neither consumes the free-live claim nor ends the trial.
5. The first successful renewal invoices 499.
6. A paid invoice grants one 100-credit wallet exactly once.
7. Payment failure and cancellation preserve history and apply the documented
   access and credit behavior.

Never infer paid access from the Checkout redirect; use a verified webhook or an
explicit Stripe retrieval.

## Cal.com

Set `CALCOM_ONBOARDING_URL_US`, `CALCOM_ONBOARDING_URL_AU`,
`BOOKING_INVITATION_SECRET`, and `CALCOM_WEBHOOK_SECRET`.

Verify booked, rescheduled, cancelled, and completed webhook events against the
provider event ID and confirm replay is idempotent. If webhook credentials are
not available, keep the hosted URLs available and let operators record
attendance, but treat automated booking state and reminders as a launch
blocker.

## Meta

Configure `META_APP_ID`, `META_APP_SECRET`, the exact Preview and Production
OAuth redirect URLs, the requested permissions, test Business Portfolio, Page,
Instagram account where applicable, and ad account. Keep provider tokens in
`private.provider_token_vault`.

On Preview, test both paths:

- an eligible Meta account connects, selects assets, confirms campaign details,
  reaches Checkout, and launches once;
- a customer without an eligible account keeps the finished creative, receives
  the setup/help and booking choices, and resumes at Meta connection.

Confirm duplicate OAuth callback and publish delivery are safe. Confirm a
failed publish leaves the free-live claim and Stripe trial unused. Set
`BLOCKWISE_ENABLE_PROVIDER_WRITES=true` only for the controlled Preview test,
then return it to `false` until production promotion.

## Funnel-event integration

Owning transactions call the domain hook in
`src/lib/analytics/progressive-funnel.ts` only after their authoritative state
change succeeds:

- activation: email submission/verification, website, Brand Pack, template,
  generation start/completion, and third free ad;
- Meta: prompt, connection, help request, and reconciled free launch;
- billing: Checkout start/completion, first invoice, first renewal, managed
  Checkout, cancellation, and payment failure;
- booking: booked and completed;
- marketing: CTA and managed inquiry.

Every call includes the workspace when one exists, the confirmed country when
known, the stable first-touch acquisition source, and an opaque idempotency key.
Analytics failure must be visible to the owning server transaction or its
outbox/retry path; a browser event alone never confirms a milestone.

## Preview release gates

Record the Preview URL and deployment ID. Run:

- `npm run typecheck`
- `npm test`
- `npm run verify:hard-reset`
- `npm run build`
- `npm run test:e2e:preview`

On Vercel Preview verify:

- desktop at 1440x900;
- mobile at 390x844 and reflow at 320px;
- keyboard operation, focus return, screen-reader names/status, contrast,
  reduced motion, and touch targets;
- fresh USD and AUD journeys with Stripe test clocks;
- Meta-connected and no-account/help branches;
- duplicate generation, Checkout, webhook, booking webhook, and publish
  delivery;
- fifth-seat acceptance and sixth-seat rejection;
- cancellation, payment failure, booking failure, and recovery;
- operator queues, audit attribution, funnel rows, and the one-primary-action
  activation resolver.

No public copy flag is enabled until these gates pass and Terms, Privacy, Data
Deletion, FAQs, Checkout consent, and the implemented product all state the
same offer.

## Staged exposure

1. Apply foundations with every exposure flag false.
2. Enable foundations for internal workspaces at zero public exposure.
3. Enable activation for a deterministic internal cohort.
4. Enable billing for Stripe/Meta/booking test workspaces only.
5. Select one release market in `BLOCKWISE_PROGRESSIVE_MARKETS` and increase
   deterministic exposure in small steps while monitoring funnel conversion,
   payment/publish failures, booking failures, provider cost, abuse reviews,
   support load, and reconciliation queues. The release owner chooses the first
   market; this runbook does not assume an AU- or US-first order.
6. Hold or reduce exposure when any preview gate, entitlement invariant,
   country/price match, or provider reconciliation check fails.
7. Add the second market only after its own currency, tax, legal, Meta, and
   booking checks pass.
8. Move to 100% only after both markets are stable and the production smoke on
   `blockwise.sale` passes.

## Rollback

Set the public, billing, and activation flags to `false`, set exposure to `0`,
and set `BLOCKWISE_ENABLE_PROVIDER_WRITES=false`, then redeploy through Vercel.
Do not manually edit Stripe, activation, claim, booking, credit, or analytics
rows. Reconcile external state through the owning domain services. Additive
migrations stay applied unless a separately tested forward migration changes
them.
