# Transactional email outbox

The signed systemd timer runs every minute, but it cannot claim, recover or send a message unless EMAIL_OUTBOX_DELIVERY_ENABLED=true is set in /srv/blockwise/product/.env. This is deliberately independent of the Meta provider-write gate.

Before opening the delivery gate:

1. Check due outbox rows and pending demo-welcome recovery rows are the intended, consented records. Do not open the gate to process an unknown historical queue.
2. Confirm the configured provider and verified sender domain with an authenticated read-only provider check.
3. Confirm the app revision includes the route-level delivery gate, then enable the timer and inspect its redacted service journal.
4. Use a controlled recipient for the first receipt; record only message IDs and status, never bodies or credentials.

The durable outbox uses leases, idempotency keys, suppression checks and retry backoff. Native Resend bounce and complaint webhooks reach /api/webhooks/resend, are verified against their exact signed bytes using the installed official SDK, and are stored idempotently in email_suppressions. Unknown domains are ignored. Persistence failure returns 503 for provider retry. The existing internally signed relay remains available for other transports. Unsubscribe and reply ingress must be connected before any marketing nurture flow is activated. Scheduled lead_followup mail additionally requires an explicit legal basis, recipient approval and approved-content identifier, and is suppressed when a reply or conversion lifecycle event exists.

This is not a cold-outreach workflow. Resend must not be used for cold outreach. Any such proposal needs separate legal-basis and content approval, suppression and reply-stop integration, a provider that permits the use case, and a controlled rollout.

Mautic and Chatwoot remain separate customer-operations infrastructure. The existing canonical full stack assumes a healthy shared product-mail service with dedicated SMTP identities, off-host backup and a Frank edge route. Those prerequisites are not currently present, so it is not safe to start an isolated Mautic instance merely to create a dashboard.

## Verified launch state — 7 September 2026

The timer and route delivery gate are enabled for the transactional outbox.
The pre-activation queue contained no active historical messages. Three explicit
Resend simulator recipients exercised delivery, bounce and complaint outcomes;
both negative signals were received through the real signed provider webhook.
A fourth queued message to the bounced simulator address was suppressed without
a provider message ID. These are provider simulator receipts, not proof of a
human recipient's inbox placement. No prospects or customers were contacted.

Two Resend templates are saved as unpublished drafts:
`blockwise-opt-in-day-2-draft` and `blockwise-opt-in-day-5-draft`.
No Resend automation was created: its API requires published templates even for
a disabled flow. Do not publish the drafts with their postal-address placeholder.
They need approved copy, a valid business address, explicit marketing opt-in,
unsubscribe handling and reply/conversion stops before connection to signup.
The existing signup requests only terms/privacy acceptance, not marketing opt-in.

Proposed opt-in sequence: capture a separately recorded opt-in -> requested
welcome -> wait two days -> lead follow-up guide -> wait three more days ->
ask what help is needed. Stop on withdrawal, reply, conversion, bounce or complaint.

Cold outreach is not part of Resend. Its proposed review flow is: research one
relevant business -> record and approve the lawful contact basis -> draft a
personal introduction -> approve the message -> use a sender whose terms permit
that use -> record the result -> at most one approved follow-up if still lawful.
Stop on reply, opt-out, bounce or complaint. Publicly listed addresses alone are
not blanket permission; do not import a purchased/scraped list or send to ask for
consent. No cold campaign, sender integration or prospect list is active.
