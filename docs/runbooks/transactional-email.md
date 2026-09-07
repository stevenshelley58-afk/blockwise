# Transactional email outbox

The signed systemd timer runs every minute, but it cannot claim, recover or send a message unless EMAIL_OUTBOX_DELIVERY_ENABLED=true is set in /srv/blockwise/product/.env. This is deliberately independent of the Meta provider-write gate.

Before opening the delivery gate:

1. Check due outbox rows and pending demo-welcome recovery rows are the intended, consented records. Do not open the gate to process an unknown historical queue.
2. Confirm the configured provider and verified sender domain with an authenticated read-only provider check.
3. Confirm the app revision includes the route-level delivery gate, then enable the timer and inspect its redacted service journal.
4. Use a controlled recipient for the first receipt; record only message IDs and status, never bodies or credentials.

The durable outbox uses leases, idempotency keys, suppression checks and retry backoff. Bounce, complaint and unsubscribe signals must be written to email_suppressions before any retry can send. Scheduled lead_followup mail additionally requires an explicit legal basis, recipient approval and approved-content identifier, and is suppressed when a reply or conversion lifecycle event exists.

This is not a cold-outreach workflow. Resend must not be used for cold outreach. Any such proposal needs separate legal-basis and content approval, suppression and reply-stop integration, a provider that permits the use case, and a controlled rollout.

Mautic and Chatwoot remain separate customer-operations infrastructure. The existing canonical full stack assumes a healthy shared product-mail service with dedicated SMTP identities, off-host backup and a Frank edge route. Those prerequisites are not currently present, so it is not safe to start an isolated Mautic instance merely to create a dashboard.
