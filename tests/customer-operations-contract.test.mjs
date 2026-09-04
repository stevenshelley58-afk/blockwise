import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const text = (path) => readFileSync(new URL(path, root), "utf8");

test("product allowlist and rollback procedure cover the ops contract", () => {
  const allowlist = text("infra/product/product-migrations.txt");
  assert.match(allowlist, /202609040001_customer_operations_ops_outbox\.sql/);
  assert.match(allowlist, /202609040002_customer_operations_hardening\.sql/);
  const rollback = text("scripts/ops/rollback-customer-operations.sql");
  assert.match(rollback, /ROLLBACK_CUSTOMER_OPERATIONS/);
  assert.match(rollback, /customer_operations_outbox_archive/);
});

test("ops surface is service-only and provider-free", () => {
  const route = text("src/app/api/internal/ops/[...path]/route.ts");
  assert.match(route, /verifyInternalRequest/);
  assert.match(route, /ops\.read/);
  assert.doesNotMatch(route, /from\s+["'](?:mautic|chatwoot|stripe)["']/i);
  assert.equal(existsSync(new URL("src/lib/ops/internal-auth.ts", root)), false);
});
