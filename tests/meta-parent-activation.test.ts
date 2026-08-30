import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createMetaExecutionAdapter,
  type MetaOfferFulfilment,
  type MetaPublishPlan,
  type MetaPublishTarget,
} from "../src/lib/providers/meta-execution.ts";
import {
  buildMetaPlanMutation,
  buildOwnedMetaActivationPayload,
  executeMetaPlanMutation,
} from "../src/lib/providers/meta-mutations.ts";

test("publish preflight blocks a paused reused parent before every Meta POST", async () => {
  const plan = publishPlan({ mode: "existing_adset", campaignId: "campaign_existing", adSetIds: ["adset_existing"] });
  const methods: string[] = [];
  const result = await createMetaExecutionAdapter("marketing_api").publish(plan, {
    accessToken: "token",
    pageAccessToken: "page-token",
    fetchImpl: existingParentFetch(methods, { campaignStatus: "PAUSED" }),
  });

  assert.equal(result.status, "failed");
  assert.match(result.lastError ?? "", /reused Meta campaign.*not active/i);
  assert.equal(methods.includes("POST"), false);
  assert.deepEqual(result.requestLog.map((entry) => entry.step), [
    "preflight.account",
    "preflight.page",
    "preflight.campaign",
  ]);
});

test("existing parents are authoritatively read, never mutated, before owned ads are created", async () => {
  const plan = publishPlan({ mode: "existing_adset", campaignId: "campaign_existing", adSetIds: ["adset_existing"] });
  const methods: string[] = [];
  const result = await createMetaExecutionAdapter("marketing_api").publish(plan, {
    accessToken: "token",
    pageAccessToken: "page-token",
    fetchImpl: existingParentFetch(methods, { campaignStatus: "ACTIVE" }),
  });

  assert.equal(result.status, "paused_live");
  const postPaths = result.requestLog.filter((entry) => entry.method === "POST").map((entry) => entry.path);
  assert.deepEqual(postPaths, ["/act_123/adcreatives", "/act_123/ads"]);
  assert.equal(postPaths.some((path) => path === "/campaign_existing" || path === "/adset_existing"), false);
  assert.equal(result.reconciledObjects.ownedCampaignId, undefined);
  assert.deepEqual(result.reconciledObjects.ownedAdSetIds, {});
  assert.deepEqual(result.reconciledObjects.ownedAdIds, { ad_1: "ad_owned" });
  const firstPost = methods.indexOf("POST");
  assert.ok(firstPost >= 4);
  assert.equal(methods.slice(0, firstPost).every((method) => method === "GET"), true);
});

test("new campaign budget is written at exactly one CBO or ABO owner", async () => {
  for (const budgetMode of ["campaign", "adset"] as const) {
    const plan = publishPlan({ mode: "new_campaign_new_adset" }, budgetMode);
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    const result = await createMetaExecutionAdapter("marketing_api").publish(plan, {
      accessToken: "token",
      pageAccessToken: "page-token",
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        const path = graphPath(url);
        if (init?.method === "GET" && path === "/act_123") return json(activeAccount());
        if (init?.method === "GET" && path === "/page_123") return json(activePage());
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
          requests.push({ path, body });
          if (path.endsWith("/campaigns")) return json({ id: "campaign_owned" });
          if (path.endsWith("/adsets")) return json({ error: { message: "stop after budget capture" } }, 400);
        }
        throw new Error(`Unexpected request ${init?.method} ${path}`);
      },
    });

    assert.equal(result.status, "failed");
    const campaign = requests.find((entry) => entry.path.endsWith("/campaigns"))?.body ?? {};
    const adSet = requests.find((entry) => entry.path.endsWith("/adsets"))?.body ?? {};
    assert.equal(campaign.daily_budget, budgetMode === "campaign" ? "3500" : undefined);
    assert.equal(adSet.daily_budget, budgetMode === "adset" ? "3500" : undefined);
    assert.equal(Object.hasOwn(campaign, "daily_budget") && Object.hasOwn(adSet, "daily_budget"), false);
  }
});

test("offer fulfilment requires and binds one exact HTTPS delivery URL before Meta I/O", async () => {
  const plan = publishPlan({ mode: "new_campaign_new_adset" }, "adset");
  const fulfilment: MetaOfferFulfilment = {
    exactOffer: "Free guide",
    eligibility: "Perth homeowners",
    conditions: "One per enquiry",
    timeframe: "Immediately",
    evidence: "Approved guide v4",
    approval: "Principal approved",
    disclaimer: "General information only",
    privacyUrl: "https://example.com/privacy",
    consent: "I agree",
    fulfilmentAsset: "guide-v4.pdf",
    fulfilmentUrl: "",
    owner: "Customer success",
    expiry: "No expiry",
    tracking: "CRM tag guide-v4",
  };
  plan.controls = { ...plan.controls, destinationMode: "instant_form", fulfilment };
  plan.leadForms = [{
    localId: "form_1",
    name: "Guide form",
    headline: "Get the guide",
    questions: [],
    privacyPolicyUrl: "https://example.com/privacy",
    thankYouTitle: "Check your inbox",
    thankYouBody: "Your guide is ready",
    thankYouWebsiteUrl: "https://example.com/free-guide",
    fulfilment,
  }];
  let calls = 0;
  const result = await createMetaExecutionAdapter("marketing_api").publish(plan, {
    accessToken: "token",
    fetchImpl: async () => {
      calls += 1;
      return json({ id: "unexpected" });
    },
  });
  assert.equal(result.status, "failed");
  assert.match(result.lastError ?? "", /explicit HTTPS fulfilment URL/i);
  assert.equal(calls, 0);
});

