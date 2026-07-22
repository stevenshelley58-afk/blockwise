import assert from "node:assert/strict";
import test from "node:test";

import { buildCloneTestPack } from "./adstudio-clone-fixture.ts";
import {
  buildMetaPublishTaskOptions,
  buildMetaPlanIdempotencyKey,
  buildMetaPublishPlan,
  createMetaExecutionAdapter,
  validateMetaConnectionSetup,
  validateMetaPublishPlanReadiness,
  type MetaCreativeAssetPlan,
  type MetaConnectionSetup,
  type MetaPublishControls,
} from "../src/lib/providers/meta-execution.ts";

const setup: MetaConnectionSetup = {
  metaAdAccountId: "act_123",
  pageId: "page_123",
  instagramActorId: "ig_123",
  pixelId: "pixel_123",
  leadDestination: { type: "webhook", label: "Blockwise CRM", config: { endpoint: "https://crm.example/leads" } },
  privacyPolicyUrl: "https://northstar.example/privacy",
  currency: "AUD",
  timezone: "Australia/Perth",
};

const controls: MetaPublishControls = {
  dailyBudgetMinorUnits: 7500,
  geo: {
    type: "custom_radius",
    latitude: -31.9523,
    longitude: 115.8613,
    radiusKm: 12,
  },
  schedule: {
    startTime: "2026-06-01T09:00:00+08:00",
    endTime: "2026-06-30T17:00:00+08:00",
  },
  placements: {
    publisherPlatforms: ["facebook", "instagram"],
    facebookPositions: ["feed"],
    instagramPositions: ["stream", "story"],
  },
};

function buildPack() {
  return buildCloneTestPack("workspace_demo");
}

test("buildMetaPublishPlan creates a deterministic paused Meta plan", () => {
  const pack = buildPack();
  const idempotencyKey = buildMetaPlanIdempotencyKey({
    workspaceId: "workspace_demo",
    adStudioCampaignId: pack.campaign.campaignId,
    adapter: "marketing_api",
    approvalRequestId: "approval_123",
  });
  const plan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: pack,
    connectionId: "connection_123",
    setup,
    approvalRequestId: "approval_123",
  });

  assert.equal(plan.adapter, "marketing_api");
  assert.equal(plan.status, "draft");
  assert.equal(plan.idempotencyKey, idempotencyKey);
  assert.equal(plan.campaign.status, "PAUSED");
  assert.deepEqual(plan.campaign.specialAdCategories, ["HOUSING"]);
  assert.equal(plan.adSets.length, 2);
  assert.ok(plan.ads.length <= 6);
  assert.ok(plan.ads.length > 0);
  assert.equal(plan.adSets.every((adSet) => adSet.status === "PAUSED"), true);
  assert.equal(plan.ads.every((ad) => ad.status === "PAUSED"), true);
  assert.equal(plan.leadForms.every((form) => form.privacyPolicyUrl === setup.privacyPolicyUrl), true);
});

test("buildMetaPublishPlan reuses an explicitly selected Meta campaign", () => {
  const pack = buildPack();
  const newCampaignPlan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: pack,
    connectionId: "connection_123",
    setup,
    approvalRequestId: "approval_123",
  });
  const existingCampaignPlan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: pack,
    connectionId: "connection_123",
    setup,
    approvalRequestId: "approval_123",
    existingMetaCampaignId: "meta_campaign_456",
  });

  assert.equal(existingCampaignPlan.reconciledObjects.campaignId, "meta_campaign_456");
  assert.notEqual(existingCampaignPlan.idempotencyKey, newCampaignPlan.idempotencyKey);
  assert.notEqual(existingCampaignPlan.planId, newCampaignPlan.planId);
});

test("buildMetaPublishPlan applies user budget, geo, schedule, and placement controls", () => {
  const plan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: buildPack(),
    connectionId: "connection_123",
    setup,
    controls,
    approvalRequestId: "approval_123",
  });

  assert.equal(plan.controls.dailyBudgetMinorUnits, 7500);
  assert.equal(plan.adSets.every((adSet) => adSet.dailyBudgetMinorUnits === 7500), true);
  assert.equal(plan.adSets.every((adSet) => adSet.startTime === controls.schedule?.startTime), true);
  assert.equal(plan.adSets.every((adSet) => adSet.endTime === controls.schedule?.endTime), true);
  assert.deepEqual(plan.adSets[0]?.targeting.geo_locations, {
    custom_locations: [
      {
        latitude: -31.9523,
        longitude: 115.8613,
        radius: 12,
        distance_unit: "kilometer",
      },
    ],
    location_types: ["home", "recent"],
  });
  assert.deepEqual(plan.adSets[0]?.targeting.facebook_positions, ["feed"]);
});

