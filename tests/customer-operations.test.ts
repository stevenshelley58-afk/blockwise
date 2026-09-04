import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { buildProjectionEnvelope, mapProjectionForAdapter } from "../src/lib/ops/projection-contract.ts";

const routePath = new URL("../src/app/api/internal/ops/[...path]/route.ts", import.meta.url);
const operationsPath = new URL("../src/lib/ops/customer-operations.ts", import.meta.url);

test("ops route uses canonical scoped internal auth and has no duplicate verifier", () => {
  const route = readFileSync(routePath, "utf8");
  assert.match(route, /verifyInternalRequest\(request,\s*["']ops\.read["']/);
  assert.match(route, /schema:\s*["']blockwise\.ops\.read\.v1["']/);
  assert.match(route, /project_id:\s*["']blockwise["']/);
  assert.match(route, /source_receipt_ids/);
  assert.match(route, /VERCEL_GIT_COMMIT_SHA/);
  assert.match(route, /generated_at/);
  assert.match(route, /fresh_until/);
  assert.doesNotMatch(route, /verifyInternalOpsSignature/);
  assert.equal(existsSync(new URL("../src/lib/ops/internal-auth.ts", import.meta.url)), false);
  assert.match(route, /Cache-Control.*no-store/);
});

test("workspace detail never infers enquiries or mail delivery from shared email", () => {
  const source = readFileSync(operationsPath, "utf8");
  assert.doesNotMatch(source, /from\(["'](?:demo_requests|report_email_leads)["'][\s\S]{0,500}\.eq\(["']email/i);
  assert.match(source, /ops_enquiry_associations/);
  assert.match(source, /loadPublicEnquiries/);
  assert.match(source, /\.is\("workspace_id", null\)/);
  assert.doesNotMatch(source, /external_id/);
  assert.doesNotMatch(source, /source_id/);
  assert.match(source, /billing_email_masked/);
  assert.doesNotMatch(source, /stripe_customer_id/);
  assert.doesNotMatch(source, /stripe_subscription_id/);
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
  const contact = buildProjectionEnvelope({
    workspaceId: "workspace-1",
    provider: "mautic",
    aggregate: { type: "contact", id: "profile-1" },
    operation: "upsert",
    source: { eventId: "activation-1", version: 3 },
    payload: { stage: "activated", bookingStatus: "confirmed", bookingSubject: "Onboarding booking" },
  });
  assert.deepEqual(mapProjectionForAdapter(contact).fields, {
    externalId: "workspace-1:profile-1",
    email: undefined,
    name: undefined,
    lifecycle: "activated",
    activationStage: "activated",
    bookingStatus: "confirmed",
    bookingSubject: "Onboarding booking",
  });
});

test("bounded cursor and stale-version fencing are present in the service contract", () => {
  const source = readFileSync(operationsPath, "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/202609040002_customer_operations_hardening.sql", import.meta.url), "utf8");
  const snapshots = readFileSync(new URL("../supabase/migrations/202609040003_customer_operations_provider_snapshots.sql", import.meta.url), "utf8");
  assert.match(source, /nextCursor/);
  assert.match(source, /OpsInvalidCursorError/);
  assert.match(source, /order\("id", \{ ascending: false \}\)/);
  assert.match(migration, /not exists \(select 1 from public\.ops_projection_outbox newer/);
  assert.match(migration, /email_suppressions/);
  assert.doesNotMatch(snapshots, /ops_enqueue_suppression_projection/);
  assert.doesNotMatch(snapshots, /aggregateId.*email/);
  assert.match(migration, /activation-contact/);
  assert.match(migration, /booking-contact/);
  assert.match(snapshots, /create table if not exists public\.ops_provider_snapshots/);
  assert.match(snapshots, /upsert_ops_provider_snapshot/);
  assert.match(snapshots, /associate_ops_enquiry/);
});