test("activation payload contains only objects owned by the publish plan", () => {
  const plan = publishPlan({ mode: "existing_adset", campaignId: "campaign_existing", adSetIds: ["adset_existing"] });
  plan.status = "paused_live";
  plan.reconciledObjects.ownedAdIds = { ad_1: "ad_owned" };
  plan.reconciledObjects.adIds = { ad_1: "ad_owned" };

  assert.deepEqual(buildOwnedMetaActivationPayload(plan), {
    reusedCampaignId: "campaign_existing",
    reusedAdSetIds: ["adset_existing"],
    adSetIds: [],
    adIds: ["ad_owned"],
  });
});

test("paused reused parents fail activation with GETs only and no compensation writes", async () => {
  const mutation = buildMetaPlanMutation({
    workspaceId: "workspace_123",
    planId: "plan_123",
    action: "activate",
    payload: {
      reusedCampaignId: "campaign_existing",
      reusedAdSetIds: ["adset_existing"],
      adIds: ["ad_owned"],
    },
  });
  const calls: Array<{ method: string; id: string }> = [];
  const result = await executeMetaPlanMutation({
    mutation,
    approvalStatus: "approved",
    accessToken: "token",
    fetchImpl: async (input, init) => {
      const id = graphPath(new URL(String(input))).slice(1);
      calls.push({ method: init?.method ?? "GET", id });
      return json({ id, configured_status: "PAUSED", effective_status: "PAUSED" });
    },
  });

  assert.equal(result.status, "failed");
  assert.match(result.lastError ?? "", /reused Meta campaign.*not active/i);
  assert.deepEqual(calls, [{ method: "GET", id: "campaign_existing" }]);
});

test("activation verifies reused parents but posts ACTIVE only to owned objects", async () => {
  const mutation = buildMetaPlanMutation({
    workspaceId: "workspace_123",
    planId: "plan_123",
    action: "activate",
    payload: {
      reusedCampaignId: "campaign_existing",
      reusedAdSetIds: ["adset_existing"],
      adIds: ["ad_owned"],
    },
  });
  const calls: Array<{ method: string; id: string; status?: unknown }> = [];
  const result = await executeMetaPlanMutation({
    mutation,
    approvalStatus: "approved",
    accessToken: "token",
    fetchImpl: async (input, init) => {
      const id = graphPath(new URL(String(input))).slice(1);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      calls.push({ method: init?.method ?? "GET", id, status: body.status });
      return init?.method === "POST"
        ? json({ success: true })
        : json({ id, configured_status: "ACTIVE", effective_status: "ACTIVE" });
    },
  });

  assert.equal(result.status, "applied");
  assert.deepEqual(calls.filter((call) => call.method === "POST"), [
    { method: "POST", id: "ad_owned", status: "ACTIVE" },
  ]);
  assert.deepEqual(calls.filter((call) => call.method === "GET").map((call) => call.id), [
    "campaign_existing",
    "adset_existing",
    "ad_owned",
  ]);
});

test("customer activation route verifies an explicit plan belongs to its ad", () => {
  const source = readFileSync("src/app/api/adstudio/ads/[id]/activate/route.ts", "utf8");
  assert.match(source, /plan\.adStudioCampaignId !== id/);
  assert.match(source, /buildOwnedMetaActivationPayload\(plan\)/);
});

