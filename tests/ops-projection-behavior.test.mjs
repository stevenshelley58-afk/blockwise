import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runOpsProjectionOnce } from "../worker/ops-projection.ts";

const workspace = "81111111-1111-4111-8111-111111111111";
function fixture(provider = "chatwoot", aggregateType = "enquiry") {
  const calls = [];
  const row = { id: "91111111-1111-4111-8111-111111111111", workspace_id: workspace, provider, aggregate_type: aggregateType, aggregate_id: "lead-1", operation: "upsert", source_event_id: "lead-event-1", source_version: 1, payload: {}, attempts: 1, max_attempts: 8, lease_token: "92222222-2222-4222-8222-222222222222" };
  const rpc = async (name, args) => { calls.push([name, args]); if (name === "claim_ops_projection") return { data: [row], error: null }; if (name === "resolve_ops_projection_data") return { data: { subject: "Need a demo", status: "open", requesterEmail: "lead@example.test", requesterName: "Lead Person", message: "Please call me" }, error: null }; if (name === "begin_ops_provider_operation") return { data: {}, error: null }; return { data: true, error: null }; };
  return { supabase: { rpc }, calls };
}
function response(body, status = 200) { return { status, ok: status >= 200 && status < 300, json: async () => body }; }

test("Chatwoot adapter performs deterministic contact, conversation, message and status sequence", async () => {
  const secretRoot = mkdtempSync(join(tmpdir(), "ops-worker-")); const tokenPath = join(secretRoot, "chatwoot-token"); const keyPath = join(secretRoot, "correlation-key"); writeFileSync(tokenPath, "test-token\n", { mode: 0o600 }); writeFileSync(keyPath, "test-correlation-key\n", { mode: 0o600 });
  Object.assign(process.env, { CHATWOOT_BASE_URL: "https://chatwoot.example.test", CHATWOOT_API_TOKEN_FILE: tokenPath, CHATWOOT_ACCOUNT_ID: "7", CHATWOOT_ENQUIRY_INBOX_ID: "8", BLOCKWISE_OPS_CORRELATION_KEY_FILE: keyPath });
  const { supabase, calls } = fixture(); const urls = [];
  const fetchImpl = async (url, init) => { urls.push([String(url), init.method, JSON.parse(init.body ?? "{}")]); if (String(url).includes("/contacts/search")) return response({ payload: [] }); if (String(url).includes("/contacts") && init.method === "POST") return response({ payload: { id: 10 } }); if (String(url).includes("/conversations?") ) return response({ payload: [] }); if (String(url).endsWith("/conversations") && init.method === "POST") return response({ id: 20 }); return response({ ok: true }); };
  assert.equal(await runOpsProjectionOnce(supabase, fetchImpl), true);
  assert.deepEqual(urls.map((item) => [item[1], new URL(item[0]).pathname]), [["GET", "/api/v1/accounts/7/contacts/search"], ["POST", "/api/v1/accounts/7/contacts"], ["GET", "/api/v1/accounts/7/conversations"], ["POST", "/api/v1/accounts/7/conversations"], ["GET", "/api/v1/accounts/7/conversations/20/messages"], ["POST", "/api/v1/accounts/7/conversations/20/messages"], ["PATCH", "/api/v1/accounts/7/conversations/20"]]);
  assert.equal(calls.some(([name]) => name === "upsert_ops_provider_snapshot"), true); assert.equal(calls.some(([name]) => name === "complete_ops_projection"), true);
});

test("provider 429 is retried through the durable fail RPC and never settles", async () => {
  const secretRoot = mkdtempSync(join(tmpdir(), "ops-worker-")); const tokenPath = join(secretRoot, "token"); const keyPath = join(secretRoot, "key"); writeFileSync(tokenPath, "test-token\n", { mode: 0o600 }); writeFileSync(keyPath, "test-correlation-key\n", { mode: 0o600 }); Object.assign(process.env, { CHATWOOT_BASE_URL: "https://chatwoot.example.test", CHATWOOT_API_TOKEN_FILE: tokenPath, CHATWOOT_ACCOUNT_ID: "7", CHATWOOT_ENQUIRY_INBOX_ID: "8", BLOCKWISE_OPS_CORRELATION_KEY_FILE: keyPath });
  const { supabase, calls } = fixture(); const fetchImpl = async () => response({}, 429); await runOpsProjectionOnce(supabase, fetchImpl); assert.equal(calls.some(([name]) => name === "fail_ops_projection"), true); assert.equal(calls.some(([name]) => name === "complete_ops_projection"), false);
});
