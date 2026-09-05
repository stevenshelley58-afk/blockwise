import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { buildProjectionEnvelope, mapProjectionForAdapter } from "../src/lib/ops/projection-contract.ts";
import { OPS_ACTION_CAPABILITIES, parseOpsAction } from "../src/lib/ops/action-contract.ts";
import { decodeOpsCursor, encodeOpsCursor, parseOpsLimit, readOpsCursor } from "../src/lib/ops/pagination.ts";

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
  const lifecycle = buildProjectionEnvelope({
    workspaceId: "workspace-1",
    provider: "mautic",
    aggregate: { type: "lifecycle", id: "profile-1" },
    operation: "upsert",
    source: { eventId: "lifecycle-1", version: 4 },
    payload: { profileId: "profile-1", stage: "active" },
  });
  assert.deepEqual(mapProjectionForAdapter(lifecycle).fields, { externalId: "workspace-1:profile-1", profileId: "profile-1", stage: "active", changedAt: undefined });
  assert.throws(() => mapProjectionForAdapter(buildProjectionEnvelope({ ...lifecycle, payload: { stage: "active" } })), /profileId/);

  assert.throws(() => buildProjectionEnvelope({
    workspaceId: "workspace-1",
    provider: "mautic",
    aggregate: { type: "enquiry", id: "enquiry-1" },
    operation: "upsert",
    source: { eventId: "invalid-1", version: 1 },
    payload: {},
  }), /incompatible/);
  assert.throws(() => mapProjectionForAdapter({
    ...contact,
    provider: "chatwoot",
    aggregate: { type: "lifecycle", id: "workspace-1" },
  }), /incompatible/);
});

test("bounded cursor and stale-version fencing are present in the service contract", () => {
  const source = readFileSync(operationsPath, "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/202609040002_customer_operations_hardening.sql", import.meta.url), "utf8");
  const projectionRepair = readFileSync(new URL("../supabase/migrations/202609040004_customer_operations_projection_identity.sql", import.meta.url), "utf8");
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
  assert.match(projectionRepair, /enquiry-association:' \|\| new\.id::text/);
  assert.doesNotMatch(projectionRepair, /new\.source_id/);
  assert.doesNotMatch(projectionRepair, /sourceEventId/);
});

test("operator action envelope is normalized, allowlisted, and capability-gated", () => {
  const base = {
    schema: "blockwise.ops.action.v1",
    actionId: "84444444-4444-4444-8444-444444444444",
    idempotencyKey: "ops:invite:1",
    workspaceId: "81111111-1111-4111-8111-111111111111",
    customerId: "81111111-1111-4111-8111-111111111111",
    actor: { operatorId: "82222222-2222-4222-8222-222222222222", role: "owner", aal: "aal2" },
    target: { type: "workspace", id: "81111111-1111-4111-8111-111111111111" },
    action: "team_invite",
    expectedVersion: 1,
    reason: "Invite requested by customer support",
    createdAt: "2026-09-04T00:00:00.000Z",
    expiresAt: "2026-09-04T01:00:00.000Z",
    payload: { email: "Owner@Example.Test", role: "member" },
  };
  const parsed = parseOpsAction(base);
  assert.equal(parsed.schema, "blockwise.ops.action.v1");
  assert.equal((parsed.payload as { email: string }).email, "owner@example.test");
  assert.equal(OPS_ACTION_CAPABILITIES.team_invite.capability, "available");
  assert.equal(OPS_ACTION_CAPABILITIES.team_suspend.capability, "unsupported");
  assert.equal(OPS_ACTION_CAPABILITIES.team_role_change.capability, "available");
  assert.equal(OPS_ACTION_CAPABILITIES.billing_portal_link.capability, "capability_required");
  assert.equal(Object.keys(OPS_ACTION_CAPABILITIES).length, 24);
  assert.throws(() => parseOpsAction({ ...base, schema: "blockwise.ops.action.v0" }), /schema is invalid/);
  assert.throws(() => parseOpsAction({ ...base, actor: { ...base.actor, aal: "aal1" } }), /AAL2/);
  assert.throws(() => parseOpsAction({ ...base, payload: { email: "a@example.test", role: "member", url: "https://example.test" } }), /allowlisted/);
  assert.deepEqual(parseOpsAction({ ...base, action: "consent_withdraw", target: { type: "profile", id: base.target.id }, payload: {} }).payload, {});
  assert.throws(() => parseOpsAction({ ...base, action: "consent_withdraw", target: { type: "profile", id: base.target.id }, payload: { topic: null } }), /allowlisted|topic/);
  assert.deepEqual(parseOpsAction({ ...base, action: "booking_reschedule", target: { type: "booking", id: base.target.id }, payload: { scheduledStartAt: "2026-09-04T01:00:00.000Z" } }).payload, { scheduledStartAt: "2026-09-04T01:00:00.000Z" });
  assert.throws(() => parseOpsAction({ ...base, action: "booking_reschedule", target: { type: "booking", id: base.target.id }, payload: { scheduledStartAt: "2026-09-04T01:00:00.000Z", unexpected: "field" } }), /allowlisted/);
  assert.throws(() => parseOpsAction({ ...base, action: "enquiry_reply", target: { type: "enquiry", id: base.target.id }, payload: { body: "x".repeat(4001) } }), /too long/);
  assert.throws(() => parseOpsAction({ ...base, expiresAt: "2026-09-05T01:00:00.000Z" }), /expiry/);
});

test("ops pagination distinguishes absent values and validates durable cursors", () => {
  assert.equal(parseOpsLimit(new URLSearchParams()), 50);
  assert.equal(parseOpsLimit(new URLSearchParams("pageSize=25")), 25);
  assert.equal(parseOpsLimit(new URLSearchParams("limit=250")), 100);
  assert.throws(() => parseOpsLimit(new URLSearchParams("limit=")), /invalid_limit/);
  assert.throws(() => parseOpsLimit(new URLSearchParams("pageSize=%20%20")), /invalid_limit/);
  assert.equal(readOpsCursor(new URLSearchParams()), undefined);
  assert.equal(readOpsCursor(new URLSearchParams("cursor=")), "");
  assert.throws(() => decodeOpsCursor(""), /invalid operations cursor/);
  assert.deepEqual(decodeOpsCursor(encodeOpsCursor({ updatedAt: "2026-09-04T00:00:00+00:00", id: "84444444-4444-4444-8444-444444444444" })), { updatedAt: "2026-09-04T00:00:00.000Z", id: "84444444-4444-4444-8444-444444444444" });
  const encoded = encodeOpsCursor({ updatedAt: "2026-09-04T00:00:00.000Z", id: "84444444-4444-4444-8444-444444444444" });
  assert.deepEqual(decodeOpsCursor(encoded), { updatedAt: "2026-09-04T00:00:00.000Z", id: "84444444-4444-4444-8444-444444444444" });
  assert.throws(() => decodeOpsCursor(Buffer.from(JSON.stringify({ updatedAt: "not-a-date", id: "84444444-4444-4444-8444-444444444444" })).toString("base64url")), /invalid operations cursor/);
  assert.throws(() => decodeOpsCursor(Buffer.from(JSON.stringify({ updatedAt: "2026-09-04T00:00:00.000Z", id: "crm-1" })).toString("base64url")), /invalid operations cursor/);
  assert.throws(() => decodeOpsCursor(`${encoded}=`), /invalid operations cursor/);
  assert.throws(() => decodeOpsCursor(encoded.replace(/[A-Za-z0-9]/, "+")), /invalid operations cursor/);
  assert.throws(() => decodeOpsCursor(`${encoded}junk`), /invalid operations cursor/);
});
