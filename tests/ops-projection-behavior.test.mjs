import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runGlobalProjectionOnce, runOpsProjectionOnce } from "../worker/ops-projection.ts";
import { publishOpsBundle } from "../worker/ops-bundle.ts";

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
  Object.assign(process.env, { CHATWOOT_BASE_URL: "https://chatwoot.example.test", CHATWOOT_API_TOKEN_FILE: tokenPath, CHATWOOT_ACCOUNT_ID: "7", CHATWOOT_ENQUIRY_INBOX_ID: "8", CHATWOOT_ENQUIRY_SOURCE_ID: "source-8", BLOCKWISE_OPS_CORRELATION_KEY_FILE: keyPath });
  const { supabase, calls } = fixture(); const urls = [];
  const fetchImpl = async (url, init) => { urls.push([String(url), init.method, JSON.parse(init.body ?? "{}"), init.headers]); if (String(url).includes("/contacts/search")) return response({ payload: [] }); if (String(url).includes("/contacts") && init.method === "POST") return response({ payload: { id: 10 } }); if (String(url).includes("/conversations?") ) return response({ payload: [] }); if (String(url).endsWith("/conversations") && init.method === "POST") return response({ id: 20 }); return response({ ok: true }); };
  assert.equal(await runOpsProjectionOnce(supabase, fetchImpl), true);
  assert.deepEqual(urls.map((item) => [item[1], new URL(item[0]).pathname]), [["GET", "/api/v1/accounts/7/contacts/search"], ["POST", "/api/v1/accounts/7/contacts"], ["GET", "/api/v1/accounts/7/conversations"], ["POST", "/api/v1/accounts/7/conversations"], ["GET", "/api/v1/accounts/7/conversations/20/messages"], ["POST", "/api/v1/accounts/7/conversations/20/messages"], ["PATCH", "/api/v1/accounts/7/conversations/20"]]);
  assert.equal(urls[0][3].api_access_token, "test-token"); assert.equal(urls[0][3].authorization, undefined);
  assert.equal(urls.find((item) => item[1] === "POST" && item[0].endsWith("/conversations"))[2].source_id, "source-8");
  assert.equal(calls.some(([name]) => name === "upsert_ops_provider_snapshot"), true); assert.equal(calls.some(([name]) => name === "complete_ops_projection"), true);
});

test("provider 429 is retried through the durable fail RPC and never settles", async () => {
  const secretRoot = mkdtempSync(join(tmpdir(), "ops-worker-")); const tokenPath = join(secretRoot, "token"); const keyPath = join(secretRoot, "key"); writeFileSync(tokenPath, "test-token\n", { mode: 0o600 }); writeFileSync(keyPath, "test-correlation-key\n", { mode: 0o600 }); Object.assign(process.env, { CHATWOOT_BASE_URL: "https://chatwoot.example.test", CHATWOOT_API_TOKEN_FILE: tokenPath, CHATWOOT_ACCOUNT_ID: "7", CHATWOOT_ENQUIRY_INBOX_ID: "8", BLOCKWISE_OPS_CORRELATION_KEY_FILE: keyPath });
  const { supabase, calls } = fixture(); const fetchImpl = async () => response({}, 429); await runOpsProjectionOnce(supabase, fetchImpl); assert.equal(calls.some(([name]) => name === "fail_ops_projection"), true); assert.equal(calls.some(([name]) => name === "complete_ops_projection"), false);
});

