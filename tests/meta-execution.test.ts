import assert from "node:assert/strict";
import test from "node:test";

import { buildCloneTestPack } from "./adstudio-clone-fixture.ts";
import {
  buildMetaPublishPlan,
  createMetaExecutionAdapter,
  hasExplicitMetaPublishAudience,
  validateMetaConnectionSetup,
  validateMetaPublishPlanReadiness,
  type MetaCreativeAssetPlan,
  type MetaConnectionSetup,
  type MetaPublishControls,
} from "../src/lib/providers/meta-execution.ts";
import {
  metaProviderFailureShouldRetry,
  metaProviderMutationMayHaveOccurred,
} from "../src/lib/providers/meta-publish-worker.ts";

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
  const plan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: pack,
    connectionId: "connection_123",
    setup,
    approvalRequestId: "approval_123",
  });
  const duplicatePlan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: pack,
    connectionId: "connection_123",
    setup,
    approvalRequestId: "approval_123",
  });

  assert.equal(plan.adapter, "marketing_api");
  assert.equal(plan.status, "draft");
  assert.equal(plan.idempotencyKey, duplicatePlan.idempotencyKey);
  assert.equal(plan.planId, duplicatePlan.planId);
  assert.equal(plan.campaign.status, "PAUSED");
  assert.equal(plan.campaign.bidStrategy, "LOWEST_COST_WITHOUT_CAP");
  assert.deepEqual(plan.campaign.specialAdCategories, ["HOUSING"]);
  assert.equal(plan.adSets.length, 1);
  assert.ok(plan.ads.length <= 6);
  assert.ok(plan.ads.length > 0);
  assert.equal(plan.adSets.every((adSet) => adSet.status === "PAUSED"), true);
  assert.equal(plan.ads.every((ad) => ad.status === "PAUSED"), true);
  assert.equal(plan.ads.every((ad) => ad.adSetLocalId === "adset_primary"), true);
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

test("buildMetaPublishPlan gives different creative selections different idempotency keys", () => {
  const pack = buildPack();
  const firstVariantId = pack.variants[0]!.variantId;
  const fullPlan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: pack,
    connectionId: "connection_123",
    setup,
    approvalRequestId: "approval_123",
  });
  const selectedPlan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: pack,
    connectionId: "connection_123",
    setup,
    approvalRequestId: "approval_123",
    variantIds: [firstVariantId],
  });

  assert.notEqual(selectedPlan.idempotencyKey, fullPlan.idempotencyKey);
  assert.match(selectedPlan.idempotencyKey, /creatives_[a-f0-9]{16}:execution_[a-f0-9]{32}$/);
});

test("buildMetaPublishPlan fingerprints every provider execution input", () => {
  const baseInput = {
    workspaceId: "workspace_demo",
    campaignPack: buildPack(),
    connectionId: "connection_123",
    setup,
    controls,
    approvalRequestId: "approval_123",
  } as const;
  const basePlan = buildMetaPublishPlan(baseInput);
  const changedCopyPack = buildPack();
  changedCopyPack.copyPacks[0]!.meta.primaryText[0] = "Updated provider copy";
  const changedAssetPack = buildPack();
  const changedImage = changedAssetPack.creatives[0]!.canvas.objects.find((object) => object.objectId === "template_clone_image")
    ?? changedAssetPack.creatives[0]!.canvas.objects.find((object) => object.role === "primary_image");
  assert.ok(changedImage);
  changedImage.content = "data:image/png;base64,dXBkYXRlZA==";

  const changedPlans = [
    buildMetaPublishPlan({ ...baseInput, connectionId: "connection_456" }),
    buildMetaPublishPlan({ ...baseInput, setup: { ...setup, pageId: "page_456" } }),
    buildMetaPublishPlan({ ...baseInput, controls: { ...controls, dailyBudgetMinorUnits: 7600 } }),
    buildMetaPublishPlan({ ...baseInput, controls: { ...controls, destinationUrl: "https://agency.example/updated" } }),
    buildMetaPublishPlan({
      ...baseInput,
      controls: { ...controls, geo: { type: "cities", locations: [{ key: "101", name: "Subiaco", region: null }], includeSurroundingSuburbs: true } },
    }),
    buildMetaPublishPlan({
      ...baseInput,
      controls: { ...controls, schedule: { ...controls.schedule, endTime: "2026-07-01T17:00:00+08:00" } },
    }),
    buildMetaPublishPlan({ ...baseInput, campaignPack: changedCopyPack }),
    buildMetaPublishPlan({ ...baseInput, campaignPack: changedAssetPack }),
  ];

  for (const changedPlan of changedPlans) {
    assert.notEqual(changedPlan.idempotencyKey, basePlan.idempotencyKey);
    assert.notEqual(changedPlan.planId, basePlan.planId);
  }
});

