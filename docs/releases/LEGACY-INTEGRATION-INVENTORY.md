# Legacy Integration Inventory

Status: recorded. This document inventories stale integration assumptions
left in the codebase. **No working path is deleted or disabled by this
inventory** — every path listed below is live and in service until its
replacement ships. Replacements follow ADR 0001
(`docs/adr/0001-system-of-record.md`): Stalwart SMTP behind a durable outbox
for email, and the SnagTime fork behind a provider-neutral adapter for
booking.

## 1. Resend (email) → Stalwart SMTP behind a durable outbox

### Current state

Resend's proprietary HTTP API is the direct email transport in three places,
gated on `RESEND_API_KEY`:

| File | Role |
| --- | --- |
| `src/lib/email/resend-client.ts` | Shared Resend API client; template ids for demo request, alert, suburb report, lead welcome/follow-up/digest (`RESEND_TEMPLATE_*`) |
| `src/lib/alerts/notify.ts` | Paid-service alert emails sent via Resend |
| `src/lib/operator/email-service.ts` | Operator mailbox: send and receive (`api.resend.com` `/emails`, `/emails/receiving`) |
| `src/lib/config/env.ts` | `RESEND_API_KEY` in the env contract |
| `.env.example` (lines 115, 142–144), `infra/product/.env.example` (line 92) | Documented env vars |
| `infra/coolify/docker-compose.product.yml` (lines 228–235), `infra/coolify/docker-compose.research.yml` (line 409) | Runtime env plumbing |
| `tests/alerts-owner-recipient.test.ts`, `tests/alerts-model-fallback-alert.test.ts`, `tests/operator-email-service.test.ts`, `tests/env.test.ts` | Coverage pinned to the Resend contract |
| `docs/runbooks/paid-service-alerts.md` | Runbook assumes Resend dashboards/keys |

### Replacement plan

1. Introduce a durable, provider-neutral outbox (table + worker drain) as the
   only write path for outbound email; senders enqueue, never call a provider
   API.
2. Drain the outbox via Stalwart Community SMTP (transport only, per ADR
   0001).
3. Re-point the operator mailbox read path at the Stalwart-hosted mailbox
   (IMAP/JMAP) behind the same `email-service` interface.
4. Migrate `RESEND_*` env vars to SMTP/mailbox config; update the env
   contract, compose files, runbook, and tests together as one tested change.

### Quarantine status

Not quarantined. All listed paths are live and working. The Resend dependency
is an accepted interim transport until the outbox + Stalwart cutover ships;
no parallel or shadow path is created in the meantime.

## 2. Cal.com (booking) → SnagTime fork behind a provider-neutral adapter

### Current state

The booking path hard-codes Cal.com as the only provider:

| File | Role |
| --- | --- |
| `src/lib/booking/provider.ts` | `provider: "calcom"` literal in `ProviderBookingEvent`; `CALCOM_ONBOARDING_URL_US/AU`, `CALCOM_WEBHOOK_SECRET`; `verifyCalcomWebhook` / `parseCalcomWebhook` |
| `src/lib/booking/service.ts` | Hard-codes `provider: "calcom"` on insert into `workspace_onboarding_bookings`; parses via `parseCalcomWebhook` |
| `src/app/api/booking/webhook/route.ts` | Cal.com webhook endpoint (signature verification) |
| `supabase/migrations/20260727024000_onboarding_booking_foundation.sql` | `provider text not null default 'calcom'` |
| `.env.example` (lines 32–35), `infra/coolify/docker-compose.product.yml` (lines 248–250) | `CALCOM_*` env plumbing |
| `docs/runbooks/progressive-onboarding-rollout.md` (lines 113–116) | Runbook configures Cal.com |
| `src/app/(customer)/booking/page.tsx`, `src/app/(legal)/privacy/page.tsx` (line 164), `src/app/(legal)/terms/page.tsx` (line 67) | Customer-facing copy names Cal.com |
| `tests/booking-operator-operations.test.ts`, `tests/progressive-rollout-contract.test.ts` | Coverage pinned to the Cal.com contract |

### Replacement plan

1. Keep the existing `ProviderBookingEvent` contract (it is already
   provider-neutral in shape) and introduce a provider adapter layer so
   `provider.ts`/`service.ts` stop hard-coding `"calcom"`.
2. Implement the SnagTime fork (MIT, hardened) adapter: opaque invitation
   reference in, signed lifecycle events out (per ADR 0001).
3. Ship a tested migration widening the `provider` column values (default
   stays valid for existing rows; no destructive change).
4. Swap the webhook endpoint to verify SnagTime signatures, update
   `CALCOM_*` env vars to provider-neutral names, and update runbook, legal
   copy, and tests in the same change.

### Quarantine status

Not quarantined. The Cal.com booking path is live for onboarding and remains
the supported path until the SnagTime adapter ships behind the same
contract.

## 3. ActiveCampaign

No references found. A repository-wide search for ActiveCampaign (any
casing/spacing) returns nothing: there is no existing integration, env var,
migration, or documentation assuming it. Nothing to migrate or quarantine;
recorded here so future integrators do not assume one exists. Any future
contacts/consent/campaign work goes through Mautic Community per ADR 0001.