test("buildMetaPublishPlan targets selected suburbs and can include their surrounding area", () => {
  const plan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: buildPack(),
    connectionId: "connection_123",
    setup,
    controls: {
      geo: {
        type: "cities",
        locations: [
          { key: "101", name: "Subiaco", region: "Western Australia" },
          { key: "102", name: "Shenton Park", region: "Western Australia" },
        ],
        includeSurroundingSuburbs: true,
      },
    },
  });

  assert.deepEqual(plan.adSets[0]?.targeting.geo_locations, {
    cities: [
      { key: "101", radius: 10, distance_unit: "kilometer" },
      { key: "102", radius: 10, distance_unit: "kilometer" },
    ],
    location_types: ["home", "recent"],
  });
});

test("buildMetaPublishPlan keeps exact selected suburbs when surrounding areas are disabled", () => {
  const plan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: buildPack(),
    connectionId: "connection_123",
    setup,
    controls: {
      geo: {
        type: "cities",
        locations: [{ key: "101", name: "Subiaco", region: "Western Australia" }],
        includeSurroundingSuburbs: false,
      },
    },
  });

  assert.deepEqual(plan.adSets[0]?.targeting.geo_locations, {
    cities: [{ key: "101" }],
    location_types: ["home", "recent"],
  });
});

test("validateMetaConnectionSetup requires production Meta assets", () => {
  assert.deepEqual(validateMetaConnectionSetup({ ...setup, pageId: "" }), [
    "Meta Page is not configured.",
  ]);
  assert.deepEqual(validateMetaConnectionSetup({ ...setup, privacyPolicyUrl: "" }), [
    "Meta lead form privacy policy URL is not configured.",
  ]);
  assert.deepEqual(validateMetaConnectionSetup({ ...setup, leadDestination: { type: "crm", label: "Agentbox", config: { endpoint: "" } } }), [
    "Meta lead destination endpoint is not configured.",
  ]);
});

test("validateMetaPublishPlanReadiness keeps Blockwise as the authority", () => {
  const plan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: buildPack(),
    connectionId: "connection_123",
    setup,
  });

  assert.deepEqual(
    validateMetaPublishPlanReadiness(plan, {
      approvalStatus: "requested",
      providerConnectionStatus: "connected",
      complianceStatus: "approved",
    }).blockers,
    ["Human approval is required before publishing."],
  );

  assert.deepEqual(
    validateMetaPublishPlanReadiness(
      { ...plan, approvalRequestId: "approval_123", status: "approved" },
      {
        approvalStatus: "approved",
        providerConnectionStatus: "connected",
        complianceStatus: "approved",
      },
    ),
    { ready: true, blockers: [] },
  );
});

test("ads_cli and ads_mcp adapters are read-only until promoted", async () => {
  const plan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: buildPack(),
    connectionId: "connection_123",
    setup,
    adapter: "ads_cli",
    approvalRequestId: "approval_123",
  });

  await assert.rejects(
    createMetaExecutionAdapter("ads_cli").publish(plan, { accessToken: "token" }),
    /read-only diagnostics/,
  );
  await assert.rejects(
    createMetaExecutionAdapter("ads_mcp").publish({ ...plan, adapter: "ads_mcp" }, { accessToken: "token" }),
    /read-only diagnostics/,
  );
});

