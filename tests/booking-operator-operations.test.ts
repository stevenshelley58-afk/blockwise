import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildHostedBookingUrl,
  parseCalcomWebhook,
  signBookingInvitation,
  verifyBookingInvitationToken,
  verifyCalcomWebhook,
} from "../src/lib/booking/provider.ts";
import {
  OperatorCustomerActionError,
  runOperatorCustomerAction,
} from "../src/lib/operator/customers.ts";
import { assertBookingWorkspaceBinding } from "../src/lib/booking/service.ts";

const migrationPath = "supabase/migrations/20260727024000_onboarding_booking_foundation.sql";
const hardeningMigrationPath = "supabase/migrations/20260903020000_booking_provider_contract_hardening.sql";

test("booking provider apply is atomic and conditionally rejects stale transitions", () => {
  const sql = readFileSync(hardeningMigrationPath, "utf8");
  assert.match(sql, /add column if not exists last_provider_occurred_at timestamptz/i);
  assert.match(sql, /create or replace function public\.apply_booking_provider_event/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /p_occurred_at <= coalesce\(/i);
  assert.match(sql, /return query select 'stale'/i);
  assert.match(sql, /return query select 'applied'/i);
  assert.match(sql, /v_booking\.workspace_id <> p_workspace_id/i);
});

test("booking migration is workspace-scoped, provider-neutral, idempotent, and reminder-ready", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(sql, /create table public\.workspace_onboarding_bookings/i);
  assert.match(sql, /provider_booking_id text/i);
  assert.match(sql, /unique index workspace_onboarding_bookings_provider_id_key/i);
  assert.match(sql, /unique index workspace_onboarding_bookings_mutation_key/i);
  assert.match(sql, /create table public\.booking_webhook_events/i);
  assert.match(sql, /unique \(provider, provider_event_id\)/i);
  assert.match(sql, /claim_booking_webhook_event/i);
  assert.match(sql, /attempt_count = receipt\.attempt_count \+ 1/i);
  assert.match(sql, /receipt\.status = 'failed'/i);
  assert.match(sql, /receipt\.lease_expires_at <= now\(\)/i);
  assert.match(sql, /and lease_token = p_lease_token/i);
  assert.match(sql, /reminder_24h_due_at/i);
  assert.match(sql, /reminder_pre_session_due_at/i);
  assert.match(sql, /private\.is_operator\(\) or private\.is_workspace_member\(workspace_id\)/i);
  assert.match(sql, /revoke all on public\.booking_webhook_events from public, anon, authenticated/i);
});

test("market adapter uses the configured hosted event without provider API calls", () => {
  const invitationId = "00000000-0000-4000-8000-000000000011";
  const workspaceId = "00000000-0000-4000-8000-000000000001";
  const env = {
    ...process.env,
    BOOKING_PROVIDER: "calcom",
    CALCOM_ONBOARDING_URL_US: "https://cal.com/blockwise/us-onboarding",
    BOOKING_INVITATION_SECRET: "test-invitation-secret",
  };
  const url = new URL(buildHostedBookingUrl({
    market: "US",
    invitationId,
    env,
  }));
  assert.equal(url.origin + url.pathname, "https://cal.com/blockwise/us-onboarding");
  assert.equal(url.toString().includes(workspaceId), false);
  assert.equal(
    verifyBookingInvitationToken(url.searchParams.get("metadata[invitation]"), env),
    invitationId,
  );
});

test("Cal.com webhook verification and neutral event parsing preserve workspace state", () => {
  const invitationId = "00000000-0000-4000-8000-000000000011";
  const invitationEnv = {
    ...process.env,
    BOOKING_INVITATION_SECRET: "test-invitation-secret",
  };
  const invitationToken = signBookingInvitation(invitationId, invitationEnv);
  const raw = {
    triggerEvent: "BOOKING_RESCHEDULED",
    createdAt: "2026-07-27T05:00:00.000Z",
    payload: {
      uid: "booking-123",
      eventTypeId: 42,
      startTime: "2026-07-29T02:00:00.000Z",
      endTime: "2026-07-29T02:30:00.000Z",
      metadata: {
        invitation: invitationToken,
        workspaceId: "00000000-0000-4000-8000-000000000099",
      },
      attendees: [{ email: "owner@example.com", name: "Owner" }],
      rescheduleUrl: "https://cal.com/reschedule/booking-123",
    },
  };
  const body = JSON.stringify(raw);
  const signature = createHmac("sha256", "test-secret").update(body).digest("hex");
  assert.equal(verifyCalcomWebhook({ rawBody: body, signature, secret: "test-secret" }), true);
  assert.equal(verifyCalcomWebhook({ rawBody: body, signature: "0".repeat(64), secret: "test-secret" }), false);

  const event = parseCalcomWebhook({ raw, providerEventId: "event-123" });
  assert.equal(event.state, "rescheduled");
  assert.equal(event.providerBookingId, "booking-123");
  assert.equal(event.invitationToken, invitationToken);
  assert.equal("workspaceId" in event, false);
  assert.equal(event.customerEmail, "owner@example.com");
});

