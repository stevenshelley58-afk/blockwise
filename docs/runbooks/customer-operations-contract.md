# Blockwise customer operations contract

Frank/Hermes reads this service-only contract with an HMAC request signed by
the canonical verifyInternalRequest implementation and scope ops.read.
The signature covers the method, full path including query string, body hash,
timestamp, nonce, and scope. Every response is Cache-Control: no-store.

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
activity, and projection receipts. Enquiries are never attached by matching an
email address.

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

## Rollback

Run only against the intended database, after confirming the archive has
enough retention:

    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v confirm=ROLLBACK_CUSTOMER_OPERATIONS -f scripts/ops/rollback-customer-operations.sql

The procedure archives every outbox row, verifies live/archive row counts in
the same transaction, then removes the operations objects. The archive is
left in legacy_archive.customer_operations_outbox_archive.