test("marketing_api adapter publishes paused objects and records request responses", async () => {
  const plan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: buildPack(),
    connectionId: "connection_123",
    setup,
    approvalRequestId: "approval_123",
  });
  const requested: Array<{ url: string; body: Record<string, unknown> }> = [];
  let nextId = 1;
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    requested.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });

    return new Response(JSON.stringify({ id: `meta_${nextId++}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await createMetaExecutionAdapter("marketing_api").publish(
    { ...plan, status: "approved" },
    { accessToken: "token", fetchImpl },
  );

  assert.equal(result.status, "paused_live");
  assert.equal(result.reconciledObjects.campaignId, "meta_1");
  assert.equal(result.requestLog.length, requested.length);
  assert.ok(requested.length >= 5);
  assert.equal(requested.filter((request) => request.body.status).every((request) => request.body.status === "PAUSED"), true);
});

test("marketing_api adapter uploads creative assets and uses image hashes", async () => {
  const plan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: buildPack(),
    connectionId: "connection_123",
    setup,
    approvalRequestId: "approval_123",
  });
  const imageAsset: MetaCreativeAssetPlan = {
    type: "image",
    source: "inline",
    mimeType: "image/png",
    filename: "scarborough-feed.png",
    bytesBase64: "iVBORw0KGgo=",
  };
  const requested: Array<{ url: string; body: Record<string, unknown> }> = [];
  let nextId = 1;
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requested.push({ url: String(url), body });

    if (String(url).includes("/adimages")) {
      return new Response(JSON.stringify({ images: { "scarborough-feed.png": { hash: "image_hash_123" } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if ((init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify({ id: String(url).split("/").at(-1)?.split("?")[0], effective_status: "PAUSED" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ id: `meta_${nextId++}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await createMetaExecutionAdapter("marketing_api").publish(
    {
      ...plan,
      status: "approved",
      creatives: plan.creatives.map((creative, index) => (index === 0 ? { ...creative, asset: imageAsset } : creative)),
    },
    { accessToken: "token", fetchImpl },
  );

  const creativeCreate = requested.find((request) => String(request.url).includes("/adcreatives"));
  assert.equal(result.status, "paused_live");
  assert.ok(requested.some((request) => String(request.url).includes("/adimages")));
  assert.equal(
    ((creativeCreate?.body.object_story_spec as Record<string, unknown>).link_data as Record<string, unknown>).image_hash,
    "image_hash_123",
  );
});

test("marketing_api adapter resumes partial publishes without recreating reconciled objects", async () => {
  const plan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: buildPack(),
    connectionId: "connection_123",
    setup,
    approvalRequestId: "approval_123",
  });
  const requested: Array<{ url: string; method: string }> = [];
  let nextId = 1;
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    requested.push({ url: String(url), method });

    if (method === "GET") {
      return new Response(JSON.stringify({ id: String(url).split("/").at(-1)?.split("?")[0], effective_status: "PAUSED" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ id: `meta_${nextId++}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await createMetaExecutionAdapter("marketing_api").publish(
    {
      ...plan,
      status: "approved",
      reconciledObjects: {
        ...plan.reconciledObjects,
        campaignId: "existing_campaign",
      },
    },
    { accessToken: "token", fetchImpl },
  );

  assert.equal(result.status, "paused_live");
  assert.equal(requested.some((request) => request.method === "POST" && request.url.includes("/campaigns")), false);
  assert.equal(result.reconciledObjects.campaignId, "existing_campaign");
});

test("marketing_api adapter reconciles Meta object state after publish", async () => {
  const plan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: buildPack(),
    connectionId: "connection_123",
    setup,
    approvalRequestId: "approval_123",
  });
  const methods: string[] = [];
  let nextId = 1;
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    methods.push(method);

    if (method === "GET") {
      return new Response(JSON.stringify({ id: String(url).split("/").at(-1)?.split("?")[0], effective_status: "PAUSED" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ id: `meta_${nextId++}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await createMetaExecutionAdapter("marketing_api").publish(
    { ...plan, status: "approved" },
    { accessToken: "token", fetchImpl },
  );

  assert.equal(result.status, "paused_live");
  assert.equal(methods.includes("GET"), true);
  assert.equal(result.reconciledObjects.objectStatuses?.campaign?.effectiveStatus, "PAUSED");
});

test("buildMetaPublishTaskOptions keeps worker runs idempotent per plan", () => {
  assert.deepEqual(
    buildMetaPublishTaskOptions({
      workspaceId: "workspace_demo",
      planId: "plan_123",
      idempotencyKey: "meta:marketing_api:key",
    }),
    {
      idempotencyKey: "meta:marketing_api:key",
      concurrencyKey: "meta-publish:workspace_demo:meta:marketing_api:key",
      tags: ["meta-publish", "workspace_demo", "plan_123"],
      maxAttempts: 3,
    },
  );
});
