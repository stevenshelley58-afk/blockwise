import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  deriveAuthoritativeMilestones,
  resolveCustomerActivation,
} from "../src/lib/activation/customer-activation.ts";
import { bootstrapVerifiedTrialWorkspace } from "../src/lib/auth/verified-workspace-bootstrap.ts";
import {
  refundWorkspaceCreditReservation,
  reserveWorkspaceCredits,
  settleWorkspaceCreditReservation,
} from "../src/lib/credits/workspace-credits.ts";

const migrationPath = "supabase/migrations/202607270002_progressive_activation_credit_ledger.sql";
const creditQualificationMigrationPath =
  "supabase/migrations/20260728085003_qualify_workspace_credit_wallet_updates.sql";
const verifiedBootstrapMigrationPath =
  "supabase/migrations/20260727029000_verified_trial_workspace_bootstrap.sql";

test("credit migration installs one workspace-scoped append-only authority", () => {
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /create table public\.workspace_credit_wallets/i);
  assert.match(sql, /create table public\.workspace_credit_ledger/i);
  assert.match(sql, /unique \(mutation_key\)/i);
  assert.match(sql, /workspace_credit_ledger is append-only/i);
  assert.match(sql, /private\.is_operator\(\) or private\.is_workspace_member\(workspace_id\)/i);
  assert.match(sql, /revoke all on public\.workspace_credit_ledger from public, anon, authenticated/i);

  for (const rpc of [
    "grant_workspace_credits",
    "reserve_workspace_credits",
    "settle_workspace_credit_reservation",
    "refund_workspace_credit_reservation",
    "adjust_workspace_credits",
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${rpc}`, "i"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${rpc}[\\s\\S]*to service_role`, "i"));
  }
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(p_workspace_id::text, 0\)\)/i);
  assert.match(sql, /billing_access_state'[\s\S]*\('payment_recovery', 'refunded', 'disputed'\)/i);
  assert.match(sql, /v_wallet\.entitlement_type = 'paid'[\s\S]*not in \('paid', 'canceled'\)/i);
  assert.doesNotMatch(sql, /drop function if exists public\.reserve_trial_ad_pack_credit\(uuid, uuid\)/i);
  assert.doesNotMatch(sql, /drop function if exists public\.refund_trial_ad_pack_credit\(uuid\)/i);
  assert.match(sql, /create or replace function public\.reserve_trial_ad_pack_credit[\s\S]*reserve_workspace_credits/i);
  assert.match(sql, /create or replace function public\.refund_trial_ad_pack_credit[\s\S]*refund_workspace_credit_reservation/i);
  assert.match(sql, /Remove them in a later[\s\S]*release/i);
  assert.match(sql, /get_trial_status[\s\S]*workspace_credit_wallets/i);
});

