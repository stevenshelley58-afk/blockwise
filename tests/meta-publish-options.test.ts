import assert from "node:assert/strict";
import test from "node:test";
import { fetchMetaPublishOptions, fetchMetaPublishParentState } from "../src/lib/providers/meta-publish-options.ts";

test("preserves budget ownership and explains paused parents", async () => {
  const result = await fetchMetaPublishOptions({ accessToken: "secret-token", accountId: "123", fetchImpl: async (input) => {
    const url = String(input);
    if (url.includes("/campaigns")) return new Response(JSON.stringify({ data: [
      { id: "paused", name: "Paused leads", objective: "OUTCOME_LEADS", configured_status: "PAUSED", special_ad_categories: ["HOUSING"] },
      { id: "active", name: "Active leads", objective: "OUTCOME_LEADS", effective_status: "ACTIVE", special_ad_categories: ["HOUSING"], daily_budget: "2500" },
    ] }));
    return new Response(JSON.stringify({ data: [
      { id: "set-paused", name: "Paused audience", campaign_id: "paused", effective_status: "PAUSED" },
      { id: "set-active", name: "Active audience", campaign_id: "active", effective_status: "ACTIVE" },
      { name: "Malformed", campaign_id: "active" },
    ] }));
  }});
  result.sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(result.map((item) => item.id), ["active", "paused"]);
  assert.equal(result[0]?.budgetMode, "campaign");
  assert.equal(result[1]?.budgetMode, "adset");
  assert.equal(result[1]?.eligible, false);
  assert.match(result[1]?.eligibilityReasons[0] ?? "", /paused/);
  assert.equal(result[0]?.adSets[0]?.budgetMode, "campaign");
  assert.equal(result[1]?.adSets[0]?.eligible, false);
  assert.doesNotMatch(JSON.stringify(result), /secret-token/);
});

test("rejects a selected parent from another account", async () => {
  await assert.rejects(fetchMetaPublishParentState({ accessToken: "token", accountId: "123", campaignId: "campaign", fetchImpl: async () => new Response(JSON.stringify({ account_id: "999", objective: "OUTCOME_LEADS", special_ad_categories: ["HOUSING"] })) }), /does not belong/);
});
