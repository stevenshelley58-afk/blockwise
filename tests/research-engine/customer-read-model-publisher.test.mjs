import assert from "node:assert/strict";
import test from "node:test";

import { publishCustomerReadModels } from "../../hermes/tools/research-runtime/bin/customer-read-model-publisher.mjs";

test("publishes the customer-safe projection before deleting stale revisions", async () => {
  const researchReads = [];
  const customerWrites = [];
  const researchRest = async (_schema, path) => {
    researchReads.push(path);
    if (path.startsWith("v_customer_meta_ad_library_cards?")) {
      return [{
        card_id: "00000000-0000-4000-8000-000000000001",
        library_id: "meta-1",
        page_name: "Example Realty",
        active_status: "active",
        publisher_platforms: ["facebook"],
        postcodes: ["6000"],
        image_urls: [],
        media_assets: [],
        last_seen_at: "2026-07-28T00:00:00.000Z",
        ad_area_postcodes: ["6000"],
        ad_area_suburbs: ["Perth"],
        service_area_postcodes: ["6000"],
        service_area_suburbs: ["Perth"],
        attribution_links: [],
        hooks: ["Local expertise"],
      }];
    }
    if (path.startsWith("v_customer_agent_ad_history?")) {
      return [{
        observed_ad_id: "00000000-0000-4000-8000-000000000001",
        external_ad_id: "meta-1",
        advertiser_page_id: "00000000-0000-4000-8000-000000000002",
        platform: "meta",
        first_seen_at: "2026-07-20T00:00:00.000Z",
        last_checked_at: "2026-07-28T00:01:00.000Z",
        classification: { ad_type: "listing" },
        snapshot_count: 2,
        primary_intent: "listing",
        display_state: "displayable",
      }];
    }
    if (path.startsWith("ad_creatives?")) {
      return [{
        id: "00000000-0000-4000-8000-000000000003",
        observed_ad_id: "00000000-0000-4000-8000-000000000001",
      }];
    }
    if (path.startsWith("ad_creative_versions?")) {
      return [{
        id: "00000000-0000-4000-8000-000000000004",
        ad_creative_id: "00000000-0000-4000-8000-000000000003",
        observed_ad_id: "00000000-0000-4000-8000-000000000001",
        version: 1,
        creative_hash: "hash-1",
        created_at: "2026-07-28T00:00:00.000Z",
      }];
    }
    throw new Error(`Unexpected research read: ${path}`);
  };
  const fetchImpl = async (url, init = {}) => {
    customerWrites.push({
      path: new URL(url).pathname + new URL(url).search,
      method: init.method || "GET",
      body: init.body ? JSON.parse(init.body) : null,
    });
    return new Response(null, { status: 204 });
  };

  const result = await publishCustomerReadModels({
    researchRest,
    env: {
      HERMES_CUSTOMER_SUPABASE_URL: "https://customer.example",
      HERMES_CUSTOMER_SUPABASE_SERVICE_ROLE_KEY: "header.payload.signature",
    },
    fetchImpl,
    now: () => "2026-07-28T01:00:00.000Z",
  });

  assert.equal(result.cards, 1);
  assert.equal(result.versions, 1);
  assert.equal(researchReads.length, 4);

  const cardWrite = customerWrites.find((write) => write.path.includes("customer_ad_radar_cards?on_conflict=card_id"));
  assert.equal(cardWrite?.body[0].observed_ad_id, "00000000-0000-4000-8000-000000000001");
  assert.equal(cardWrite?.body[0].source_ad_creative_id, "00000000-0000-4000-8000-000000000003");
  assert.deepEqual(cardWrite?.body[0].classification, { ad_type: "listing" });

  const firstDelete = customerWrites.findIndex((write) => write.method === "DELETE");
  const cardUpsert = customerWrites.findIndex((write) => write.path.includes("customer_ad_radar_cards?on_conflict=card_id"));
  const versionUpsert = customerWrites.findIndex((write) => write.path.includes("customer_ad_radar_creative_versions?on_conflict=id"));
  assert.ok(firstDelete > cardUpsert);
  assert.ok(firstDelete > versionUpsert);
});
