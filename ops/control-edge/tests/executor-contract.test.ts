import assert from "node:assert/strict";
import test from "node:test";
import { isSubscriptionBound, sameQueuedEnvelope } from "../../../src/lib/ops/action-executor-contract.ts";

test("subscription binding rejects a subscription belonging to another workspace", () => {
  assert.equal(isSubscriptionBound({ id: "sub_same", metadata: { workspace_id: "workspace-a" } }, "sub_same", "workspace-b"), false);
  assert.equal(isSubscriptionBound({ id: "sub_other", metadata: { workspace_id: "workspace-a" } }, "sub_same", "workspace-a"), false);
  assert.equal(isSubscriptionBound({ id: "sub_same", metadata: { workspace_id: "workspace-a" } }, "sub_same", "workspace-a"), true);
});

test("queued envelope comparison covers immutable identity and payload", () => {
  const body = {
    schema: "blockwise.ops.action.v1", actionId: "a", idempotencyKey: "key", workspaceId: "w", customerId: "w",
    actor: { operatorId: "o", role: "support", aal: "aal2" }, action: "billing_reconcile", target: { type: "billing", id: "w" },
    expectedVersion: 1, reason: "requested", payload: { amount: 1 }, createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T01:00:00.000Z",
  };
  const row = { action_id: "a", idempotency_key: "key", workspace_id: "w", customer_id: "w", actor_operator_id: "o", actor_role: "support", actor_aal: "aal2", action_type: "billing_reconcile", target_type: "billing", target_id: "w", expected_version: 1, reason: "requested", payload: { amount: 1 }, created_at: "2026-01-01T00:00:00.000Z", expires_at: "2026-01-01T01:00:00.000Z" };
  assert.equal(sameQueuedEnvelope(body, row), true);
  assert.equal(sameQueuedEnvelope({ ...body, reason: "tampered" }, row), false);
  assert.equal(sameQueuedEnvelope({ ...body, payload: { amount: 2 } }, row), false);
});
