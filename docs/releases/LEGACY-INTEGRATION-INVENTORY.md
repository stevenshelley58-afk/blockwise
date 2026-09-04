# Legacy Integration Inventory

Status: recorded for release planning (2026-09-04)

This is an inventory, not a migration. Existing compatibility paths remain
enabled until their replacement is deployed, reconciled, and separately
approved. See ADR 0001.

## Email: Resend compatibility → Stalwart SMTP

### Current truth

PR #397 merged a durable, provider-neutral transactional outbox. The existing
Resend adapter remains available for compatibility and operator mailbox paths;
draft PR #405 contains the Stalwart/GoTrue delivery foundation and is still
pending. No Stalwart production cutover is claimed.

Known compatibility references include `src/lib/email/resend-client.ts`,
`src/lib/email/provider.ts`, `src/lib/operator/email-service.ts`,
`RESEND_*` environment variables, the product/research Compose plumbing, and
the alert/mail runbooks and tests. The outbox is the application write
boundary; it does not by itself prove transport replacement.

### Replacement gate

Merge and validate #405 (or its reviewed successor), configure Stalwart and
GoTrue on a disposable stack, test delivery/recovery/receipt behavior, then
perform a separately recorded cutover with a rollback transport and retained
Resend compatibility until the retention window closes.

## Booking: Cal.com compatibility → SnagTime fork

### Current truth

PR #398 merged the provider-neutral application contract, SnagTime event
contract, and dual webhook handlers. The SnagTime fork itself and any
production deployment/cutover remain pending. Existing Cal.com environment
variables and compatibility webhook are intentionally retained.

### Replacement gate

Content-audit and deploy the exact SnagTime fork revision, verify signed
events, opaque invitation references, idempotency, migration compatibility,
and operator recovery on a disposable environment. Only then change the
provider selection and record a live receipt; preserve a tested Cal.com
rollback path during the transition.

## Other boundaries

- ActiveCampaign: no repository references found; future contact/consent work
  follows Mautic per ADR 0001.
- Mailflare: explicitly rejected; do not add it as a substitute.
- Mini Frank: explicitly excluded; do not import its files, data, or runtime.

Unknown production configuration, deployment state, and service ownership
remain unknown until a new receipt is captured. Repository references are not
evidence of a live external service.
