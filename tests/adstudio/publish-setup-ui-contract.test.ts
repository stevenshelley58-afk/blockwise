import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildExplicitMetaPublishControls,
  normalizeSavedPublishAudienceLocations,
  publishSetupFingerprint,
  type ExplicitPublishControlsDraft,
} from "../../src/app/(customer)/ad-studio/templates/[templateId]/publish/publish-controls.ts";

function draft(overrides: Partial<ExplicitPublishControlsDraft> = {}): ExplicitPublishControlsDraft {
  return {
    destinationMode: "instant_form",
    destinationUrl: "https://example.com/thank-you",
    targetMode: "new_campaign_new_adset",
    campaignId: "",
    adSetIds: [],
    variantIds: ["feed", "story"],
    budgetMode: "adset",
    dailyBudgetDollars: "35.50",
    newCampaignObjective: "OUTCOME_LEADS",
    newCampaignSpecialAdCategory: "HOUSING",
    newCampaignSpecialAdCategoryCountry: "AU",
    audienceMode: "saved_locations",
    availableLocations: [{ key: "meta-perth", name: "Perth", region: "WA" }],
    selectedLocationKeys: ["meta-perth"],
    includeSurroundingSuburbs: false,
    latitude: "",
    longitude: "",
    radiusKm: "",
    placementChoices: ["facebook_feed", "instagram_story"],
    startIntent: "as_soon_as_activated",
    startAt: "",
    endIntent: "run_until_paused",
    endAt: "",
    offerEnabled: false,
    fulfilmentRequired: false,
    fulfilment: {
      exactOffer: "",
      eligibility: "",
      conditions: "",
      timeframe: "",
      evidence: "",
      approval: "",
      disclaimer: "",
      privacyUrl: "",
      consent: "",
      fulfilmentUrl: "",
      owner: "",
      expiry: "",
      tracking: "",
    },
    setupConfirmed: true,
    ...overrides,
  };
}

