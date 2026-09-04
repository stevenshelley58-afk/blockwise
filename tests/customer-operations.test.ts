import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { signInternalOpsRequest, verifyInternalOpsSignature } from "../src/lib/ops/internal-auth.ts";

test("internal ops signatures bind method, path, body, and expire", () => {
  const input = {
    method: "GET",
    pathname: "/api/internal/ops/customers",
    body: "",
    secret: "ops-test-secret",
    timestamp: 1_800_000_000,
  };
  const signature = signInternalOpsRequest(input);
  assert.deepEqual(verifyInternalOpsSignature({ ...input, signature, timestamp: String(input.timestamp), nowSeconds: input.timestamp }), { ok: true });
  assert.equal(verifyInternalOpsSignature({ ...input, signature, pathname: "/api/internal/ops/customers/other", timestamp: String(input.timestamp), nowSeconds: input.timestamp }).ok, false);
  assert.deepEqual(verifyInternalOpsSignature({ ...input, signature, timestamp: String(input.timestamp), nowSeconds: input.timestamp + 301 }), { ok: false, error: "expired" });
});

test("signature contract is independently reproducible by Hermes", () => {
  const timestamp = 1_800_000_000;
  const canonical = `${timestamp}.GET./api/internal/ops/customers.`;
  const signature = createHmac("sha256", "ops-test-secret").update(canonical).digest("hex");
  assert.deepEqual(verifyInternalOpsSignature({ method: "GET", pathname: "/api/internal/ops/customers", body: "", secret: "ops-test-secret", timestamp: String(timestamp), signature, nowSeconds: timestamp }), { ok: true });
});

test("ops route and migration keep provider work out of request paths", () => {
  const route = readFileSync(new URL("../src/app/api/internal/ops/[...path]/route.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/202609040001_customer_operations_ops_outbox.sql", import.meta.url), "utf8");
  assert.match(route, /verifyInternalOpsSignature/);
  assert.match(route, /Cache-Control.*no-store/);
  assert.doesNotMatch(route, /from ["'](?:mautic|chatwoot|stripe)/i);
  assert.match(migration, /enqueue_ops_projection/);
  assert.match(migration, /claim_ops_projection/);
  assert.match(migration, /can_send_marketing/);
  assert.match(migration, /pg_advisory_xact_lock/);
});