function publishPlan(
  target: MetaPublishTarget,
  budgetMode: "campaign" | "adset" = "adset",
): MetaPublishPlan {
  const existingAdSet = target.mode === "existing_adset";
  const existingCampaign = target.mode !== "new_campaign_new_adset";
  return {
    planId: "plan_123",
    workspaceId: "workspace_123",
    adStudioCampaignId: "ad_123",
    adStudioExportId: null,
    legacyCampaignId: null,
    providerConnectionId: "connection_123",
    approvalRequestId: "approval_123",
    adapter: "marketing_api",
    status: "approved",
    idempotencyKey: "meta-plan-123",
    setup: {
      metaAdAccountId: "act_123",
      pageId: "page_123",
      instagramActorId: "instagram_123",
      pixelId: null,
      leadDestination: { type: "manual", label: "Manual review" },
      privacyPolicyUrl: "https://example.com/privacy",
      currency: "AUD",
      timezone: "Australia/Perth",
    },
    controls: {
      target,
      ...(existingAdSet ? {} : { dailyBudgetMinorUnits: 3500 }),
      ...(existingCampaign ? {} : {
        newCampaign: {
          objective: "OUTCOME_LEADS",
          specialAdCategories: ["HOUSING"],
          specialAdCategoryCountries: ["AU"],
          budgetMode,
        },
      }),
      destinationMode: "website",
      destinationUrl: "https://example.com/property-guide",
      variantIds: ["feed"],
    },
    campaign: {
      localId: "campaign_main",
      name: "Perth seller guide",
      objective: "OUTCOME_LEADS",
      status: "PAUSED",
      specialAdCategories: ["HOUSING"],
      specialAdCategoryCountries: ["AU"],
      budgetMode,
    },
    adSets: [{
      localId: existingAdSet ? "adset_existing_1" : "adset_primary",
      ...(existingAdSet ? { existingId: "adset_existing" } : {}),
      name: "Perth homeowners",
      campaignLocalId: "campaign_main",
      billingEvent: "IMPRESSIONS",
      optimizationGoal: "LEAD_GENERATION",
      status: "PAUSED",
      dailyBudgetMinorUnits: existingAdSet ? 999999 : 3500,
      targeting: existingAdSet ? { client_supplied: "ignored" } : { geo_locations: { countries: ["AU"] } },
    }],
    leadForms: [],
    creatives: [{
      localId: "creative_feed",
      name: "Perth Feed",
      pageId: "page_123",
      instagramActorId: "instagram_123",
      headline: "Free seller guide",
      primaryText: "Plan your sale",
      description: "For Perth homeowners",
      cta: "LEARN_MORE",
      leadFormLocalId: "",
      adStudioCreativeId: null,
      format: "4:5",
      asset: { type: "image", source: "meta", imageHash: "image_hash_123" },
    }],
    ads: [{ localId: "ad_1", name: "Perth Feed", adSetLocalId: existingAdSet ? "adset_existing_1" : "adset_primary", creativeLocalId: "creative_feed", status: "PAUSED" }],
    tracking: { utmSource: "meta", utmMedium: "paid_social", utmCampaign: "perth", utmContentPrefix: "guide" },
    requestLog: [],
    responseLog: [],
    reconciledObjects: {
      ...(existingCampaign ? { campaignId: "campaign_existing" } : {}),
      leadFormIds: {},
      adSetIds: existingAdSet ? { adset_existing_1: "adset_existing" } : {},
      ownedAdSetIds: {},
      creativeIds: {},
      adIds: {},
      ownedAdIds: {},
    },
    lastError: null,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
  };
}

function existingParentFetch(
  methods: string[],
  input: { campaignStatus: "ACTIVE" | "PAUSED" },
): typeof fetch {
  return async (rawUrl, init) => {
    const url = new URL(String(rawUrl));
    const path = graphPath(url);
    const method = init?.method ?? "GET";
    methods.push(method);
    if (method === "GET" && path === "/act_123") return json(activeAccount());
    if (method === "GET" && path === "/page_123") return json(activePage());
    if (method === "GET" && path === "/campaign_existing") {
      if (url.searchParams.get("fields")?.includes("objective")) {
        return json({ id: "campaign_existing", account_id: "act_123", name: "Existing", objective: "OUTCOME_LEADS", special_ad_categories: ["HOUSING"], special_ad_category_country: ["AU"], configured_status: input.campaignStatus, effective_status: input.campaignStatus, status: input.campaignStatus, bid_strategy: "LOWEST_COST_WITHOUT_CAP" });
      }
      return json({ id: "campaign_existing", configured_status: input.campaignStatus, effective_status: input.campaignStatus });
    }
    if (method === "GET" && path === "/adset_existing") return json({ id: "adset_existing", account_id: "act_123", campaign_id: "campaign_existing", configured_status: "ACTIVE", effective_status: "ACTIVE", optimization_goal: "LEAD_GENERATION", billing_event: "IMPRESSIONS", targeting: { geo_locations: { cities: [{ key: "perth" }] } }, destination_type: "WEBSITE", promoted_object: { page_id: "page_123" }, daily_budget: "7300" });
    if (method === "POST" && path === "/act_123/adcreatives") return json({ id: "creative_owned" });
    if (method === "POST" && path === "/act_123/ads") return json({ id: "ad_owned" });
    if (method === "GET" && path === "/ad_owned") return json({ id: "ad_owned", configured_status: "PAUSED", effective_status: "PAUSED" });
    throw new Error(`Unexpected request ${method} ${path}`);
  };
}

function activeAccount() {
  return { id: "act_123", account_id: "123", account_status: 1, disable_reason: 0, currency: "AUD", timezone_name: "Australia/Perth" };
}

function activePage() {
  return { id: "page_123", name: "Page", instagram_business_account: { id: "instagram_123" } };
}

function graphPath(url: URL): string {
  return "/" + url.pathname.split("/").filter(Boolean).slice(1).join("/");
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}
