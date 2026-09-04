# Blockwise customer-ops control edge

This is a private, provider-neutral control edge for Frank's operator console.
It accepts the frozen `blockwise.ops.action.v1` envelope, authenticates Frank
or Hermes with the existing HMAC/timestamp/nonce protocol, and enqueues through
the RPC-only `ops_action_outbox` contract. It never calls Mautic, Chatwoot,
Stripe, SnagTime, or Google directly.

Run it beside Hermes on the private VPS network. Do not publish this listener
to the public internet. The `/health/live` probe is intentionally unauthenticated;
`/health/ready` and every control route require HMAC. Bearer-only auth is not
accepted.

## Contract

`POST /v1/control/actions` accepts one complete action envelope and returns
`202` with `actionId`, durable status, capability, and a correlation ID.
`GET /v1/control/actions/:actionId` requires the signed `ops.read` scope plus
`x-blockwise-workspace-id`; it returns status and append-only receipt metadata.
Payloads, operator role/AAL2, capabilities, target ownership, idempotency, and
version fencing are enforced by the shared action contract and migration RPCs.

Available execution matrix in this slice:

| Action | Target | Execution |
| --- | --- | --- |
| `team_invite` | workspace | internal Blockwise executor |
| `team_resend`, `team_cancel` | invitation | internal Blockwise executor |
| `session_revoke` | session/profile ID | internal Blockwise executor |
| `enquiry_assign` | exact associated or global enquiry ID | internal Blockwise executor; atomically binds global → workspace |
| `billing_reconcile` | billing | internal Blockwise executor |

Role changes, consent/suppression changes, enquiry close/reply, booking
cancel/reschedule, and billing cancellation remain capability-gated or
unsupported and fail closed in the database. `billing_portal_link` is
explicitly unavailable here until a protected one-time handoff endpoint is
configured; no portal URL is stored in a receipt, log, or outbox payload.

## Configuration

The service requires `BLOCKWISE_INTERNAL_AUTH_SECRET_FILE` and
`SUPABASE_SERVICE_ROLE_KEY_FILE` (0600 regular files, owner-only directory on
Linux, owned by the container's non-root UID 1000), plus an HTTPS
`SUPABASE_URL`. Set
`BLOCKWISE_ACTION_EXECUTOR_URL` and
`BLOCKWISE_ACTION_EXECUTOR_SECRET_FILE` to enable the worker. Secrets are never
accepted from ordinary environment variables. See `.env.example` for names;
the real file belongs outside the checkout.

The executor secret must match the product's `BLOCKWISE_INTERNAL_AUTH_SECRET`
used by `/api/internal/customer-ops/actions`; it is a separate file mount in
the edge container, never a value copied into the repository or action payload.

The Compose image runs as UID 1000 and never as root. Before starting it, make
the secret directory `0700`, the files `0600`, and their owner UID 1000 (or use
the deployment's equivalent non-root UID); otherwise the fail-closed file
checks intentionally refuse to start.

`CONTROL_EDGE_WORKER_ENABLED=true` enables the lease claimant in the same
process. Each worker tick first runs the durable `reap_ops_actions` lease
recovery RPC and then claims at most one action; expired leases are therefore
recovered after a crash without an ad-hoc in-memory queue. For larger deployments, run a second replica with the worker enabled;
the database claim RPC uses `SKIP LOCKED`, lease tokens, version fencing, and
monotonic receipts, so crash replay is safe. A lost lease cannot settle an
action. HTTP `429` and `5xx` executor responses retry; other 4xx responses are
permanent failures.

## Required integration patch

Frank PR #121 currently has a legacy bearer-only dispatcher payload. It must
be updated to send the complete action envelope, HMAC headers, nonce, and
`ops.write` scope, then poll the signed `ops.read` status route using the
workspace header. The product-side executor is shipped at
`/api/internal/customer-ops/actions`; it re-reads the leased outbox row,
deep-compares the immutable envelope, re-checks the operator role, and calls
the existing invitation/session/enquiry/billing domain capabilities. AAL2 is
an evidence boundary: Frank must perform live MFA before signing; the product
executor does not trust an unverified caller claim. Until the Frank patch and
private-network VPS deployment are complete, this is not a live operator
control path.
