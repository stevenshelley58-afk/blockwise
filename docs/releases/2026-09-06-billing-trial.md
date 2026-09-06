# Blockwise billing and no-card trial release

Deployed 6 September 2026 (Australia/Perth), app plus one database migration.

- Serving source: `f35a041563d4c5e257e323a97f851ec8c447fb3b`.
- Image: `blockwise-app:f35a041563d4c5e257e323a97f851ec8c447fb3b`.
- Previous serving source: `bc2b1f3ba681727c9f4261ddce90466cb170fc41` (image retained for rollback).
- Branch: `feat/billing-trial-20260906` (pushed to origin).

## What shipped

- No-card trial: the 14-day app trial starts only when Meta first reports
  actual delivery (`start_trial_on_first_delivery`, durable and idempotent).
  Verified email still unlocks the three-pack trial wallet (six renders) with a
  bounded pending-delivery setup window (30 days) before delivery. One trial
  per Meta Business Portfolio + ad account remains enforced by the existing
  free-live claim registry. The legacy Stripe-trial path
  (`first-live-campaign.ts`) is unchanged and separate.
- Credit enforcement: one complete Feed + Story pack (two renders) is consumed
  per created customer ad through the existing reserve/settle ledger.
  Ordinary text edits, fixes, repeat saves, and repeat downloads never consume
  another pack.
- Checkout hardening: owner/admin-only policy gate, server-side managed-service
  written-scope gate (`workspaces.managed_scope_approved_at`, recorded only via
  the operator action `approve_managed_scope`), duplicate-subscription
  rejection, open Checkout session reuse with safe expiry handling
  (`billing_checkout_sessions`), Stripe price validation (active, AUD, monthly,
  A$249 / A$1,500), and public-origin return URLs. Paid access still only
  follows verified Stripe payment events.
- Billing lifecycle: webhook signature verification, duplicate-event leases,
  stale-event ordering, renewal credit grants (100 credits per paid period),
  payment recovery, refund/dispute risk latching, and the billing portal were
  verified as already deployed and kept. Checkout session bookkeeping now syncs
  from `checkout.session.completed`.
- Interface: billing settings gained an owner/admin "Subscribe — A$249/month"
  button with recurring-price, cancellation, and separate-ad-spend disclosure;
  trial state and packs remaining surface in the trial pill, settings, and
  activation card; stale A$499/US/card-before-campaign copy removed from
  pricing, home, and activation messaging.

Migration `20260906010000_no_card_trial_delivery_start.sql` was applied after a
rehearsal against a restored copy of the production database (backup
`/projects/blockwise-billing-trial-20260906/.secrets/product-backups/20260906T153951Z`).
Trial state backfill preserved the one existing verification-started trial as
`active`; all other workspaces are `pending_delivery`.

## Checks

- `npm run check:nul`, `npm run test` (848 tests, 0 fail), `npm run typecheck`,
  `npm run build` — all pass on the deployed revision.
- New regression coverage: `tests/billing-trial-no-card.test.ts` (12 tests)
  covering delivery-anchored trial start and idempotency, checkout policy gates,
  price validation, session reuse/expiry, and the delivery predicate.

## Payment verification status

Live Stripe credentials are configured (live mode) with the approved Australian
prices active (self-serve A$249/month, managed A$1,500/month), a webhook
endpoint with all ten handled events enabled, and a billing portal
configuration. No test-mode credentials exist in the deployment environment, so
no live-mode charge, Checkout run, or webhook event was generated as a smoke
test. What was verified against live Stripe without charging: price objects
match the approved amounts/currency/interval/active status, webhook endpoint
and portal configuration exist, and unsigned webhook calls and unauthenticated
Checkout calls are rejected on the public route (400/401).
