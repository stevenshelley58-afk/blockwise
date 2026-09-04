import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const text = (path) => readFileSync(new URL(path, root), "utf8");

test("product allowlist and rollback procedure cover the ops contract", () => {
  const allowlist = text("infra/product/product-migrations.txt");
  assert.match(allowlist, /202609040001_customer_operations_ops_outbox\.sql/);
  assert.match(allowlist, /202609040002_customer_operations_hardening\.sql/);
  assert.match(allowlist, /202609040003_customer_operations_provider_snapshots\.sql/);
  assert.match(allowlist, /202609040004_customer_operations_projection_identity\.sql/);
  assert.match(allowlist, /202609040005_customer_operations_provider_matrix_privileges\.sql/);
  const rollback = text("scripts/ops/rollback-customer-operations.sql");
  assert.match(rollback, /ROLLBACK_CUSTOMER_OPERATIONS/);
  assert.match(rollback, /customer_operations_tables_archive/);
  assert.match(rollback, /ops_provider_snapshots/);
  assert.match(rollback, /rollback_run_id/);
  assert.match(rollback, /where table_name = v_table and run_id =/);
  assert.match(rollback, /'email_suppressions', id::text, to_jsonb\(s\)/);
  assert.match(rollback, /'email_suppressions'\]\)/);
  assert.match(rollback, /lock table public\.audit_logs/);
  assert.match(rollback, /in access exclusive mode/);
});

test("ops surface is service-only and provider-free", () => {
  const route = text("src/app/api/internal/ops/[...path]/route.ts");
  assert.match(route, /verifyInternalRequest/);
  assert.match(route, /ops\.read/);
  assert.match(route, /blockwise\.ops\.read\.v1/);
  assert.match(route, /source_receipt_ids/);
  assert.match(route, /invalid_cursor/);
  assert.match(route, /invalid_limit/);
  assert.match(route, /parseOpsLimit/);
  assert.match(route, /readOpsCursor/);
  assert.match(route, /Cache-Control.*no-store/);
  assert.doesNotMatch(route, /from\s+["'](?:mautic|chatwoot|stripe)["']/i);
  assert.equal(existsSync(new URL("src/lib/ops/internal-auth.ts", root)), false);
});

test("projection adapter and database enforce the provider aggregate matrix", () => {
  const contract = text("src/lib/ops/projection-contract.ts");
  const migration = text("supabase/migrations/202609040005_customer_operations_provider_matrix_privileges.sql");
  assert.match(contract, /mautic: \["contact", "lifecycle"\]/);
  assert.match(contract, /chatwoot: \["enquiry", "support"\]/);
  assert.match(contract, /provider and aggregate type are incompatible/);
  assert.match(migration, /ops_projection_provider_aggregate_check/);
  assert.match(migration, /mautic.*contact.*lifecycle/s);
  assert.match(migration, /chatwoot.*enquiry.*support/s);
  assert.match(migration, /revoke insert, update, delete on public\.ops_projection_outbox from service_role/i);
  assert.match(migration, /grant select on public\.ops_projection_outbox to service_role/i);
});
