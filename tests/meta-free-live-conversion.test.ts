import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  endTrialAfterFirstLiveCampaign,
  hasReusablePaymentMethod,
  validateFirstLiveCampaignBilling,
  type FirstLiveCampaignStripeGateway,
} from "../src/lib/billing/first-live-campaign.ts";
import {
  consumeMetaFreeLiveClaim,
  metaFreeLiveReservationKey,
  releaseMetaFreeLiveClaim,
  reserveMetaFreeLiveClaim,
  resolveMetaFreeLiveClaimIdentity,
} from "../src/lib/providers/meta-free-live-claims.ts";
import { applyThreeDayFreeCampaignSchedule } from "../src/lib/providers/meta-publish-worker.ts";
import type { MetaPublishPlan } from "../src/lib/providers/meta-execution.ts";

const migrationPath =
  "supabase/migrations/20260727023000_meta_free_live_claim_registry.sql";

test("free-live registry is globally unique, durable, service-only, and atomically idempotent", () => {
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /unique \(meta_business_id, meta_ad_account_id\)/i);
  assert.match(sql, /meta_free_live_claim_mutations[\s\S]*unique \(action, mutation_key\)/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on public\.meta_free_live_claims from public, anon, authenticated/i);
  assert.match(sql, /grant all on public\.meta_free_live_claims to service_role/i);
  assert.match(sql, /grant execute on function public\.reserve_meta_free_live_claim[\s\S]*to service_role/i);
  assert.doesNotMatch(sql, /workspace_id uuid references public\.workspaces/i);
  assert.match(sql, /record_customer_activation_milestone[\s\S]*'free_live_claim_consumed'/i);
});

test("claim service canonicalizes Meta IDs and sends stable reserve, consume, and release keys", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const service = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const action = name.split("_")[0];
      return {
        data: [{
          allowed: action === "reserve",
          consumed: action === "consume",
          released: action === "release",
          reason: action === "reserve" ? "reserved" : action === "consume" ? "consumed" : "released",
          claim_id: "claim-1",
          status: action === "consume" ? "consumed" : action === "reserve" ? "reserved" : "available",
          mutation_key: String(args.p_mutation_key),
        }],
        error: null,
      };
    },
  };
  const identity = resolveMetaFreeLiveClaimIdentity({
    metadata: { meta: { metaBusinessId: " Business_1 ", metaAdAccountId: "act_12345" } },
  });
  const reservationKey = metaFreeLiveReservationKey("plan-1");

  assert.deepEqual(identity, { metaBusinessId: "business_1", metaAdAccountId: "12345" });
  assert.equal((await reserveMetaFreeLiveClaim({
    service: service as never,
    workspaceId: "workspace-1",
    planId: "plan-1",
    identity,
    reservationKey,
    mutationKey: "reserve-attempt-1",
  })).allowed, true);
  assert.equal((await consumeMetaFreeLiveClaim({
    service: service as never,
    workspaceId: "workspace-1",
    planId: "plan-1",
    identity,
    reservationKey,
    mutationKey: "consume-plan-1",
  })).allowed, true);
  assert.equal((await releaseMetaFreeLiveClaim({
    service: service as never,
    workspaceId: "workspace-1",
    planId: "plan-1",
    identity,
    reservationKey,
    mutationKey: "release-attempt-1",
  })).allowed, true);
  assert.equal(calls[0].args.p_meta_ad_account_id, "12345");
  assert.equal(calls[0].args.p_reservation_key, reservationKey);
});

test("billing validation requires a trialing subscription with a reusable payment method", async () => {
  const gateway: FirstLiveCampaignStripeGateway = {
    retrieveSubscription: async () => ({
      id: "sub_123",
      status: "trialing",
      customer: { invoice_settings: { default_payment_method: { id: "pm_123" } } },
    }),
    endTrial: async () => {
      throw new Error("not called");
    },
  };
  const service = workspaceBillingService();
  const eligible = await validateFirstLiveCampaignBilling({
    service: service as never,
    workspaceId: "workspace-1",
    gateway,
  });
  assert.equal(eligible.subscriptionId, "sub_123");
  assert.equal(hasReusablePaymentMethod(eligible.subscription), true);

  await assert.rejects(
    validateFirstLiveCampaignBilling({
      service: service as never,
      workspaceId: "workspace-1",
      gateway: {
        ...gateway,
        retrieveSubscription: async () => ({ id: "sub_123", status: "trialing" }),
      },
    }),
    /reusable payment method/i,
  );
});

