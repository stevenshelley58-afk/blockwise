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

test("control-edge executor exposes only the implemented management actions", async () => {
  const source = await readFile(route, "utf8");
  for (const action of ["enquiry_close", "enquiry_reply", "consent_grant", "consent_withdraw", "consent_unsubscribe", "suppression_add", "suppression_remove"]) {
    assert.match(source, new RegExp(action));
  }
  assert.match(source, /execute_ops_customer_action/);
});
