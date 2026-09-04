import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { authenticate, signingPayload, type NonceStore } from "../src/auth.ts";
import { parseOpsAction, type OpsActionEnvelope } from "../../../src/lib/ops/action-contract.ts";
import { createControlEdgeServer } from "../src/server.ts";
import type { ActionRepository, ActionStatus, ClaimedAction } from "../src/repository.ts";

class MemoryNonce implements NonceStore { seen = new Set<string>(); async consume(nonce: string): Promise<boolean> { if (this.seen.has(nonce)) return false; this.seen.add(nonce); return true; } }
function request(headers: Record<string, string>, method = "POST"): import("node:http").IncomingMessage { return { headers, method, socket: { remoteAddress: "127.0.0.1" } } as unknown as import("node:http").IncomingMessage; }
function signed(path: string, body: string, nonce: string, now: Date, scope = "ops.write") { const timestamp = Math.floor(now.getTime() / 1000).toString(); const secret = "x".repeat(40); const signature = createHmac("sha256", secret).update(signingPayload(timestamp, nonce, scope, "POST", path, body)).digest("hex"); return { headers: { "x-blockwise-timestamp": timestamp, "x-blockwise-nonce": nonce, "x-blockwise-scope": scope, "x-blockwise-signature": signature }, secret }; }
test("HMAC auth accepts once and rejects replay", async () => { const now = new Date("2026-09-04T15:00:00.000Z"); const nonce = new MemoryNonce(); const input = signed("/v1/control/actions", "{}", "nonce-1234", now); const req = request(input.headers); assert.deepEqual((await authenticate(req, "/v1/control/actions", "{}", "ops.write", input.secret, nonce, now)).ok, true); assert.equal((await authenticate(req, "/v1/control/actions", "{}", "ops.write", input.secret, nonce, now)).ok, false); });
test("HMAC auth rejects scope and body tampering", async () => { const now = new Date("2026-09-04T15:00:00.000Z"); const nonce = new MemoryNonce(); const input = signed("/v1/control/actions", "{}", "nonce-1235", now); assert.equal((await authenticate(request(input.headers), "/v1/control/actions", "changed", "ops.write", input.secret, nonce, now)).ok, false); assert.equal((await authenticate(request(input.headers), "/v1/control/actions", "{}", "ops.read", input.secret, nonce, now)).ok, false); });
test("contract keeps capability and payload validation fail closed", () => { const base = { schema: "blockwise.ops.action.v1", actionId: "11111111-1111-4111-8111-111111111111", idempotencyKey: "ops:test:1", workspaceId: "22222222-2222-4222-8222-222222222222", customerId: "22222222-2222-4222-8222-222222222222", actor: { operatorId: "33333333-3333-4333-8333-333333333333", role: "owner", aal: "aal2" }, target: { type: "billing", id: "22222222-2222-4222-8222-222222222222" }, action: "billing_reconcile", expectedVersion: 1, reason: "support request", createdAt: "2026-09-04T15:00:00.000Z", expiresAt: "2026-09-04T15:10:00.000Z", payload: {} }; assert.equal(parseOpsAction(base).action, "billing_reconcile"); assert.throws(() => parseOpsAction({ ...base, payload: { extra: true } })); assert.throws(() => parseOpsAction({ ...base, actor: { ...base.actor, aal: "aal1" } })); });

class FakeRepository implements ActionRepository {
  nonces = new Set<string>(); actions = new Map<string, ActionStatus>();
  async consume(nonce: string): Promise<boolean> { if (this.nonces.has(nonce)) return false; this.nonces.add(nonce); return true; }
  async ready(): Promise<boolean> { return true; }
  async enqueue(action: OpsActionEnvelope): Promise<{ id: string; actionId: string; status: string }> { const value = { actionId: action.actionId, workspaceId: action.workspaceId, status: "pending", receiptIds: ["44444444-4444-4444-8444-444444444444"], latestReceipt: { status: "pending" } }; this.actions.set(action.actionId, value); return { id: action.actionId, actionId: action.actionId, status: "pending" }; }
  async status(actionId: string, workspaceId: string): Promise<ActionStatus | null> { const value = this.actions.get(actionId); return value?.workspaceId === workspaceId ? value : null; }
  async claim(): Promise<ClaimedAction | null> { return null; }
  async heartbeat(): Promise<boolean> { return false; }
  async complete(): Promise<boolean> { return false; }
  async fail(): Promise<string | null> { return null; }
}
test("HTTP edge requires HMAC, enqueues with 202, and binds status to workspace", async () => {
  const secret = "s".repeat(40); const repo = new FakeRepository(); const config = { port: 0, host: "127.0.0.1", internalSecret: secret, supabaseUrl: "https://example.invalid", supabaseServiceRoleKey: "unused", executorUrl: "", executorSecret: "", maxBodyBytes: 131072, replayWindowSeconds: 300, workerEnabled: false, workerIntervalMs: 1000 };
  const server = createControlEdgeServer({ config, repo, executor: {} as never }); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); assert.ok(address && typeof address === "object"); const base = `http://127.0.0.1:${address.port}`;
  const action = { schema: "blockwise.ops.action.v1", actionId: "11111111-1111-4111-8111-111111111112", idempotencyKey: "ops:http:1", workspaceId: "22222222-2222-4222-8222-222222222222", customerId: "22222222-2222-4222-8222-222222222222", actor: { operatorId: "33333333-3333-4333-8333-333333333333", role: "owner", aal: "aal2" }, target: { type: "billing", id: "22222222-2222-4222-8222-222222222222" }, action: "billing_reconcile", expectedVersion: 1, reason: "support request", createdAt: "2026-09-04T15:00:00.000Z", expiresAt: "2026-09-04T15:10:00.000Z", payload: {} };
  const body = JSON.stringify(action); const now = Math.floor(Date.now() / 1000).toString(); const headers = (path: string, method: string, content: string, nonce: string) => ({ "content-type": "application/json", "x-blockwise-timestamp": now, "x-blockwise-nonce": nonce, "x-blockwise-scope": "ops.write", "x-blockwise-signature": createHmac("sha256", secret).update(signingPayload(now, nonce, "ops.write", method, path, content)).digest("hex") });
  const accepted = await fetch(`${base}/v1/control/actions`, { method: "POST", headers: headers("/v1/control/actions", "POST", body, "httpnonce1"), body }); assert.equal(accepted.status, 202);
  const denied = await fetch(`${base}/v1/control/actions/${action.actionId}`, { headers: { "x-blockwise-workspace-id": "99999999-9999-4999-8999-999999999999", "x-blockwise-timestamp": now, "x-blockwise-nonce": "httpnonce2", "x-blockwise-scope": "ops.read", "x-blockwise-signature": createHmac("sha256", secret).update(signingPayload(now, "httpnonce2", "ops.read", "GET", `/v1/control/actions/${action.actionId}`, "")).digest("hex") } }); assert.equal(denied.status, 404);
  server.close();
});
