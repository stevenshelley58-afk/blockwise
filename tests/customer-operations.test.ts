import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { buildProjectionEnvelope, mapProjectionForAdapter } from "../src/lib/ops/projection-contract.ts";

const routePath = new URL("../src/app/api/internal/ops/[...path]/route.ts", import.meta.url);
const operationsPath = new URL("../src/lib/ops/customer-operations.ts", import.meta.url);

test("ops route uses canonical scoped internal auth and has no duplicate verifier", () => {
  const route = readFileSync(routePath, "utf8");
  assert.match(route, /verifyInternalRequest\(request,\s*["']ops\.read["']/);
  assert.doesNotMatch(route, /verifyInternalOpsSignature/);
  assert.equal(existsSync(new URL("../src/lib/ops/internal-auth.ts", import.meta.url)), false);
  assert.match(route, /Cache-Control.*no-store/);
});

test("workspace detail never infers enquiries or mail delivery from shared email", () => {
  const source = readFileSync(operationsPath, "utf8");
  assert.doesNotMatch(source, /from\(["'](?:demo_requests|report_email_leads)["'][\s\S]{0,500}\.eq\(["']email/i);
  assert.match(source, /ops_enquiry_associations/);
  assert.match(source, /loadPublicEnquiries/);
});

test("projection contract is versioned and adapter mapping is provider-neutral", () => {
  const envelope = buildProjectionEnvelope({
    workspaceId: "workspace-1",
    provider: "chatwoot",
    aggregate: { type: "support", id: "booking-1" },
    operation: "upsert",
    source: { eventId: "booking-event-1", version: 2 },
    payload: { subject: "Onboarding", status: "open", metadata: { token: "must not persist" } as never },
  });
  assert.equal(envelope.contractVersion, "blockwise.ops.projection.v1");
  assert.equal(envelope.payload.workspaceId, "workspace-1");
  assert.equal((envelope.payload as Record<string, unknown>).metadata, undefined);
  assert.equal(mapProjectionForAdapter(envelope).provider, "chatwoot");
});

test("bounded cursor and stale-version fencing are present in the service contract", () => {
  const source = readFileSync(operationsPath, "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/202609040002_customer_operations_hardening.sql", import.meta.url), "utf8");
  assert.match(source, /nextCursor/);
  assert.match(source, /order\("id", \{ ascending: false \}\)/);
  assert.match(migration, /not exists \(select 1 from public\.ops_projection_outbox newer/);
  assert.match(migration, /email_suppressions/);
});