test("signed invitations reject tampering and provider bookings cannot cross workspace boundaries", () => {
  const invitationId = "00000000-0000-4000-8000-000000000011";
  const env = {
    ...process.env,
    BOOKING_INVITATION_SECRET: "test-invitation-secret",
  };
  const token = signBookingInvitation(invitationId, env);
  assert.equal(verifyBookingInvitationToken(token, env), invitationId);
  assert.equal(verifyBookingInvitationToken(`${invitationId}.${"0".repeat(64)}`, env), null);
  assert.doesNotThrow(() => assertBookingWorkspaceBinding(
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000001",
  ));
  assert.throws(
    () => assertBookingWorkspaceBinding(
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000099",
    ),
    /already bound to another workspace/,
  );
});

test("failed and stale webhook receipts are reclaimable under a new attempt lease", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(
    sql,
    /where receipt\.status = 'failed'\s+or \(receipt\.status = 'processing' and receipt\.lease_expires_at <= now\(\)\)/i,
  );
  assert.match(sql, /attempt_count = receipt\.attempt_count \+ 1/i);
  assert.match(sql, /lease_token = excluded\.lease_token/i);
  assert.match(sql, /status = 'processing'[\s\S]*and lease_token = p_lease_token/i);
  assert.doesNotMatch(sql, /on conflict \(provider, provider_event_id\) do nothing/i);
});

test("operator customer action route guards before creating a service client", () => {
  const source = readFileSync(
    "src/app/api/operator/customers/[workspaceId]/actions/route.ts",
    "utf8",
  );
  const guard = source.indexOf("requireOperator()");
  const service = source.indexOf("createSupabaseServiceClient()");
  assert.ok(guard >= 0, "operator guard is required");
  assert.ok(service > guard, "service-role access must be created only after operator authorization");
});

test("credit adjustments require a reason and produce an attributed audit event", async () => {
  const auditRows: Record<string, unknown>[] = [];
  let rpcCalls = 0;
  const service = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls += 1;
      assert.equal(name, "adjust_workspace_credits");
      assert.equal(args.p_reason, "service recovery");
      return {
        data: [{ wallet_id: "wallet-1", credits_granted: 110, credits_remaining: 70 }],
        error: null,
      };
    },
    from: (table: string) => {
      assert.equal(table, "audit_logs");
      return {
        insert: async (row: Record<string, unknown>) => {
          auditRows.push(row);
          return { error: null };
        },
      };
    },
  };

  await runOperatorCustomerAction({
    workspaceId: "00000000-0000-4000-8000-000000000001",
    operatorProfileId: "00000000-0000-4000-8000-000000000099",
    action: "adjust_credits",
    mutationId: "mutation-1",
    reason: "service recovery",
    creditDelta: 10,
    serviceSupabase: service as never,
  });
  assert.equal(rpcCalls, 1);
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0]?.action, "operator.customer.adjust_credits");
  assert.equal(auditRows[0]?.actor_profile_id, "00000000-0000-4000-8000-000000000099");
  assert.match(String(auditRows[0]?.correlation_id), /^operator:/);

  await assert.rejects(
    runOperatorCustomerAction({
      workspaceId: "00000000-0000-4000-8000-000000000001",
      operatorProfileId: "00000000-0000-4000-8000-000000000099",
      action: "adjust_credits",
      mutationId: "mutation-2",
      reason: " ",
      creditDelta: 10,
      serviceSupabase: service as never,
    }),
    (error: unknown) => error instanceof OperatorCustomerActionError && error.status === 400,
  );
  assert.equal(rpcCalls, 1);
});
