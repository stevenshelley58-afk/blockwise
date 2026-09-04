import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const worker = readFileSync(new URL("worker/ops-projection.ts", root), "utf8");
const migration = readFileSync(new URL("supabase/migrations/202609040006_customer_operations_runtime_resolution.sql", root), "utf8");

test("projection worker is provider-neutral and fail-closed", () => {
  assert.match(worker, /claim_ops_projection/);
  assert.match(worker, /heartbeat_ops_projection/);
  assert.match(worker, /complete_ops_projection/);
  assert.match(worker, /fail_ops_projection/);
  assert.match(worker, /resolve_ops_projection_data/);
  assert.match(worker, /redirect: "error"/);
  assert.match(worker, /idempotency-key/);
  assert.match(worker, /must use HTTPS/);
  assert.match(worker, /permissions are too broad/);
  assert.match(worker, /providerRecordSuffix/);
  assert.doesNotMatch(worker, /console\.log\(.*token/i);
});

test("runtime resolution is service-only and never infers a global enquiry", () => {
  assert.match(migration, /resolve_ops_projection_data/);
  assert.match(migration, /revoke all on function public\.resolve_ops_projection_data/);
  assert.match(migration, /e\.workspace_id = p_workspace_id/);
  assert.match(migration, /no email-based inference/);
  assert.match(migration, /grant execute on function public\.resolve_ops_projection_data.*service_role/s);
});
