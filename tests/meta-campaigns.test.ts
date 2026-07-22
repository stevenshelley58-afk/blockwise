import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchMetaTargetingLocations,
  normalizeEligibleMetaCampaigns,
  normalizeMetaTargetingLocations,
} from "../src/lib/providers/meta-campaigns.ts";

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

test("normalizeMetaTargetingLocations keeps unique targetable Australian suburbs", () => {
  assert.deepEqual(normalizeMetaTargetingLocations([
    { key: "101", name: "Subiaco", type: "city", country_code: "AU", region: "Western Australia", supports_city: true },
    { key: "101", name: "Subiaco", type: "city", country_code: "AU", region: "Western Australia", supports_city: true },
    { key: "102", name: "Shenton Park", type: "neighborhood", country_code: "AU", region: "Western Australia", supports_city: true },
    { key: "103", name: "Subiaco", type: "city", country_code: "US", region: "Arkansas", supports_city: true },
    { key: "104", name: "Unavailable", type: "city", country_code: "AU", supports_city: false },
  ]), [
    { key: "101", name: "Subiaco", region: "Western Australia" },
    { key: "102", name: "Shenton Park", region: "Western Australia" },
  ]);
});

test("fetchMetaTargetingLocations uses Meta ad-geolocation city search", async () => {
  let requestedUrl = "";
  const locations = await fetchMetaTargetingLocations({
    accessToken: "secret-token",
    query: "Subiaco",
    fetchImpl: async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        data: [{ key: "101", name: "Subiaco", type: "city", country_code: "AU", region: "Western Australia", supports_city: true }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const url = new URL(requestedUrl);
  assert.equal(url.pathname.endsWith("/search"), true);
  assert.equal(url.searchParams.get("type"), "adgeolocation");
  assert.equal(url.searchParams.get("location_types"), '["city"]');
  assert.equal(url.searchParams.get("country_code"), "AU");
  assert.equal(url.searchParams.get("q"), "Subiaco");
  assert.deepEqual(locations, [{ key: "101", name: "Subiaco", region: "Western Australia" }]);
});
