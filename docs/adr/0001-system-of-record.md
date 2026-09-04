# ADR 0001 — System of record

Status: Accepted (release inventory refreshed 2026-09-04)

## Context

Blockwise integrates payments, provider APIs, booking, email, support,
marketing, automation, and the Frank operator cockpit. Each integration must
have one authoritative owner; Blockwise mirrors external state only through a
reviewed boundary.

## Decision

| Domain | System of record | Boundary |
| --- | --- | --- |
| Users, workspaces, onboarding, entitlements, customer analytics | Blockwise (Postgres/Supabase contract) | Authoritative; external systems cannot define workspace or entitlement state. |
| Money | Stripe | Signed, idempotent webhooks are mirrored into Blockwise. |
| Provider campaign state and insights | Meta | Blockwise performs only allowlisted mutations; other state is read/reconcile. |
| Booking lifecycle | SnagTime fork (planned; hardened MIT fork) | The provider-neutral Blockwise contract is merged; the fork deployment and cutover are pending. |
| SMTP transport | Stalwart Community (planned) | Transport only; the Stalwart/GoTrue delivery foundation remains pending in draft PR #405. |
| Support conversations | Chatwoot Community | Support conversations only; no entitlement authority. |
| Contacts, consent, campaigns | Mautic Community | Authoritative only in its domain, mirrored from Blockwise identity. |
| Non-critical replaceable glue | Activepieces Community | Nothing load-bearing may depend on it. |
| Operator cockpit | Frank | Reads and acts on Blockwise state; it holds no second ledger. |

## Explicit exclusions and replacements

- Mailflare is rejected: its source-available licence does not meet the
  project's open-source bar.
- Mini Frank is a separate product and is excluded from Blockwise scope; it
  has no data flow into or out of Blockwise.
- Cal.com remains a compatibility path while the SnagTime fork is pending.
  PR #398 merged the provider-neutral contract and dual webhook foundation;
  it did not prove that a SnagTime service is deployed or cut over.
- Resend remains a compatibility provider while the Stalwart transport work is
  pending. PR #397 merged the durable provider-neutral outbox; draft PR #405
  has not been merged.

## Consequences

Adapters must preserve these ownership boundaries and any new integration must
extend this ADR before shipping. The release inventory and reconciliation
documents record unresolved compatibility paths and historical runtime facts;
they do not authorize a production cutover.
