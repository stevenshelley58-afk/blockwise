import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = "supabase/migrations/202609040018_customer_operations_management_actions.sql";
const route = "src/app/api/internal/customer-ops/actions/route.ts";

test("customer operations management mutation is service-only and tenant/CAS bound", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /security definer set search_path = ''/);
  assert.match(sql, /status='processing'/);
  assert.match(sql, /workspace_id=p_workspace_id/);
  assert.match(sql, /ops_version <> p_expected_version/);
  assert.match(sql, /insert into public\.audit_logs/);
  assert.match(sql, /revoke all on function public\.execute_ops_customer_action/);
  assert.match(sql, /grant execute on function public\.execute_ops_customer_action[^\n]+service_role/);
});

test("provider actions are excluded from the web/control-edge executor", async () => {
  const source = await readFile(route, "utf8");
  assert.match(source, /const ACTIONS = new Set/);
  assert.doesNotMatch(source, /const ACTIONS = new Set\([^)]*enquiry_close/);
});

test("Chatwoot action lane is worker-only and action-bound", async () => {
  const worker = await readFile("worker/ops-actions.ts", "utf8");
  assert.match(worker, /claim_ops_provider_action/);
  assert.match(worker, /CHATWOOT_API_TOKEN_FILE/);
  assert.match(worker, /resolve_ops_provider_action_identity/);
  assert.match(worker, /blockwise_external_id/);
  assert.match(worker, /idempotency-key/);
  assert.match(worker, /complete_ops_action/);
  assert.match(worker, /fail_ops_action/);
  assert.match(worker, /enquiry_reopen/);
});
