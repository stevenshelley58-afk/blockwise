# Owner CRM customer snapshot

This is a deliberately small, read-only Blockwise-to-owner CRM seam. It gives
Hermes the bounded customer and billing observation it needs to reconcile its
own CRM mirror later. Hermes owns any later CRM execution. Blockwise does not
host a Frappe adapter here and this component does not create people,
workspaces, CRM records, billing changes, access grants, provider calls, lead
deliveries, or research records.

The minimal custom code is justified because no existing internal endpoint
provides a bounded, privacy-minimised owner/customer projection. The internal
HMAC verifier and service-role-only RPC are reused rather than exposing a
customer session, general service-role capability, or new runtime.

The endpoint accepts only scope `owner-crm.customer-snapshot` signed with the
dedicated `OWNER_CRM_SNAPSHOT_AUTH_SECRET`. The Blockwise runtime reads that
value from `/srv/blockwise/product/.env`; the Hermes caller reads the same value
from `/srv/hermes/secrets/owner-crm-sync.env`. Do not copy it into Frank or use
`BLOCKWISE_INTERNAL_AUTH_SECRET` as a fallback. An absent or weak dedicated
secret leaves this endpoint fail-closed with a 503 response.

The snapshot is an observation of Blockwise authority, not an event consumer.
It returns raw billing, Stripe subscription, and native trial facts separately.
It does not calculate product access or turn subscription states into lifecycle
states. Owner and source ambiguity are marked instead of silently choosing a
record.