test("billing service ends the trial once and treats Stripe active state as an idempotent retry", async () => {
  const operations: string[] = [];
  let status = "trialing";
  const gateway: FirstLiveCampaignStripeGateway = {
    retrieveSubscription: async () => {
      operations.push("retrieve");
      return { id: "sub_123", status, default_payment_method: "pm_123", metadata: { workspace_id: "workspace-1" } };
    },
    endTrial: async (_subscriptionId, idempotencyKey) => {
      operations.push(`end:${idempotencyKey}`);
      status = "active";
      return {
        id: "sub_123",
        status,
        default_payment_method: "pm_123",
        metadata: { workspace_id: "workspace-1" },
      };
    },
  };
  const service = workspaceBillingService();

  await endTrialAfterFirstLiveCampaign({
    service: service as never,
    workspaceId: "workspace-1",
    subscriptionId: "sub_123",
    idempotencyKey: "claim-1:plan-1",
    gateway,
  });
  await endTrialAfterFirstLiveCampaign({
    service: service as never,
    workspaceId: "workspace-1",
    subscriptionId: "sub_123",
    idempotencyKey: "claim-1:plan-1",
    gateway,
  });

  assert.deepEqual(operations, ["retrieve", "end:claim-1:plan-1", "retrieve"]);
  assert.equal(service.workspaceUpdates.length, 0);
});

test("free campaign scheduling is fixed to three days without changing the paid plan path", () => {
  const plan = {
    controls: { schedule: { startTime: "2026-07-30T09:00:00.000Z", endTime: null } },
    adSets: [
      {
        localId: "adset-1",
        startTime: "2026-07-30T09:00:00.000Z",
        endTime: null,
      },
    ],
  } as MetaPublishPlan;

  const scheduled = applyThreeDayFreeCampaignSchedule(plan);

  assert.equal(scheduled.controls.schedule?.startTime, "2026-07-30T09:00:00.000Z");
  assert.equal(scheduled.controls.schedule?.endTime, "2026-08-02T09:00:00.000Z");
  assert.equal(scheduled.adSets[0].endTime, "2026-08-02T09:00:00.000Z");
  assert.equal(plan.controls.schedule?.endTime, null);
});

test("publish worker persists reconciliation before claim consumption and preserves legacy trial finalization", () => {
  const source = readFileSync("src/lib/providers/meta-publish-worker.ts", "utf8");
  assert.match(
    source,
    /updateMetaPublishPlanExecution\(input\.serviceSupabase, completedPlan\)[\s\S]*finalizeFreeLiveConversion\(input, completedPlan, freeLive\)/,
  );
  assert.match(
    source,
    /consumeMetaFreeLiveClaim\([\s\S]*endTrialAfterFirstLiveCampaign\(/,
  );
  assert.match(source, /billing_access_state === "unbilled"[\s\S]*"free_campaign"/);
  assert.match(source, /applyThreeDayFreeCampaignSchedule\(input\.plan\)/);
  assert.match(
    source,
    /consumeMetaFreeLiveClaim\([\s\S]*activateFreeCampaign\(input, completedPlan\)/,
  );
  assert.match(
    source,
    /deterministicUuid\(`\$\{plan\.planId\}:free-campaign-activate`\)/,
  );
  assert.match(
    source,
    /completedPlan\.status !== "paused_live"[\s\S]*releasePreparedFreeLiveClaim/,
  );
  assert.match(
    source,
    /catch \(error\)[\s\S]*metaProviderMutationMayHaveOccurred\(providerState\)[\s\S]*status: "publishing"[\s\S]*throw error[\s\S]*releasePreparedFreeLiveClaim/,
  );
  assert.match(source, /onCheckpoint:[\s\S]*updateMetaPublishPlanExecution/);
  assert.match(source, /if \(input\.plan\.status === "paused_live"\)[\s\S]*finalizeFreeLiveConversion/);
});

function workspaceBillingService() {
  const claimedEvents = new Set<string>();
  const workspaceUpdates: Array<Record<string, unknown>> = [];
  const service = {
    workspaceUpdates,
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_stripe_webhook_event") {
        const id = String(args.p_event_id);
        if (claimedEvents.has(id)) return { data: false, error: null };
        claimedEvents.add(id);
        return { data: true, error: null };
      }
      if (name === "finish_stripe_webhook_event") return { data: null, error: null };
      throw new Error(`Unexpected RPC ${name}`);
    },
    from: (table: string) => {
      assert.equal(table, "workspaces");
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { stripe_subscription_id: "sub_123" }, error: null }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: () => ({
            select: async () => {
              workspaceUpdates.push(patch);
              return { data: [{ id: "workspace-1" }], error: null };
            },
          }),
        }),
      };
    },
  };
  return service;
}