test("existing campaign reuse requires an explicit audience", () => {
  assert.equal(hasExplicitMetaPublishAudience(undefined), false);
  assert.equal(hasExplicitMetaPublishAudience({ geo: { type: "country", country: "AU" } }), false);
  assert.equal(hasExplicitMetaPublishAudience({
    geo: {
      type: "cities",
      locations: [{ key: "101", name: "Subiaco", region: "Western Australia" }],
      includeSurroundingSuburbs: false,
    },
  }), true);
  assert.equal(hasExplicitMetaPublishAudience({
    geo: { type: "custom_radius", latitude: -31.95, longitude: 115.86, radiusKm: 25 },
  }), true);
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
        radius: 25,
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
      { key: "101", radius: 25, distance_unit: "kilometer" },
      { key: "102", radius: 25, distance_unit: "kilometer" },
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

test("buildMetaPublishPlan keeps the destination URL and attaches the finished ad image", () => {
  const pack = buildPack();
  const plan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: pack,
    connectionId: "connection_123",
    setup,
    controls: { ...controls, destinationUrl: "https://agency.example/appraisal" },
    approvalRequestId: "approval_123",
  });

  assert.equal(plan.controls.destinationUrl, "https://agency.example/appraisal");
  // The fixture clone images are data URLs → inline image assets.
  assert.equal(plan.creatives.every((creative) => creative.asset?.type === "image" && Boolean(creative.asset.bytesBase64)), true);
  assert.equal(plan.leadForms.every((form) => form.thankYouWebsiteUrl === "https://agency.example/appraisal"), true);
});

test("buildMetaPublishPlan resolves stored clone references to storage assets", () => {
  const pack = buildPack();
  const storedPack = {
    ...pack,
    creatives: pack.creatives.map((creative) => ({
      ...creative,
      canvas: {
        ...creative.canvas,
        objects: creative.canvas.objects.map((object) => (
          object.objectId === "template_clone_image"
            ? { ...object, content: "/api/adstudio/media?path=workspace_demo%2Fclones%2Fad.png", assetId: "" }
            : object
        )),
      },
    })),
  };
  const plan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: storedPack,
    connectionId: "connection_123",
    setup,
    approvalRequestId: "approval_123",
  });

  assert.equal(plan.creatives.every((creative) => creative.asset?.source === "storage"), true);
  assert.equal(plan.creatives[0]?.asset?.storagePath, "workspace_demo/clones/ad.png");
});

test("validateMetaPublishPlanReadiness blocks creatives without a finished ad image", () => {
  const plan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: buildPack(),
    connectionId: "connection_123",
    setup,
    approvalRequestId: "approval_123",
  });
  const planWithoutImages = {
    ...plan,
    creatives: plan.creatives.map((creative) => ({ ...creative, asset: null })),
  };

  const readiness = validateMetaPublishPlanReadiness(
    { ...planWithoutImages, status: "approved" },
    {
      approvalStatus: "approved",
      providerConnectionStatus: "connected",
      complianceStatus: "approved",
    },
  );

  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.blockers, ["The finished ad image could not be found for one or more creatives."]);
});

