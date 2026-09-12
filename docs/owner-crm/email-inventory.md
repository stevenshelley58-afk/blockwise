# Owner CRM email inventory

Checked against the current Blockwise source on 12 September 2026. This is a
source inventory only. It contains no recipient records, message bodies with
personal data, provider credentials, or delivery evidence.

## Delivery boundary

The scheduled watchdog alert recipient must be an explicitly configured
@blockwise.sale mailbox. The watchdog now fails closed when that configured
recipient is missing, malformed, or external. It does not fall back to a
personal inbox. Customer and lead recipients remain external by design only
when they have requested the corresponding service or report.

Product transactional messages use the durable outbox. It has explicit
provider selection, a separate EMAIL_OUTBOX_DELIVERY_ENABLED gate, idempotency,
suppression checks, leases, retries, and settlement projection. GoTrue account
confirmation, recovery, and email-change messages use the auth service's
separate direct SMTP path. Resend is a compatibility provider for product
transactional delivery only. It is not a cold outreach provider.

## Producer and template inventory

| Producer path | Template or message type | Recipient class | State | Notes |
| --- | --- | --- | --- | --- |
| src/app/api/demo-request/route.ts | lead-welcome | Requested customer service | Active when the demo route is available | Queues a plain welcome after a demo request. Uses DEMO_NOTIFY_FROM or the Blockwise default sender. |
| src/lib/notify/demo-request-email.ts via src/app/api/demo-request/route.ts | operator-message | Operator | Active | Queues the submitted demo details for configured operator recipients. It does not use Resend directly. |
| src/app/suburb/[postcode]/actions.ts via src/lib/operator/email-service.ts | operator-message | Opted-in report requester | Active while suburb pages are enabled | Delivers the requested report link and records report_email_leads settlement. |
| src/app/api/research/audit/lead/route.ts via sendAuditCampaignPlanEmail | operator-message | Requested audit lead | Active while the suburbPages feature is enabled | One-off campaign plan after the person submits the audit form. This is not a prospecting sequence. |
| src/lib/operator/customers.ts (resend_booking) | operator-message | Existing customer | Active on explicit operator action | Sends an onboarding booking link to the stored customer address. |
| src/lib/providers/scheduled-maintenance.ts via sendAlertEmail | alert / operator_alert | Operator | Active watchdog path | Queues stalled-job alerts. Recipient is now domain-safe and fail-closed. |
| GoTrue auth service in the product stack | Auth confirmation, recovery, and email-change mail | Auth service user | Active when auth email is enabled | Separate direct SMTP path. It is outside the product outbox and must retain its own sender and provider verification. |
| src/lib/email/lead-lifecycle.ts (sendLeadDigest) | lead-digest / lead_digest | Existing agent or workspace operator | Dormant producer | No current caller found. Requires a caller-owned agent address and should remain an account digest, not prospecting. |
| src/lib/email/lead-lifecycle.ts (scheduleFollowUpEmail) | lead-followup / lead_followup | Opted-in or existing customer only | Dormant producer | Authorization requires legal basis, approved recipient time, approved content ID, and approval time. Reply and conversion events suppress it. |
| src/lib/email/resend-client.ts template, raw, batch, event, and contact helpers | Resend-managed aliases plus raw sends | Compatibility only | Dormant compatibility surface | No current product callers found. Do not connect these helpers to cold outreach or publish the draft opt-in automation until consent, unsubscribe, address, and stop handling are approved. |
| src/lib/outreach/postcode-campaign.ts | quiet-card-postcode-outreach and quiet-card-postcode-outreach-follow-up | Cold prospect | Draft and preview only | Builds drafts and previews behind explicit evidence, consent, provenance, suppression, rights, and one-follow-up checks. No send adapter or provider route is present. Never route this to Resend. |
| src/lib/email-design/renderer.ts | quiet-card, personal-letter, operations-brief | Renderer layouts | Active library, no delivery caller | Layout primitives, not independently deliverable campaigns. |

## Review findings

- The prior watchdog fallback to an external Gmail address was unsafe. It is
  removed. Missing or external operator alert configuration now produces no
  outbox row and returns a failed alert result.
- DEMO_NOTIFY_TO is still a legacy configuration name used by demo-request
  operator notifications. Production configuration should set it, when needed,
  to an approved @blockwise.sale mailbox. The watchdog applies the same
  domain check to that fallback.
- The generic operator-message template ID covers several requested service
  messages. Before any template redesign, split only where a distinct job,
  sender, or legal footer is required. Do not create a second mail engine.
- The plain lead-welcome content is a requested service response. The
  lead-followup and postcode outreach content must not be activated without
  the existing authorization, suppression, reply-stop, unsubscribe, and
  provider-use gates.
- No active cold-mail sender, imported prospect list, or cold-mail automation
  was found in the product source. The postcode outreach module is a draft
  generator and preview surface only.
- The source contains legacy Resend template aliases for demo request, alert,
  suburb report, welcome, follow-up, and digest. They are not proof that a
  published or approved provider template exists. Confirm provider dashboard
  state separately before enabling a template-based path.

## Remaining actions

1. Keep ALERT_EMAIL_TO, DEMO_NOTIFY_TO, and any legacy owner alert setting
   explicitly set to approved @blockwise.sale mailboxes in the product
   runtime. Do not restore an external default.
2. Before enabling any dormant lifecycle or outreach producer, record the
   recipient basis, approved content version, suppression state, stop events,
   unsubscribe destination, sender identity, and provider terms.
3. Review the generic service-message copy and legacy Resend aliases against the
   current offer and footer requirements. No copy or provider dashboard change
   is made by this inventory.
