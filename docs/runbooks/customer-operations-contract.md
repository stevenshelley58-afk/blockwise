# Blockwise customer operations contract

Frank/Hermes reads this service-only contract with an HMAC request signed by
the canonical `verifyInternalRequest` implementation and scope `ops.read`.
Requests use `x-blockwise-timestamp`, `x-blockwise-nonce`,
`x-blockwise-scope: ops.read`, and `x-blockwise-signature` headers. The
signature is HMAC-SHA256 over the exact newline-separated value
`v1\ntimestamp\nnonce\nscope\nMETHOD\npathname?query\nsha256(body)` using
`BLOCKWISE_INTERNAL_AUTH_SECRET` (or the documented alias), which must be at
least 32 characters. Timestamps have a 300-second skew window and nonces are
single-use. Query strings are therefore authenticated, not merely logged.
Every response is `Cache-Control: no-store`.

## Read endpoints

    GET /api/internal/ops/customers?limit=50&cursor=<opaque>&query=<name>
    GET /api/internal/ops/customers/{workspaceId}
    GET /api/internal/ops/customers/{workspaceId}/{lifecycle|activity|email|enquiries|bookings|billing|projections}
    GET /api/internal/ops/enquiries?limit=50&cursor=<opaque>

limit is bounded to 1–100. Customer and enquiry lists order by
updated_at/created_at DESC, id DESC; nextCursor is opaque and must be sent
unchanged. A workspace detail contains only allowlisted source fields:
members/profiles, activation lifecycle, bookings, explicitly associated
enquiries, billing/entitlements, email preferences and suppressions, audit
activity, projection receipts, and normalized provider snapshots. Enquiries
are never attached by matching an email address. Billing identifiers and
billing email are omitted except for a masked `billing_email_masked` value.
Owner/member contact email and name are explicit safe PII fields; raw provider
IDs, credentials, headers, metadata, and payloads are not exposed.

## Read response envelope

Every successful endpoint response is self-describing and has exactly this
top-level shape (the existing rows, `nextCursor`, and `limit` remain inside
`data`):

    {
      "schema": "blockwise.ops.read.v1",
      "project_id": "blockwise",
      "generated_at": "2026-09-04T00:00:00.000Z",
      "fresh_until": "2026-09-04T00:05:00.000Z",
      "source_revision": "blockwise-ops-read-v1",
      "source_receipt_ids": ["receipt:ops/api/internal/ops/customers/<id>"],
      "data": { "limit": 50, "total": 1, "nextCursor": null, "rows": [] }
    }

`source_receipt_ids` are opaque Blockwise read receipts, not provider IDs.
Provider snapshots expose only normalized delivery/flow/lifecycle/conversation
status, stage, subject, channel, masked provider record suffix, timestamps,
and source version. Hermes writes snapshots after settlement through the
service-role `upsert_ops_provider_snapshot` RPC; Frank never calls a provider.

Unassigned public enquiries are listed by `GET /api/internal/ops/enquiries`.
An operator associates one through the service-role
`associate_ops_enquiry(enquiry_id, workspace_id, actor_profile_id, reason)` RPC,
which locks the row, writes an audit event, and lets the association trigger
enqueue Chatwoot. Direct table writes are not an association workflow.

## Projection envelope

The durable outbox maps to this JSON shape:

    {
      "contractVersion": "blockwise.ops.projection.v1",
      "workspaceId": "workspace-uuid",
      "provider": "mautic",
      "aggregate": { "type": "contact", "id": "profile-uuid" },
      "operation": "upsert",
      "source": { "eventId": "activation:workspace-uuid:42", "version": 42 },
      "payload": { "workspaceId": "workspace-uuid", "email": "owner@example.com" }
    }

Adapter resources are fixed and provider-neutral:

| provider | aggregate | resource | identity |
| --- | --- | --- | --- |
| mautic | contact | contact | workspaceId:aggregate.id |
| mautic | lifecycle | lifecycle | workspaceId:aggregate.id |
| chatwoot | enquiry | enquiry | workspaceId:aggregate.id |
| chatwoot | support | support | workspaceId:aggregate.id |

Hermes claims with claim_ops_projection, maps the envelope, performs the
provider call outside Blockwise request paths, and settles with the lease
token. Claims and settlement are fenced: any older version is superseded and
cannot be claimed or settled after a newer version exists.

Source triggers enqueue after successful writes for workspace/bootstrap,
profile/member, activation, booking, lead/lead-event, billing acceptance,
communication preference, and explicitly associated demo/audit/report enquiry
changes. Mautic contact envelopes carry only safe owner/member contact fields
plus activation stage and booking status/subject; Chatwoot envelopes carry
safe enquiry/support subject/status fields. The outbox is the durable handoff;
there are no provider calls in customer request paths.

## Rollback

Run only against the intended database, after confirming the archive has
enough retention:

    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v confirm=ROLLBACK_CUSTOMER_OPERATIONS -f scripts/ops/rollback-customer-operations.sql

The procedure requires the exact sentinel `ROLLBACK_CUSTOMER_OPERATIONS`.
Before any drop it archives every row from the outbox, enquiry associations,
communication preferences, and provider snapshots into
`legacy_archive.customer_operations_tables_archive`, then verifies per-table
live/archive row counts in the same transaction. It refuses to continue on a
count mismatch. The archive remains available for retention and recovery;
only then are the operations objects and canonical suppression association
objects removed.