describe("explicit Meta publish setup", () => {
  it("blocks every silent-default path for a new ad set", () => {
    const result = buildExplicitMetaPublishControls(draft({
      destinationUrl: "",
      dailyBudgetDollars: "",
      audienceMode: "",
      selectedLocationKeys: [],
      placementChoices: [],
      startIntent: "",
      endIntent: "",
      setupConfirmed: false,
    }));

    assert.equal(result.controls, null);
    const issues = result.issues.join(" ");
    assert.match(issues, /HTTPS thank-you destination/);
    assert.match(issues, /daily budget/);
    assert.match(issues, /audience location/);
    assert.match(issues, /placement/);
    assert.match(issues, /should start/);
    assert.match(issues, /should end/);
    assert.match(issues, /Confirm the budget/);
  });

  it("sends the customer's exact budget, audience, placements, schedule intent and instant-form URL", () => {
    const result = buildExplicitMetaPublishControls(draft());
    assert.ok(result.controls);
    assert.equal(result.controls.destinationUrl, "https://example.com/thank-you");
    assert.equal(result.controls.dailyBudgetMinorUnits, 3550);
    assert.equal(result.controls.newCampaign?.budgetMode, "adset");
    assert.deepEqual(result.controls.geo, {
      type: "cities",
      locations: [{ key: "meta-perth", name: "Perth", region: "WA" }],
      includeSurroundingSuburbs: false,
    });
    assert.deepEqual(result.controls.placements, {
      publisherPlatforms: ["facebook", "instagram"],
      facebookPositions: ["feed"],
      instagramPositions: ["story"],
    });
    assert.deepEqual(result.controls.schedule, { startTime: null, endTime: null });
    assert.match(result.summary?.budget ?? "", /35\.50/);
  });

  it("preserves existing ad set parent settings instead of inventing overrides", () => {
    const result = buildExplicitMetaPublishControls(draft({
      targetMode: "existing_adset",
      campaignId: "campaign-1",
      adSetIds: ["adset-1", "adset-2"],
      parentState: existingParentState(),
    }));

    assert.ok(result.controls);
    assert.equal(Object.hasOwn(result.controls, "dailyBudgetMinorUnits"), false);
    assert.equal(Object.hasOwn(result.controls, "geo"), false);
    assert.equal(Object.hasOwn(result.controls, "placements"), false);
    assert.equal(Object.hasOwn(result.controls, "schedule"), false);
    assert.equal(Object.hasOwn(result.controls, "parentState"), false);
    assert.equal(result.summary?.usesExistingAdSetSettings, true);
  });

  it("requires an explicit variant selection", () => {
    const result = buildExplicitMetaPublishControls(draft({ variantIds: [] }));

    assert.equal(result.controls, null);
    assert.match(result.issues.join(" "), /at least one creative variant/i);
  });

  it("sends a positive conditional ABO budget for a new ad set in an existing campaign", () => {
    const result = buildExplicitMetaPublishControls(draft({
      targetMode: "existing_campaign_new_adset",
      campaignId: "campaign-1",
      budgetMode: "",
      parentState: { ...existingParentState(), campaign: { ...existingParentState().campaign!, budgetMode: "campaign" } },
    }));

    assert.ok(result.controls);
    assert.equal(result.controls.dailyBudgetMinorUnits, 3550);
    assert.equal(Object.hasOwn(result.controls, "newCampaign"), false);
    assert.equal(Object.hasOwn(result.controls, "parentState"), false);
    assert.match(result.summary?.budget ?? "", /ignored for live CBO/i);
  });

  it("rejects duplicate existing ad sets so the creative matrix is exact", () => {
    const result = buildExplicitMetaPublishControls(draft({
      targetMode: "existing_adset",
      campaignId: "campaign-1",
      adSetIds: ["adset-1", "adset-1"],
      parentState: existingParentState(),
    }));

    assert.equal(result.controls, null);
    assert.match(result.issues.join(" "), /duplicate ad set IDs/i);
  });

  it("binds required offer fulfilment to its explicit HTTPS delivery URL and never accepts typed asset text", () => {
    const result = buildExplicitMetaPublishControls(draft({
      destinationUrl: "https://example.com/property-appraisal",
      fulfilmentRequired: true,
      fulfilment: validFulfilment(),
    }));

    assert.ok(result.controls?.fulfilment);
    assert.equal(result.controls.destinationUrl, "https://example.com/property-appraisal");
    assert.equal(result.controls.fulfilment.fulfilmentUrl, "https://example.com/delivery/seller-guide");
    assert.equal(result.controls.fulfilment.fulfilmentAsset, "");
    assert.match(result.summary?.fulfilment ?? "", /Free seller guide/);
  });

  it("fails closed when required fulfilment has no executable HTTPS delivery path", () => {
    const result = buildExplicitMetaPublishControls(draft({
      fulfilmentRequired: true,
      fulfilment: { ...validFulfilment(), fulfilmentUrl: "http://example.com/guide" },
    }));

    assert.equal(result.controls, null);
    assert.match(result.issues.join(" "), /HTTPS/);
  });

  it("binds confirmation to destination, matrix and fulfilment changes", () => {
    const base = draft({ setupConfirmed: false });
    const withoutConfirmation = ({ setupConfirmed: _ignored, ...value }: ExplicitPublishControlsDraft) => value;
    const fingerprint = publishSetupFingerprint(withoutConfirmation(base));

    assert.notEqual(publishSetupFingerprint(withoutConfirmation({ ...base, destinationUrl: "https://example.com/changed" })), fingerprint);
    assert.notEqual(publishSetupFingerprint(withoutConfirmation({ ...base, variantIds: ["feed"] })), fingerprint);
    assert.notEqual(publishSetupFingerprint(withoutConfirmation({ ...base, offerEnabled: true, fulfilment: validFulfilment() })), fingerprint);
    assert.notEqual(publishSetupFingerprint(withoutConfirmation({ ...base, fulfilment: { ...base.fulfilment, fulfilmentUrl: "https://example.com/new-delivery" } })), fingerprint);
  });

  it("keeps both customer confirmations and explicit labels visible", () => {
    const source = readFileSync("src/app/(customer)/ad-studio/templates/[templateId]/publish/publish-flow.tsx", "utf8");
    assert.match(source, /daily budget \(AUD\)/);
    assert.match(source, /Audience location/);
    assert.match(source, /Placements/);
    assert.match(source, /Choose start timing/);
    assert.match(source, /Ad destination/);
    assert.match(source, /Fulfilment delivery URL/);
    assert.match(source, /Campaign budget \(CBO\)/);
    assert.match(source, /Ad set budget \(ABO\)/);
    assert.match(source, /Special ad category country/);
    assert.match(source, /Blockwise will not assume it/);
    assert.doesNotMatch(source, /newCampaignSpecialAdCategoryCountry: "AU"/);
    assert.match(source, /I confirm this budget mode, spend, audience, placement, schedule, creative matrix and fulfilment setup is correct/);
    assert.doesNotMatch(source, /Fulfilment asset/);
    assert.match(source, /A typed file name is not accepted/);
    // Creation and activation are separate explicit actions for the exact plan.
    assert.match(source, /Create paused on Meta/);
    assert.match(source, /Activate on Meta/);
    assert.match(source, /AlertDialog/);
    assert.match(source, /Keep paused/);
    assert.match(source, /Activate ads/);
    assert.match(source, /Audience \/ targeting/);
    assert.doesNotMatch(source, /window\.confirm/);
    assert.match(source, /clientMutationKey/);
    assert.match(source, /controlsFingerprint/);
    assert.match(source, /status === "publishing"/);
    assert.match(source, /View results/);
    assert.match(source, /No new objects are created/);
    assert.match(source, /targets only the objects this publish created/);
  });

  it("loads workspace-scoped saved campaign locations into the publish UI", () => {
    assert.deepEqual(normalizeSavedPublishAudienceLocations([
      { targetSuburbs: [{ key: "101", name: "Subiaco", region: "WA" }] },
      { targetSuburbs: [{ key: "101", name: "Duplicate", region: "WA" }, { key: "102", name: "Cottesloe" }] },
    ]), [
      { key: "101", name: "Subiaco", region: "WA" },
      { key: "102", name: "Cottesloe", region: null },
    ]);

    const page = readFileSync("src/app/(customer)/ad-studio/templates/[templateId]/publish/page.tsx", "utf8");
    const flow = readFileSync("src/app/(customer)/ad-studio/templates/[templateId]/publish/publish-flow.tsx", "utf8");
    assert.match(page, /\.from\("adstudio_campaigns"\)/);
    assert.match(page, /\.eq\("workspace_id", access\.workspaceId\)/);
    assert.match(page, /audienceLocations=\{audienceLocations\}/);
    assert.match(flow, /availableLocations: audienceLocations/);
    assert.doesNotMatch(flow, /availableLocations:\s*\[\]/);
    assert.doesNotMatch(flow, /audienceLocations=\{\[\]\}/);
  });
});