test("marketing_api adapter links ads to the destination URL, not the privacy policy", async () => {
  const plan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: buildPack(),
    connectionId: "connection_123",
    setup,
    controls: { ...controls, destinationUrl: "https://agency.example/appraisal" },
    approvalRequestId: "approval_123",
  });
  const requested: Array<{ url: string; body: Record<string, unknown> }> = [];
  let nextId = 1;
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    requested.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    return new Response(JSON.stringify({ id: `meta_${nextId++}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  await createMetaExecutionAdapter("marketing_api").publish(
    { ...plan, status: "approved" },
    { accessToken: "token", fetchImpl },
  );

  const creativeCreate = requested.find((request) => String(request.url).includes("/adcreatives"));
  const linkData = (creativeCreate?.body.object_story_spec as Record<string, unknown>).link_data as Record<string, unknown>;
  assert.ok(String(linkData.link).startsWith("https://agency.example/appraisal?"));
  assert.match(String(linkData.link), /utm_source=meta/);
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

test("marketing_api adapter emits the strict Meta v23 lead-ad request contract", async () => {
  const plan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: buildPack(),
    connectionId: "connection_123",
    setup,
    controls,
    approvalRequestId: "approval_123",
  });
  const requests: Array<{
    path: string;
    method: string;
    authorization: string | null;
    body: Record<string, unknown>;
  }> = [];
  const createdIds: Record<string, string> = {
    campaigns: "campaign_1",
    leadgen_forms: "form_1",
    adsets: "adset_1",
    adcreatives: "creative_1",
    ads: "ad_1",
  };
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requests.push({
      path: url.pathname,
      method,
      authorization: new Headers(init?.headers).get("authorization"),
      body,
    });

    if (method === "GET") {
      return new Response(JSON.stringify({
        id: url.pathname.split("/").at(-1),
        effective_status: "PAUSED",
        configured_status: "PAUSED",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname.endsWith("/adimages")) {
      return new Response(JSON.stringify({ images: { uploaded: { hash: "image_hash_123" } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    const edge = url.pathname.split("/").at(-1) ?? "";
    return new Response(JSON.stringify({ id: createdIds[edge] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await createMetaExecutionAdapter("marketing_api").publish(
    { ...plan, status: "approved" },
    { accessToken: "user_token", pageAccessToken: "page_token", fetchImpl },
  );

  assert.equal(result.status, "paused_live", result.lastError ?? undefined);
  const post = (suffix: string) => requests.find((request) => request.method === "POST" && request.path.endsWith(suffix));
  const campaign = post("/campaigns")!;
  assert.deepEqual(Object.keys(campaign.body).sort(), [
    "bid_strategy",
    "daily_budget",
    "name",
    "objective",
    "special_ad_categories",
    "special_ad_category_country",
    "status",
  ]);
  assert.deepEqual(campaign.body.special_ad_category_country, ["AU"]);
  assert.equal(campaign.body.bid_strategy, "LOWEST_COST_WITHOUT_CAP");
  assert.equal("budget_strategy" in campaign.body, false);

  const leadForm = post("/leadgen_forms")!;
  assert.equal(leadForm.authorization, "Bearer page_token");
  assert.equal(campaign.authorization, "Bearer user_token");

  const adSet = post("/adsets")!;
  assert.equal(adSet.body.destination_type, "ON_AD");
  assert.deepEqual(adSet.body.promoted_object, { page_id: "page_123" });
  assert.equal("daily_budget" in adSet.body, false);
  assert.equal(JSON.stringify(adSet.body).includes("pixel_123"), false);

  const image = post("/adimages")!;
  assert.deepEqual(image.body, { bytes: "ZmVlZA==" });
  assert.equal("filename" in image.body, false);

  const creative = post("/adcreatives")!;
  const objectStory = creative.body.object_story_spec as Record<string, unknown>;
  const linkData = objectStory.link_data as Record<string, unknown>;
  assert.equal(objectStory.instagram_user_id, "ig_123");
  assert.equal("instagram_actor_id" in objectStory, false);
  assert.equal(
    (((linkData.call_to_action as Record<string, unknown>).value as Record<string, unknown>).lead_gen_form_id),
    "form_1",
  );
  assert.equal(linkData.image_hash, "image_hash_123");

  assert.deepEqual(post("/ads")!.body, {
    name: `${plan.ads[0]!.name} [BW:${plan.planId}:${plan.ads[0]!.localId}]`,
    adset_id: "adset_1",
    creative: { creative_id: "creative_1" },
    status: "PAUSED",
  });
  assert.equal(JSON.stringify(result).includes("user_token"), false);
  assert.equal(JSON.stringify(result).includes("page_token"), false);
});

test("marketing_api adapter repairs legacy Blockwise campaign bidding before retrying the ad set", async () => {
  const plan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: buildPack(),
    connectionId: "connection_123",
    setup,
    controls,
    approvalRequestId: "approval_123",
  });
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      posts.push({ path: url.pathname, body });
      return new Response(JSON.stringify(url.pathname.endsWith("/adsets") ? { id: "adset_1" } : { success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      id: url.pathname.split("/").at(-1),
      effective_status: "PAUSED",
      configured_status: "PAUSED",
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await createMetaExecutionAdapter("marketing_api").publish(
    {
      ...plan,
      status: "publishing",
      leadForms: [],
      creatives: [],
      ads: [],
      requestLog: [{
        step: "campaign.create",
        method: "POST",
        path: "/act_123/campaigns",
        body: { daily_budget: "7500" },
        createdAt: "2026-08-02T14:40:00.000Z",
      }],
      responseLog: [{
        step: "campaign.create",
        method: "POST",
        path: "/act_123/campaigns",
        status: 200,
        response: { id: "legacy_campaign" },
        createdAt: "2026-08-02T14:40:01.000Z",
      }],
      reconciledObjects: {
        campaignId: "legacy_campaign",
        leadFormIds: {},
        adSetIds: {},
        creativeIds: {},
        adIds: {},
      },
    },
    { accessToken: "user_token", fetchImpl, reconcileMissingObjects: true },
  );

  assert.equal(result.status, "paused_live", result.lastError ?? undefined);
  assert.deepEqual(posts[0], {
    path: "/v23.0/legacy_campaign",
    body: { bid_strategy: "LOWEST_COST_WITHOUT_CAP" },
  });
  assert.equal(posts[1]?.path.endsWith("/adsets"), true);
});

test("marketing_api adapter caps AdCreative names at Meta's 100-character limit", async () => {
  const pack = buildPack();
  pack.campaign.name = "Long Meta creative name ".repeat(12);
  const plan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: pack,
    connectionId: "connection_123",
    setup,
    approvalRequestId: "approval_123",
  });
  const creative = {
    ...plan.creatives[0]!,
    asset: { type: "image" as const, source: "meta" as const, imageHash: "image_hash_123" },
  };
  let providerName = "";
  const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "POST") {
      providerName = String((JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>).name ?? "");
      return new Response(JSON.stringify({ id: "creative_1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ id: "campaign_1", effective_status: "PAUSED", configured_status: "PAUSED" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await createMetaExecutionAdapter("marketing_api").publish(
    {
      ...plan,
      status: "approved",
      adSets: [],
      leadForms: [],
      creatives: [creative],
      ads: [],
      reconciledObjects: {
        campaignId: "campaign_1",
        leadFormIds: { [creative.leadFormLocalId]: "form_1" },
        adSetIds: {},
        creativeIds: {},
        adIds: {},
      },
    },
    { accessToken: "user_token", fetchImpl },
  );

  assert.equal(result.status, "paused_live", result.lastError ?? undefined);
  assert.equal(providerName.length, 100);
  assert.match(providerName, new RegExp(`\\[BW:${plan.planId}:${creative.localId}\\]$`));
});

test("marketing_api adapter puts the selected budget on an existing ad-set-budget campaign", async () => {
  const plan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: buildPack(),
    connectionId: "connection_123",
    setup,
    controls,
    approvalRequestId: "approval_123",
    existingMetaCampaignId: "existing_campaign",
    existingMetaCampaignBudgetMode: "adset",
  });
  const adSetBodies: Array<Record<string, unknown>> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if ((init?.method ?? "GET") === "POST") {
      adSetBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return new Response(JSON.stringify({ id: "adset_1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      id: url.split("/").at(-1)?.split("?")[0],
      effective_status: "PAUSED",
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await createMetaExecutionAdapter("marketing_api").publish(
    { ...plan, status: "approved", leadForms: [], creatives: [], ads: [] },
    { accessToken: "user_token", fetchImpl },
  );

  assert.equal(result.status, "paused_live", result.lastError ?? undefined);
  assert.equal(adSetBodies[0]?.daily_budget, "7500");
  assert.deepEqual(adSetBodies[0]?.promoted_object, { page_id: "page_123" });
});

test("marketing_api reconciliation paginates before deciding a deterministic object is missing", async () => {
  const plan = buildMetaPublishPlan({
    workspaceId: "workspace_demo",
    campaignPack: buildPack(),
    connectionId: "connection_123",
    setup,
    approvalRequestId: "approval_123",
  });
  const requests: Array<{ url: string; method: string }> = [];
  const providerName = `${plan.campaign.name} [BW:${plan.planId}:${plan.campaign.localId}]`;
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push({ url, method });
    if (url.includes("/campaigns?") && !url.includes("after=cursor_1")) {
      return new Response(JSON.stringify({
        data: [{ id: "unrelated", name: "A different campaign" }],
        paging: { cursors: { after: "cursor_1" } },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/campaigns?")) {
      return new Response(JSON.stringify({
        data: [{ id: "campaign_existing", name: providerName }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ id: "campaign_existing", effective_status: "PAUSED" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await createMetaExecutionAdapter("marketing_api").publish(
    { ...plan, status: "publishing", adSets: [], leadForms: [], creatives: [], ads: [] },
    { accessToken: "user_token", fetchImpl, reconcileMissingObjects: true },
  );

  assert.equal(result.status, "paused_live", result.lastError ?? undefined);
  assert.equal(result.reconciledObjects.campaignId, "campaign_existing");
  assert.equal(requests.filter((request) => request.url.includes("/campaigns?")).length, 2);
  assert.equal(requests.some((request) => request.method === "POST"), false);
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

test("marketing_api adapter reconciles a provider success after its local checkpoint failed", async () => {
  const plan = {
    ...buildMetaPublishPlan({
      workspaceId: "workspace_demo",
      campaignPack: buildPack(),
      connectionId: "connection_123",
      setup,
      approvalRequestId: "approval_123",
    }),
    adSets: [],
    leadForms: [],
    creatives: [],
    ads: [],
  };
  let providerName = "";
  const firstFetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    providerName = String(body.name);
    return new Response(JSON.stringify({ id: "meta_campaign_existing" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const firstResult = await createMetaExecutionAdapter("marketing_api").publish(
    { ...plan, status: "approved" },
    {
      accessToken: "token",
      fetchImpl: firstFetch,
      onCheckpoint: async () => {
        throw new Error("database write failed after provider success");
      },
    },
  );

  assert.equal(firstResult.status, "failed");
  assert.equal(firstResult.reconciledObjects.campaignId, "meta_campaign_existing");
  assert.equal(metaProviderMutationMayHaveOccurred(firstResult), true);

  const retryRequests: Array<{ url: string; method: string }> = [];
  const retryFetch = async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    retryRequests.push({ url: String(url), method });
    if (String(url).includes("/campaigns?")) {
      return new Response(JSON.stringify({
        data: [{ id: "meta_campaign_existing", name: providerName }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      id: "meta_campaign_existing",
      effective_status: "PAUSED",
      configured_status: "PAUSED",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const retryResult = await createMetaExecutionAdapter("marketing_api").publish(
    { ...plan, status: "publishing" },
    {
      accessToken: "token",
      fetchImpl: retryFetch,
      reconcileMissingObjects: true,
    },
  );

  assert.equal(retryResult.status, "paused_live");
  assert.equal(retryResult.reconciledObjects.campaignId, "meta_campaign_existing");
  assert.equal(retryRequests.some((request) => request.method === "POST"), false);
});

test("provider mutation uncertainty distinguishes rejected writes from unsafe outcomes", () => {
  const request = {
    step: "campaign.create",
    method: "POST" as const,
    path: "/act_123/campaigns",
    createdAt: "2026-07-27T00:00:00.000Z",
  };

  assert.equal(metaProviderMutationMayHaveOccurred({ requestLog: [request], responseLog: [] }), true);
  assert.equal(metaProviderMutationMayHaveOccurred({
    requestLog: [request],
    responseLog: [{ ...request, status: 500 }],
  }), true);
  assert.equal(metaProviderMutationMayHaveOccurred({
    requestLog: [request],
    responseLog: [{ ...request, status: 400 }],
  }), false);

  assert.equal(metaProviderFailureShouldRetry({ requestLog: [request], responseLog: [] }), true);
  assert.equal(metaProviderFailureShouldRetry({
    requestLog: [request],
    responseLog: [{ ...request, status: 429 }],
  }), true);
  assert.equal(metaProviderFailureShouldRetry({
    requestLog: [request],
    responseLog: [{
      ...request,
      status: 400,
      response: { error: { is_transient: true } },
    }],
  }), true);
  assert.equal(metaProviderFailureShouldRetry({
    requestLog: [request],
    responseLog: [{ ...request, status: 400 }],
  }), false);
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
