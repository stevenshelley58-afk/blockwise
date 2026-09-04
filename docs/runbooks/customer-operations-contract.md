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

Absent `limit`/`pageSize` defaults to 50. Positive integer values are bounded
to 100; malformed, zero, and negative values return `400 invalid_limit`.
Customer and enquiry lists order by
updated_at/created_at DESC, id DESC; nextCursor is opaque and must be sent
unchanged. Only an absent `limit`/`pageSize` or `cursor` starts the first page;
explicit empty/whitespace values return `400 invalid_limit` or
`400 invalid_cursor`. A workspace detail contains only allowlisted source fields:
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
      "source_revision": "<BLOCKWISE_BUILD_REVISION or VERCEL_GIT_COMMIT_SHA>",
      "source_receipt_ids": ["receipt:ops/api/internal/ops/customers/<id>"],
      "data": { "limit": 50, "total": 1, "nextCursor": null, "rows": [] }
    }

`source_receipt_ids` are opaque Blockwise read receipts derived from durable
source/outbox/snapshot/audit row IDs, not provider IDs. `source_revision` is
the immutable `BLOCKWISE_BUILD_REVISION` (or Vercel commit SHA) when supplied;
the contract version is used only as a deterministic local fallback.
Provider snapshots expose only normalized delivery/flow/lifecycle/conversation
status, stage, subject, channel, masked provider record suffix, timestamps,
and source version. Hermes writes snapshots after settlement through the
service-role `upsert_ops_provider_snapshot` RPC; Frank never calls a provider.

Unassigned public enquiries are listed by `GET /api/internal/ops/enquiries`.
This route returns only associations with `workspace_id = null`; totals and
opaque cursors are calculated over that same unassigned set. The `id` field is
the internal Blockwise association reference. Source/provider identifiers such
as `source_id` and `external_id` are omitted.
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

For an enquiry projection, `source.eventId` is
`enquiry-association:<internal-association-uuid>:<sequence-version>` and the
safe payload contains only `workspaceId`, `subject`, and `status`. Neither
`source_id`, `external_id`, nor any provider/CRM identifier is copied into the
payload or outbox source event.

Adapter resources are fixed and provider-neutral:

| provider | aggregate | resource | identity |
| --- | --- | --- | --- |
| mautic | contact | contact | workspaceId:profileId (aggregate id is a Blockwise profile) |
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
It first takes transactional `ACCESS EXCLUSIVE` locks over all source and
derived operations tables, freezing writers and trigger inserts for the
archive/count/drop cut.
Before any drop it archives every row from the outbox, enquiry associations,
communication preferences, provider snapshots, and the complete current
`email_suppressions` rows (including `workspace_id`) into
`legacy_archive.customer_operations_tables_archive`, then verifies per-table
live/archive row counts for the current rollback run in the same transaction.
Each run has its own `run_id`, so a previously retained archive cannot cause a
false mismatch or be overwritten. It refuses to continue on a count mismatch.
The archive remains available for retention and recovery;
only then are the operations objects and canonical suppression association
objects removed.

Consent normalization keeps the newest case-normalized preference row while
carrying forward any restrictive withdrawn/denied, unsubscribe, or suppressed
state. Discarded legacy rows are archived in
`legacy_archive.customer_operations_consent_reconciliation_202609040003`.
