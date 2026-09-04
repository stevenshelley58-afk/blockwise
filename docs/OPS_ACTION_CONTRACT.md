# Blockwise operator action contract

The service-only contract is `blockwise.ops.action.v1`. It records operator
intent for Hermes; it never calls a provider or mutates a customer inline.
Every envelope carries a UUID `actionId`, bounded unique `idempotencyKey`,
equal `workspaceId`/`customerId`, UUID target, operator ID/role with `aal2`,
positive `expectedVersion`, a 500-character reason, canonical UTC
`createdAt`/`expiresAt`, and a strict action payload. Expiry is at most 24 hours.
Destructive and support actions require the same bounded reason field as every
other action so audit policy cannot be bypassed by a caller choosing a benign
action name.

```json
{
  "schema": "blockwise.ops.action.v1",
  "actionId": "84444444-4444-4444-8444-444444444444",
  "idempotencyKey": "ops:invite:1",
  "workspaceId": "81111111-1111-4111-8111-111111111111",
  "customerId": "81111111-1111-4111-8111-111111111111",
  "actor": { "operatorId": "82222222-2222-4222-8222-222222222222", "role": "support", "aal": "aal2" },
  "target": { "type": "workspace", "id": "81111111-1111-4111-8111-111111111111" },
  "action": "team_invite",
  "expectedVersion": 1,
  "reason": "Customer requested team access",
  "createdAt": "2026-09-04T00:00:00.000Z",
  "expiresAt": "2026-09-04T01:00:00.000Z",
  "payload": { "email": "invite@example.test", "role": "member" }
}
```

## Action matrix

| Action | Target | Capability |
| --- | --- | --- |
| `team_invite` | workspace | available: existing invitation path |
| `team_resend` | invitation | available: existing pending invitation path |
| `team_cancel` | invitation | available: existing cancellation RPC |
| `team_role_change` | profile | capability required |
| `team_suspend` | profile | unsupported |
| `team_reactivate` | profile | unsupported |
| `session_revoke` | session | available: existing owner-only RPC |
| `consent_grant`, `consent_withdraw`, `consent_unsubscribe` | profile | capability required |
| `suppression_add`, `suppression_remove` | profile | capability required |
| `enquiry_assign` | enquiry | available: explicit association RPC |
| `enquiry_close`, `enquiry_reply` | enquiry | capability required |
| `booking_cancel`, `booking_reschedule` | booking | capability required |
| `billing_reconcile` | billing | available: existing reconciliation path |
| `billing_cancel_at_period_end` | billing | capability required |
| `billing_portal_link` | billing | available: existing portal capability; URL is never stored |

Capability-gated and unsupported actions are recorded as `rejected` with an
immutable receipt explaining the capability state. No worker may infer an
implementation from the action name.

## Durable lifecycle

`enqueue_ops_action` is the only write entrypoint. `claim_ops_action`,
`heartbeat_ops_action`, `complete_ops_action`, `fail_ops_action`, and
`reap_ops_actions` are the only lifecycle entrypoints. The outbox and receipts
are service-only with direct service-role INSERT/UPDATE/DELETE revoked.
Receipts are append-only and each transition is mirrored to `audit_logs`.
Claims, heartbeats, settlement, and failure all reject or supersede stale
versions for the same workspace/target under a transaction lock.

Payloads never contain provider IDs, portal URLs, secrets, or nested metadata;
reply bodies are capped at 4,000 characters. Settlement results are capped at
4,096 serialized characters and reject provider IDs, URLs, and credential-like
fields.

Rollback is archive-first and forward-only. Freeze writers, archive all three
action tables into the per-run `legacy_archive.customer_operations_tables_archive`
with the `ROLLBACK_CUSTOMER_OPERATIONS` sentinel, verify current-versus-current-
run row counts, then drop only in a separately reviewed migration.
