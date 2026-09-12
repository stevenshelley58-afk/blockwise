# Owner CRM customer snapshot

This is a deliberately small, read-only Blockwise-to-owner CRM seam. It gives
Hermes the bounded customer and billing observation it needs to reconcile its
own CRM mirror later. Hermes owns any later CRM execution. Blockwise does not
host a Frappe adapter here and this component does not create people,
workspaces, CRM records, billing changes, access grants, provider calls, lead
deliveries, or research records.

The minimal custom code is justified because no existing internal endpoint
provides a bounded, privacy-minimised owner/customer projection. The internal
HMAC boundary and service-role-only RPC are reused rather than exposing a
customer session, general service-role capability, or new runtime.

The snapshot is an observation of Blockwise authority, not an event consumer.
It returns raw billing, Stripe subscription, and native trial facts separately.
It does not calculate product access or turn subscription states into lifecycle
states. Owner and source ambiguity are marked instead of silently choosing a
record.
