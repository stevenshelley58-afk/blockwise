# ADR 0001 — System of record

Status: Accepted
Date: 2026-08-31

## Context

Blockwise integrates several external systems (payments, provider APIs,
booking, email transport, support, marketing, automation). Without an
explicit system-of-record decision, each integration risks becoming a second
ledger that drifts from the authoritative source. This ADR fixes which system
owns which truth and how every other system relates to it.

## Decision

Blockwise is the customer product and the system of record for its own
customer domain. External systems are authoritative only for the domains
listed below, and Blockwise mirrors or interacts with them through the stated
boundaries.

| Domain | System of record | Boundary |
| --- | --- | --- |
| Users, workspaces, onboarding, entitlements, customer analytics | Blockwise (Postgres/Supabase contract) | Authoritative. No external system may define entitlements or workspace state. |
| Money | Stripe | Authoritative for money. Signed, idempotent webhooks are mirrored into Blockwise; Blockwise never derives money state independently. |
| Provider campaign state and insights | Meta | Authoritative for provider campaign state and insights. Blockwise writes only through allowlisted mutations; everything else is read/reconcile. |
| Booking lifecycle | SnagTime fork (MIT, hardened) | Authoritative for the booking lifecycle. Opaque invitation reference in; signed lifecycle events out. |
| SMTP transport | Stalwart Community | Transport only. It moves mail; it holds no message or entitlement authority beyond delivery. |
| Support conversations | Chatwoot Community | Support conversations only. No entitlement authority. |
| Contacts, consent, campaigns | Mautic Community | Authoritative for contact/consent/campaign state in its domain, mirrored from Blockwise identity. |
| Non-critical replaceable glue | Activepieces Community | Only for non-critical, replaceable glue. Nothing load-bearing may depend on it. |
| Operator cockpit | Frank | Cockpit only. Frank holds no second ledger; it reads and acts on Blockwise state. |

## Explicit rejections and replacements

- **Mailflare: REJECTED from the architecture.** Its licence is
  source-available, not open source, and does not meet the project's
  licensing bar. Do not integrate it.
- **Mini Frank** is a separate product. It has no Blockwise role and no data
  flow into or out of Blockwise.
- **Cal.com is replaced by the SnagTime fork** (MIT, hardened) as the booking
  lifecycle system of record.
- **Resend is replaced by Stalwart transport behind a provider-neutral
  outbox.** Email senders write to the durable outbox; a worker drains it via
  Stalwart SMTP. No application code talks to a proprietary email API
  directly.

## Consequences

- Every integration adapter must treat its external system as authoritative
  only within its row above; mirroring is one-way unless stated.
- Replacing an external system (e.g. Cal.com → SnagTime, Resend → Stalwart)
  is an adapter/transport change behind the same boundary, not a change of
  record. The stale integration assumptions are tracked in
  `docs/releases/LEGACY-INTEGRATION-INVENTORY.md`.
- Any new integration must either fit an existing row or extend this ADR
  before code ships.