test("Frank bundle publication preserves nested scope and pointer compatibility", () => {
  const root = mkdtempSync(join(tmpdir(), "ops-bundle-"));
  const result = publishOpsBundle(root, {
    project_id: "blockwise",
    source_revision: "worker-test",
    source_receipt_ids: ["receipt:ops/test-run"],
    workspace_ids: [workspace],
    fresh_until: new Date(Date.now() + 60_000).toISOString(),
    projections: { customers: [{ id: workspace, workspace_id: workspace, name: "Test" }] },
  });
  const pointer = JSON.parse(readFileSync(join(root, "current.json"), "utf8"));
  const envelope = JSON.parse(readFileSync(join(root, "generations", result.generation, "customers.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(root, "generations", result.generation, "manifest.json"), "utf8"));
  assert.deepEqual(pointer, { schema: "schema://frank.ops-pointer/v1", version: 1, generation: result.generation, publication_receipt_id: result.receiptId });
  assert.deepEqual(envelope.source_scope, { project_id: "blockwise", workspace_ids: [workspace], system: "customers" });
  assert.equal(envelope.publication_receipt_id, result.receiptId);
  assert.match(manifest.bundle_sha256, /^[0-9a-f]{64}$/u);
  assert.match(manifest.files["customers.json"], /^[0-9a-f]{64}$/u);
  assert.match(manifest.pointer_sha256, /^[0-9a-f]{64}$/u);
});

test("global lead delivery settles its ledger and publishes a Frank generation", async () => {
  const secretRoot = mkdtempSync(join(tmpdir(), "ops-global-")); const tokenPath = join(secretRoot, "chatwoot-token"); const keyPath = join(secretRoot, "correlation-key"); const bundleRoot = join(secretRoot, "bundle");
  writeFileSync(tokenPath, "test-token\n", { mode: 0o600 }); writeFileSync(keyPath, "test-correlation-key\n", { mode: 0o600 });
  Object.assign(process.env, { CHATWOOT_BASE_URL: "https://chatwoot.example.test", CHATWOOT_API_TOKEN_FILE: tokenPath, CHATWOOT_GLOBAL_ACCOUNT_ID: "77", CHATWOOT_GLOBAL_INBOX_ID: "88", CHATWOOT_GLOBAL_SOURCE_ID: "source-88", BLOCKWISE_OPS_CORRELATION_KEY_FILE: keyPath, HERMES_OPS_PROJECTION_ROOT: bundleRoot, BLOCKWISE_WORKER_REVISION: "a".repeat(40) });
  const calls = []; const leadId = "a1111111-1111-4111-8111-111111111111";
  const supabase = { rpc: async (name, args) => { calls.push([name, args]); if (name === "claim_ops_global_projection") return { data: [{ id: "b1111111-1111-4111-8111-111111111111", enquiry_id: leadId, source_version: 2, operation: "upsert", lease_token: "c1111111-1111-4111-8111-111111111111" }], error: null }; if (name === "resolve_global_ops_enquiry") return { data: { id: leadId, subject: "Demo", requester_email: "lead@example.test", requester_name: "Lead", message: "Hello" }, error: null }; if (name === "begin_ops_provider_operation") return { data: { state: "prepared" }, error: null }; if (name === "resolve_ops_frank_bundle") return { data: { project_id: "blockwise", source_revision: "ignored", source_receipt_ids: ["receipt:ops/global-lead"], workspace_ids: [workspace], fresh_until: new Date(Date.now() + 60_000).toISOString(), projections: {} }, error: null }; return { data: true, error: null }; } };
  const fetchImpl = async (url, init) => { if (String(url).includes("/contacts/search")) return response({ payload: [] }); if (String(url).includes("/contacts") && init.method === "POST") return response({ payload: { id: 10 } }); if (String(url).includes("/conversations?") ) return response({ payload: [] }); if (String(url).endsWith("/conversations") && init.method === "POST") return response({ id: 20 }); return response({ payload: [] }); };
  assert.equal(await runGlobalProjectionOnce(supabase, fetchImpl), true); assert.equal(calls.some(([name]) => name === "record_ops_provider_identifier"), true); assert.equal(calls.some(([name]) => name === "settle_ops_provider_operation"), true); assert.equal(calls.some(([name]) => name === "resolve_ops_frank_bundle"), true); assert.equal(calls.some(([name]) => name === "complete_ops_global_projection"), true);
});
