import assert from "node:assert/strict";
import test from "node:test";

import { summarizePersistedPublishPlan } from "../../src/lib/adstudio/publish-receipt.ts";
import type { MetaPublishPlan } from "../../src/lib/providers/meta-execution.ts";

test("durable receipt summary is derived from persisted normalized controls", () => {
  const summary = summarizePersistedPublishPlan(plan({
    target: { mode: "new_campaign_new_adset" },
    dailyBudgetMinorUnits: 2500,
    newCampaign: { objective: "OUTCOME_LEADS", specialAdCategories: ["HOUSING"], specialAdCategoryCountries: ["AU"], budgetMode: "adset" },
    destinationMode: "website",
    destinationUrl: "https://example.com/offer",
    variantIds: ["feed", "story"],
    geo: { type: "cities", locations: [{ key: "1", name: "Subiaco", region: "WA" }], includeSurroundingSuburbs: true },
    placements: { publisherPlatforms: ["facebook", "instagram"], facebookPositions: ["feed"], instagramPositions: ["story"] },
    schedule: { startTime: "2026-09-04T00:00:00.000Z", endTime: null },
  }));

  assert.equal(summary.budget, "$25.00 per day");
  assert.match(summary.audience, /Subiaco, WA/);
  assert.match(summary.audience, /surrounding suburbs included/);
  assert.match(summary.placements, /Facebook feed/);
  assert.match(summary.placements, /Instagram story/);
  assert.match(summary.schedule, /runs until you pause it/);
  assert.equal(summary.variants, "Feed + Story");
  assert.equal(summary.destination, "https://example.com/offer");
});

test("existing ad set receipts state inherited controls are unchanged", () => {
  const summary = summarizePersistedPublishPlan(plan({
    target: { mode: "existing_adset", campaignId: "campaign-123", adSetIds: ["adset-1"] },
    destinationMode: "website",
    destinationUrl: "https://example.com",
    variantIds: ["feed"],
  }));

  assert.equal(summary.budget, "Unchanged in Meta");
  assert.equal(summary.audience, "Unchanged in Meta");
  assert.equal(summary.placements, "Unchanged in Meta");
  assert.equal(summary.schedule, "Unchanged in Meta");
  assert.match(summary.activationConfirmation, /existing campaign and ad set settings remain unchanged/);
});

function plan(controls: MetaPublishPlan["controls"]): MetaPublishPlan {
  return {
    planId: "plan-1",
    workspaceId: "workspace-1",
    adStudioCampaignId: "ad-1",
    adStudioExportId: null,
    legacyCampaignId: null,
    providerConnectionId: "connection-1",
    approvalRequestId: null,
    adapter: "marketing_api",
    status: "paused_live",
    idempotencyKey: "fingerprint",
    setup: { metaAdAccountId: "act_1", pageId: "page-1", leadDestination: { type: "manual", label: "Manual" }, privacyPolicyUrl: "https://example.com/privacy", currency: "AUD", timezone: "Australia/Perth" },
    controls,
    campaign: { localId: "campaign", name: "Campaign", objective: "OUTCOME_LEADS", status: "PAUSED", specialAdCategories: [], specialAdCategoryCountries: [], budgetMode: "adset" },
    adSets: [],
    leadForms: [],
    creatives: [],
    ads: [],
    tracking: { utmSource: "meta", utmMedium: "paid_social", utmCampaign: "campaign", utmContentPrefix: "ad" },
    requestLog: [],
    responseLog: [],
    reconciledObjects: { leadFormIds: {}, adSetIds: {}, creativeIds: {}, adIds: {} },
    lastError: null,
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
  };
}
