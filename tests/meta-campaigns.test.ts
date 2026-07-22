import assert from "node:assert/strict";
import test from "node:test";

import { normalizeEligibleMetaCampaigns } from "../src/lib/providers/meta-campaigns.ts";

test("normalizeEligibleMetaCampaigns keeps reusable lead campaigns only", () => {
  const campaigns = normalizeEligibleMetaCampaigns([
    {
      id: "lead_active",
      name: "Winter sellers",
      objective: "OUTCOME_LEADS",
      effective_status: "ACTIVE",
      special_ad_categories: ["HOUSING"],
      updated_time: "2026-07-20T00:00:00Z",
    },
    {
      id: "lead_paused",
      name: "Autumn sellers",
      objective: "OUTCOME_LEADS",
      configured_status: "PAUSED",
      special_ad_categories: ["HOUSING"],
      updated_time: "2026-07-21T00:00:00Z",
    },
    {
      id: "traffic",
      name: "Traffic campaign",
      objective: "OUTCOME_TRAFFIC",
      effective_status: "ACTIVE",
      special_ad_categories: ["HOUSING"],
    },
    {
      id: "archived",
      name: "Old leads",
      objective: "OUTCOME_LEADS",
      effective_status: "ARCHIVED",
      special_ad_categories: ["HOUSING"],
    },
    {
      id: "non_housing",
      name: "General leads",
      objective: "OUTCOME_LEADS",
      effective_status: "ACTIVE",
      special_ad_categories: [],
    },
  ]);

  assert.deepEqual(campaigns.map((campaign) => campaign.id), ["lead_paused", "lead_active"]);
  assert.deepEqual(campaigns.map((campaign) => campaign.status), ["paused", "active"]);
});