test("credit wallet mutations qualify columns that collide with RPC output names", () => {
  const sql = readFileSync(creditQualificationMigrationPath, "utf8");

  for (const rpc of [
    "grant_workspace_credits",
    "reserve_workspace_credits",
    "settle_workspace_credit_reservation",
    "refund_workspace_credit_reservation",
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${rpc}`, "i"));
  }
  assert.match(sql, /update public\.workspace_credit_wallets as w/i);
  assert.match(sql, /set credits_reserved = w\.credits_reserved \+ p_credits/i);
  assert.match(sql, /set credits_reserved = w\.credits_reserved - p_credits/i);
  assert.match(sql, /credits_consumed = w\.credits_consumed \+ p_credits/i);
  assert.match(sql, /set credits_expired = w\.credits_granted/i);
  assert.doesNotMatch(sql, /set credits_reserved = credits_reserved/i);
  assert.doesNotMatch(sql, /set credits_expired = credits_granted/i);
});

test("every credit replay binds its key to canonical request parameters", () => {
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /request_json jsonb not null/i);
  const ledgerInsertColumns = [
    ...sql.matchAll(/insert into public\.workspace_credit_ledger\s*\(([^)]*)\)/gi),
  ];
  assert.ok(ledgerInsertColumns.length > 0);
  for (const insert of ledgerInsertColumns) {
    assert.match(insert[1], /\brequest_json\b/i);
  }
  for (const operation of ["grant", "reservation", "settlement", "refund", "adjustment"]) {
    assert.match(
      sql,
      new RegExp(`Credit mutation key reuse does not match the original ${operation} request`, "i"),
    );
  }
  assert.match(sql, /'workspaceId', p_workspace_id[\s\S]*'walletId', v_reservation\.wallet_id[\s\S]*'reservationId', p_reservation_id[\s\S]*'credits', p_credits[\s\S]*'purpose'/i);
  assert.match(sql, /return query select\s*\(v_existing\.result_json->>'reservationId'\)::uuid/i);
  assert.match(sql, /return query select\s*\(v_existing\.result_json->>'walletId'\)::uuid/i);
});

test("trial backfill grants six renders and translates historical packs once", () => {
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /'trial:' \|\| w\.id::text/i);
  assert.match(sql, /least\(coalesce\(rl\.used_count, 0\) \* 2, 6\)/i);
  assert.match(sql, /verified_trials[\s\S]*coalesce\(u\.email_confirmed_at, u\.confirmed_at\) is not null/i);
  assert.match(sql, /trial_started_at = greatest\(coalesce\(w\.trial_started_at, v\.verified_at\), v\.verified_at\)/i);
  assert.match(sql, /where exists \([\s\S]*wm\.role = 'owner'[\s\S]*email_confirmed_at[\s\S]*is not null/i);
  assert.match(sql, /'trial-grant:' \|\| w\.workspace_id::text/i);
  assert.match(sql, /credits_granted,[\s\S]*credits_consumed,[\s\S]*credits_expired/i);
  assert.match(sql, /provision_workspace_activation_foundation/i);
  assert.match(sql, /new\.id, 'trial'[\s\S]*6/i);
});

test("activation storage is service-owned and timestamps cannot regress", () => {
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /create table public\.customer_activations/i);
  assert.match(sql, /customer_activations_monotonic/i);
  assert.match(sql, /new\.email_verified_at is null or new\.email_verified_at < old\.email_verified_at/i);
  assert.match(sql, /create or replace function public\.record_customer_activation_milestone/i);
  assert.match(sql, /coalesce\(first_ad_pack_generated_at, p_occurred_at\)/i);
  assert.match(sql, /revoke all on function public\.record_customer_activation_milestone[\s\S]*authenticated/i);
  assert.match(sql, /grant execute on function public\.record_customer_activation_milestone[\s\S]*service_role/i);
});

test("duplicate reservation keys reuse one reservation and partial render closure reaches zero", async () => {
  const reservations = new Map<string, {
    id: string;
    outstanding: number;
    remaining: number;
  }>();
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const service = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      const mutationKey = String(args.p_mutation_key);
      if (name === "reserve_workspace_credits") {
        const stored = reservations.get(mutationKey) ?? {
          id: "reservation-1",
          outstanding: Number(args.p_credits),
          remaining: 4,
        };
        reservations.set(mutationKey, stored);
        return {
          data: [{
            allowed: true,
            reason: "reserved",
            reservation_id: stored.id,
            wallet_id: "wallet-1",
            credits_reserved: 2,
            credits_remaining: 4,
            period_end: "2026-08-03T00:00:00.000Z",
            entitlement_type: "trial",
            mutation_key: mutationKey,
          }],
          error: null,
        };
      }

      const reservation = reservations.get("generation:one");
      assert.ok(reservation);
      reservation.outstanding -= Number(args.p_credits);
      if (name === "refund_workspace_credit_reservation") {
        reservation.remaining += Number(args.p_credits);
      }
      return {
        data: [{
          reservation_id: reservation.id,
          wallet_id: "wallet-1",
          credits_settled: name === "settle_workspace_credit_reservation" ? Number(args.p_credits) : null,
          credits_refunded: name === "refund_workspace_credit_reservation" ? Number(args.p_credits) : null,
          credits_outstanding: reservation.outstanding,
          credits_remaining: reservation.remaining,
          mutation_key: mutationKey,
        }],
        error: null,
      };
    },
  };

  const first = await reserveWorkspaceCredits({
    workspaceId: "workspace-1",
    actorProfileId: "user-1",
    credits: 2,
    mutationKey: "generation:one",
    purpose: "adstudio.feed_story_pack",
    serviceSupabase: service as never,
  });
  const duplicate = await reserveWorkspaceCredits({
    workspaceId: "workspace-1",
    actorProfileId: "user-1",
    credits: 2,
    mutationKey: "generation:one",
    purpose: "adstudio.feed_story_pack",
    serviceSupabase: service as never,
  });
  assert.equal(duplicate.reservationId, first.reservationId);
  assert.equal(reservations.size, 1);

  await settleWorkspaceCreditReservation({
    reservation: first,
    credits: 1,
    mutationKey: "generation:one:settle:4x5",
    serviceSupabase: service as never,
  });
  assert.equal(first.creditsOutstanding, 1);

  await refundWorkspaceCreditReservation({
    reservation: first,
    credits: 1,
    mutationKey: "generation:one:refund:9x16",
    reason: "story_render_failed",
    serviceSupabase: service as never,
  });
  assert.equal(first.creditsOutstanding, 0);
  assert.deepEqual(
    rpcCalls.map((call) => call.name),
    [
      "reserve_workspace_credits",
      "reserve_workspace_credits",
      "settle_workspace_credit_reservation",
      "refund_workspace_credit_reservation",
    ],
  );
});

test("activation derives repairs only from owning source rows", () => {
  const derived = deriveAuthoritativeMilestones({
    emailVerifiedAt: "2026-07-27T01:00:00.000Z",
    workspace: {
      country_code: "AU",
      updated_at: "2026-07-27T01:30:00.000Z",
      billing_checkout_completed_at: "2026-07-27T08:00:00.000Z",
      stripe_intro_invoice_paid_at: "2026-07-27T10:00:00.000Z",
      billing_access_state: "paid",
    },
    brandKits: [{
      source_url: "https://example.com",
      review_status: "approved",
      created_at: "2026-07-27T02:00:00.000Z",
      updated_at: "2026-07-27T03:00:00.000Z",
    }],
    campaigns: [{
      id: "campaign-1",
      template_key: "template-1",
      created_at: "2026-07-27T04:00:00.000Z",
    }],
    creatives: [{
      campaign_id: "campaign-1",
      render_status: "rendered",
      created_at: "2026-07-27T05:00:00.000Z",
    }],
    providerConnections: [{
      provider: "meta",
      status: "connected",
      updated_at: "2026-07-27T06:00:00.000Z",
    }],
    publishPlans: [{
      status: "paused_live",
      updated_at: "2026-07-27T09:00:00.000Z",
    }],
    bookings: [{
      status: "completed",
      booked_at: "2026-07-27T07:00:00.000Z",
      completed_at: "2026-07-27T11:00:00.000Z",
    }],
  });

  assert.equal(derived.website_submitted, "2026-07-27T02:00:00.000Z");
  assert.equal(derived.brand_pack_approved, "2026-07-27T03:00:00.000Z");
  assert.equal(derived.first_template_selected, "2026-07-27T04:00:00.000Z");
  assert.equal(derived.first_ad_pack_generated, "2026-07-27T05:00:00.000Z");
  assert.equal(derived.meta_connected, "2026-07-27T06:00:00.000Z");
  assert.equal(derived.checkout_completed, "2026-07-27T08:00:00.000Z");
  assert.equal(derived.first_campaign_live, "2026-07-27T09:00:00.000Z");
  assert.equal(derived.intro_invoice_paid, "2026-07-27T10:00:00.000Z");
  assert.equal(derived.onboarding_completed, "2026-07-27T11:00:00.000Z");
  assert.equal(derived.country_confirmed, "2026-07-27T01:30:00.000Z");
});

test("activation rollout defaults safely to the live home route while the flag is off", async () => {
  const previous = process.env.PROGRESSIVE_ONBOARDING_ENABLED;
  delete process.env.PROGRESSIVE_ONBOARDING_ENABLED;
  try {
    const result = await resolveCustomerActivation({ workspaceId: "workspace-1" });
    assert.equal(result.currentStage, "complete");
    assert.equal(result.resumePath, "/self-serve");
    assert.deepEqual(result.operatorBlockers, ["progressive_activation_disabled"]);
  } finally {
    if (previous === undefined) delete process.env.PROGRESSIVE_ONBOARDING_ENABLED;
    else process.env.PROGRESSIVE_ONBOARDING_ENABLED = previous;
  }
});

test("verified bootstrap disables auth insert provisioning and resumes idempotently", () => {
  const sql = readFileSync(verifiedBootstrapMigrationPath, "utf8");

  assert.match(sql, /drop trigger if exists on_trial_self_serve_signup on auth\.users/i);
  assert.match(sql, /handle_trial_self_serve_signup[\s\S]*return new/i);
  assert.match(sql, /drop trigger if exists provision_workspace_activation_foundation on public\.workspaces/i);
  assert.match(sql, /create or replace function public\.bootstrap_verified_trial_workspace/i);
  const verifiedIndex = sql.indexOf("v_verified_at is null");
  const workspaceInsertIndex = sql.indexOf("insert into public.workspaces");
  assert.ok(verifiedIndex > -1 && workspaceInsertIndex > verifiedIndex);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(p_verified_user_id::text, 0\)\)/i);
  assert.match(sql, /workspace_members wm[\s\S]*wm\.profile_id = p_verified_user_id[\s\S]*w\.mode = 'self_serve'/i);
  assert.match(sql, /not exists \([\s\S]*workspace_credit_wallets[\s\S]*entitlement_type = 'trial'/i);
  assert.match(sql, /grant_workspace_credits\([\s\S]*'trial'[\s\S]*6[\s\S]*'verified_workspace_bootstrap'/i);
  assert.match(sql, /record_customer_activation_milestone\([\s\S]*'email_verified'/i);
  assert.match(sql, /grant execute on function public\.bootstrap_verified_trial_workspace\(uuid\)[\s\S]*to service_role/i);
  assert.doesNotMatch(sql, /grant execute on function public\.bootstrap_verified_trial_workspace\(uuid\)[\s\S]*to authenticated/i);
});

test("verified bootstrap service rejects unconfirmed identities before its RPC", async () => {
  let called = false;
  const service = {
    rpc: async () => {
      called = true;
      return { data: null, error: null };
    },
  };

  await assert.rejects(
    bootstrapVerifiedTrialWorkspace({
      user: { id: "user-1", email: "person@example.com" },
      serviceSupabase: service as never,
    }),
    /Email verification is required/i,
  );
  assert.equal(called, false);

  const result = await bootstrapVerifiedTrialWorkspace({
    user: {
      id: "user-1",
      email: "person@example.com",
      email_confirmed_at: "2026-07-27T00:00:00.000Z",
    },
    serviceSupabase: {
      rpc: async (name: string, args: Record<string, unknown>) => {
        assert.equal(name, "bootstrap_verified_trial_workspace");
        assert.deepEqual(args, { p_verified_user_id: "user-1" });
        return {
          data: [{
            workspace_id: "workspace-1",
            created: true,
            resumed: false,
            eligible: true,
            trial_ends_at: "2026-08-03T00:00:00.000Z",
          }],
          error: null,
        };
      },
    } as never,
  });
  assert.equal(result.workspaceId, "workspace-1");
  assert.equal(result.created, true);
});
