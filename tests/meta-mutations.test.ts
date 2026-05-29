import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMetaPlanMutation,
  executeMetaPlanMutation,
} from "../src/lib/providers/meta-mutations.ts";

test("buildMetaPlanMutation creates a separate approval-gated activation request", () => {
  const mutation = buildMetaPlanMutation({
    workspaceId: "workspace_demo",
    planId: "plan_123",
    requestedBy: "user_123",
    action: "activate",
    payload: {
      campaignId: "meta_campaign_123",
      adSetIds: ["meta_adset_123"],
      adIds: ["meta_ad_123"],
    },
  });

  assert.equal(mutation.status, "requested");
  assert.equal(mutation.action, "activate");
  assert.equal(mutation.approval.targetType, "meta_publish_plan_mutation");
  assert.match(mutation.approval.riskSummary, /Activate/);
});

test("executeMetaPlanMutation refuses live mutations without approved approval status", async () => {
  const mutation = buildMetaPlanMutation({
    workspaceId: "workspace_demo",
    planId: "plan_123",
    requestedBy: "user_123",
    action: "increase_budget",
    payload: {
      adSetBudgets: [{ adSetId: "meta_adset_123", dailyBudgetMinorUnits: 12000 }],
    },
  });

  await assert.rejects(
    executeMetaPlanMutation({
      mutation,
      approvalStatus: "requested",
      accessToken: "token",
      fetchImpl: async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
    }),
    /approved approval/,
  );
});

test("executeMetaPlanMutation applies approved activation and budget updates through Meta", async () => {
  const mutation = buildMetaPlanMutation({
    workspaceId: "workspace_demo",
    planId: "plan_123",
    requestedBy: "user_123",
    action: "activate",
    payload: {
      campaignId: "meta_campaign_123",
      adSetIds: ["meta_adset_123"],
      adIds: ["meta_ad_123"],
      adSetBudgets: [{ adSetId: "meta_adset_123", dailyBudgetMinorUnits: 12000 }],
    },
  });
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];

  const result = await executeMetaPlanMutation({
    mutation,
    approvalStatus: "approved",
    accessToken: "token",
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(result.status, "applied");
  assert.ok(requests.some((request) => request.url.includes("/meta_campaign_123") && request.body.status === "ACTIVE"));
  assert.ok(requests.some((request) => request.url.includes("/meta_adset_123") && request.body.daily_budget === "12000"));
});
