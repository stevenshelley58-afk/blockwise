# Launch email and analytics release

App revision: `df08571156b43967124885327233529a6e74d141`.
Image: `blockwise-app:df08571156b43967124885327233529a6e74d141`.
Image ID: `sha256:1a3229ea52917e400989a22390aa4561630da617e6f7e32e141cec990414b741`.
Previous release retained: `447d05568b22bfb4ae138b70b083d74c12d67b6c`.

The candidate includes that live release's canonical Ad Studio preview work;
only the focused email and analytics commits were integrated. Main remains
divergent and was not deployed. No database migration, data deletion, Meta
activation or customer/prospect email send was performed.

Checks: NUL check, full tests (958 passed; one existing root-only filesystem
permission test skipped), typecheck and production build passed. The immutable
image passed loopback canary readiness, signup HTTP 200 and unsigned-webhook
HTTP 401. App-only production health verified the exact compiled revision.
The public browser journey reached the homepage and signup through its CTA;
no GA4 or Clarity tag loads while their real IDs remain absent.

The signed transactional timer is active. Three provider test addresses produced
actual Resend delivered/bounced/complained events. Bounce and complaint records
reached the product suppression table through the signed native webhook. A repeat
queued message to the bounced simulator address was suppressed with no provider
message ID. Real customer inbox placement was not asserted from these simulations.

Evidence and protected rollback env are under
`/srv/blockwise/launch-release-20260907/`; the helper is `deploy-app.sh` and the
pre-release env backup is `product.env.before-df08571156b4`. Restore that protected
environment and recreate only product-app to roll back; never reset data volumes.
Disable the email delivery gate before rollback to code without the route gate.

Still not launch-complete: Mautic CRM and Chatwoot shared inbox are not deployed;
the customer-ops runbook depends on missing shared mail identities and off-host
backup setup. Native Resend incoming/sent views work, but are not a compose/reply
inbox. Follow-up templates are unpublished and no nurture automation exists.
Cold outreach remains a reviewed draft process, without a permitted sender or
campaign. GA4 awaits final account creation confirmation and Clarity sign-in;
real IDs, rebuild, consent checks and provider-side event proof remain necessary.