function validFulfilment(): ExplicitPublishControlsDraft["fulfilment"] {
  return {
    exactOffer: "Free seller guide",
    eligibility: "Homeowners in the selected locations",
    conditions: "One guide per enquiry",
    timeframe: "Delivered immediately",
    evidence: "Approved guide revision 4",
    approval: "Approved by the principal",
    disclaimer: "General information only.",
    privacyUrl: "https://example.com/privacy",
    consent: "I agree to receive the guide.",
    fulfilmentUrl: "https://example.com/delivery/seller-guide",
    owner: "Customer success",
    expiry: "No expiry",
    tracking: "CRM tag: seller-guide",
  };
}

function existingParentState(): NonNullable<ExplicitPublishControlsDraft["parentState"]> {
  return {
    campaign: {
      id: "campaign-1",
      objective: "OUTCOME_LEADS",
      specialAdCategories: ["HOUSING"],
      specialAdCategoryCountries: ["AU"],
      budgetMode: "adset",
    },
    adSets: ["adset-1", "adset-2"].map(id => ({
      id,
      campaignId: "campaign-1",
      targeting: { geo_locations: { cities: [{ key: "meta-perth" }] } },
      optimizationGoal: "LEAD_GENERATION",
      billingEvent: "IMPRESSIONS",
      dailyBudgetMinorUnits: 3550,
      destination: { type: "ON_AD" },
      promotedObject: { page_id: "page-1" },
    })),
  };
}
