import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PublishError,
  buildPausedMetaPublishPlan,
  type PausedPublishPlanInput,
  type PublishLoadResult,
} from "../../src/lib/adstudio/publish-adapter.ts";
import {
  createMetaExecutionAdapter,
  type MetaOfferFulfilment,
  type MetaPublishControls,
} from "../../src/lib/providers/meta-execution.ts";

const destinationUrl = "https://example.com/property-appraisal";
const fulfilmentUrl = "https://example.com/delivery/free-guide";

const exactOffer: MetaOfferFulfilment = {
  exactOffer: "Free guide",
  eligibility: "Homeowners in the selected Perth suburbs",
  conditions: "One guide per enquiry",
  timeframe: "Delivered immediately after form submission",
  evidence: "Approved seller-guide PDF, revision 4",
  approval: "Approved by the principal on 2026-08-29",
  disclaimer: "General information only; results vary by property.",
  privacyUrl: "https://example.com/privacy",
  consent: "I agree to receive the guide and a follow-up about my property.",
  fulfilmentAsset: "",
  fulfilmentUrl,
  owner: "Customer success",
  expiry: "No expiry",
  tracking: "CRM tag: free-seller-guide",
};

describe("paused Ad Studio Meta publish planning", () => {
  it("preserves a validated Free guide promise in plan controls and the Instant Form", () => {
    const plan = buildPausedMetaPublishPlan(buildInput(validNewAdSetControls()));

    assert.deepEqual(plan.controls.fulfilment, exactOffer);
    assert.deepEqual(plan.leadForms[0]?.fulfilment, exactOffer);
    assert.equal(plan.controls.destinationUrl, destinationUrl);
    assert.equal(plan.leadForms[0]?.thankYouWebsiteUrl, fulfilmentUrl);
  });

  it("rejects every missing explicit control for either mode that creates a new ad set", () => {
    const omissions: Array<{
      name: string;
      remove: (controls: MetaPublishControls) => void;
      message: RegExp;
    }> = [
      { name: "daily budget", remove: (controls) => { delete controls.dailyBudgetMinorUnits; }, message: /daily budget/i },
      { name: "audience", remove: (controls) => { delete controls.geo; }, message: /audience/i },
      { name: "placements", remove: (controls) => { delete controls.placements; }, message: /placements/i },
      { name: "schedule intent", remove: (controls) => { delete controls.schedule; }, message: /schedule intent/i },
    ];

    for (const mode of ["new_campaign_new_adset", "existing_campaign_new_adset"] as const) {
      for (const omission of omissions) {
        const controls = validNewAdSetControls();
        controls.target = mode === "new_campaign_new_adset"
          ? { mode }
          : { mode, campaignId: "meta_campaign_existing" };
        if (mode === "existing_campaign_new_adset") {
          delete controls.newCampaign;
          controls.parentState = existingParentState([], "campaign");
        }
        omission.remove(controls);

        assert.throws(
          () => buildPausedMetaPublishPlan(buildInput(controls)),
          (error: unknown) => error instanceof PublishError
            && error.code === "publish_dependencies_missing"
            && omission.message.test(error.message),
          `${mode} should reject a missing ${omission.name}`,
        );
      }
    }
  });

  it("keeps the approved amount in controls and removes it from a CBO ad-set plan", () => {
    const controls = validNewAdSetControls();
    controls.newCampaign = { ...controls.newCampaign!, budgetMode: "campaign" };

    const plan = buildPausedMetaPublishPlan(buildInput(controls));

    assert.equal(plan.campaign.budgetMode, "campaign");
    assert.equal(plan.controls.dailyBudgetMinorUnits, 3500);
    assert.equal(plan.adSets[0]?.dailyBudgetMinorUnits, 0);
  });

  it("keeps existing-ad-set parent state authoritative without synthetic new-ad-set defaults", () => {
    const parentTargeting = {
      geo_locations: { cities: [{ key: "perth-6000" }] },
      publisher_platforms: ["instagram"],
      instagram_positions: ["stream"],
    };
    const controls: MetaPublishControls = {
      target: {
        mode: "existing_adset",
        campaignId: "meta_campaign_existing",
        adSetIds: ["meta_adset_existing"],
      },
      destinationMode: "instant_form",
      destinationUrl,
      variantIds: ["feed"],
      parentState: {
        campaign: {
          id: "meta_campaign_existing",
          objective: "OUTCOME_LEADS",
          specialAdCategories: ["HOUSING"],
          specialAdCategoryCountries: ["AU"],
          budgetMode: "adset",
        },
        adSets: [{
          id: "meta_adset_existing",
          campaignId: "meta_campaign_existing",
          targeting: parentTargeting,
          optimizationGoal: "LEAD_GENERATION",
          billingEvent: "IMPRESSIONS",
          dailyBudgetMinorUnits: 7300,
          destination: { type: "ON_AD" },
          promotedObject: { page_id: "page_123" },
        }],
      },
    };

    const plan = buildPausedMetaPublishPlan(buildInput(controls));

    assert.equal(plan.adSets[0]?.existingId, "meta_adset_existing");
    assert.equal(plan.adSets[0]?.dailyBudgetMinorUnits, 7300);
    assert.deepEqual(plan.adSets[0]?.targeting, parentTargeting);
    assert.deepEqual(plan.controls.parentState, controls.parentState);
    assert.equal("dailyBudgetMinorUnits" in plan.controls, false);
    assert.equal("geo" in plan.controls, false);
    assert.equal("placements" in plan.controls, false);
    assert.equal("schedule" in plan.controls, false);
  });

  it("fails closed for an explicit empty variant selection", () => {
    const controls = validNewAdSetControls();
    controls.variantIds = [];

    assert.throws(
      () => buildPausedMetaPublishPlan(buildInput(controls)),
      (error: unknown) => error instanceof PublishError
        && error.code === "publish_dependencies_missing"
        && /at least one Feed or Story variant/i.test(error.message),
    );
  });

  it("rejects duplicate ad sets instead of collapsing an ambiguous matrix", () => {
    const controls: MetaPublishControls = {
      target: {
        mode: "existing_adset",
        campaignId: "meta_campaign_existing",
        adSetIds: ["meta_adset_1", "meta_adset_1"],
      },
      destinationMode: "instant_form",
      destinationUrl,
      variantIds: ["feed", "story"],
      parentState: existingParentState(["meta_adset_1"]),
      fulfilment: exactOffer,
    };

    assert.throws(
      () => buildPausedMetaPublishPlan(buildInput(controls)),
      (error: unknown) => error instanceof PublishError
        && error.code === "publish_dependencies_missing"
        && /only once/i.test(error.message),
    );
  });

  it("creates the exact selected-variant by selected-ad-set matrix", () => {
    const controls: MetaPublishControls = {
      target: {
        mode: "existing_adset",
        campaignId: "meta_campaign_existing",
        adSetIds: ["meta_adset_1", "meta_adset_2"],
      },
      destinationMode: "instant_form",
      destinationUrl,
      variantIds: ["story"],
      parentState: existingParentState(["meta_adset_1", "meta_adset_2"]),
      fulfilment: exactOffer,
    };

    const plan = buildPausedMetaPublishPlan(buildInput(controls));

    assert.equal(plan.creatives.length, 1);
    assert.equal(plan.ads.length, 2);
    assert.deepEqual(plan.ads.map(ad => [ad.adSetLocalId, ad.variantTag?.variantId]), [
      ["adset_existing_1", "story"],
      ["adset_existing_2", "story"],
    ]);
  });

  it("requires template-mandated fulfilment and rejects arbitrary asset text", () => {
    const missing = validNewAdSetControls();
    delete missing.fulfilment;
    const state = publishState();
    state.pack = {
      ...state.pack,
      metadata: {
        ...state.pack.metadata,
        publishRequirements: {
          objective: "OUTCOME_LEADS",
          specialAdCategory: "HOUSING",
          instantForm: { required: true, dependency: null },
          destination: { required: true, kind: "instant_form", dependency: null },
          fulfilment: { required: true, dependency: "Deliver the approved seller guide" },
          requiredCtaTypes: ["LEARN_MORE"],
        },
      },
    } as PublishLoadResult["pack"];

    assert.throws(
      () => buildPausedMetaPublishPlan({ ...buildInput(missing), state }),
      (error: unknown) => error instanceof PublishError && /Deliver the approved seller guide/i.test(error.message),
    );

    const arbitraryAsset = validNewAdSetControls();
    arbitraryAsset.fulfilment = { ...exactOffer, fulfilmentAsset: "seller-guide.pdf", fulfilmentUrl: "" };
    assert.throws(
      () => buildPausedMetaPublishPlan(buildInput(arbitraryAsset)),
      (error: unknown) => error instanceof PublishError && /Typed asset names cannot deliver/i.test(error.message),
    );
  });

  it("requires an Instant Form destination while planning and before the executor makes any Meta request", async () => {
    const missingDestinationControls = validNewAdSetControls();
    delete missingDestinationControls.destinationUrl;
    assert.throws(
      () => buildPausedMetaPublishPlan(buildInput(missingDestinationControls)),
      (error: unknown) => error instanceof PublishError && /destination URL/i.test(error.message),
    );

    const plan = buildPausedMetaPublishPlan(buildInput(validNewAdSetControls()));
    let metaRequests = 0;
    const result = await createMetaExecutionAdapter("marketing_api").publish(
      {
        ...plan,
        status: "approved",
        controls: { ...plan.controls, destinationUrl: undefined },
      },
      {
        accessToken: "test-token",
        fetchImpl: async () => {
          metaRequests += 1;
          return new Response(JSON.stringify({ id: "unexpected" }), { status: 200 });
        },
      },
    );

    assert.equal(result.status, "failed");
    assert.match(result.lastError ?? "", /valid HTTPS destination URL/i);
    assert.equal(metaRequests, 0);
    assert.deepEqual(result.requestLog, []);
    assert.equal(result.reconciledObjects.campaignId, undefined);
  });
});

function validNewAdSetControls(): MetaPublishControls {
  return {
    target: { mode: "new_campaign_new_adset" },
    dailyBudgetMinorUnits: 3500,
    newCampaign: {
      objective: "OUTCOME_LEADS",
      specialAdCategories: ["HOUSING"],
      specialAdCategoryCountries: ["AU"],
      budgetMode: "adset",
    },
    destinationMode: "instant_form",
    destinationUrl,
    variantIds: ["feed", "story"],
    geo: {
      type: "cities",
      locations: [{ key: "perth-6000", name: "Perth", region: "WA" }],
      includeSurroundingSuburbs: true,
    },
    placements: {
      publisherPlatforms: ["facebook", "instagram"],
      facebookPositions: ["feed", "story"],
      instagramPositions: ["stream", "story"],
    },
    schedule: { startTime: null, endTime: null },
    fulfilment: exactOffer,
  };
}

function existingParentState(
  adSetIds: string[],
  budgetMode: "campaign" | "adset" = "adset",
): NonNullable<MetaPublishControls["parentState"]> {
  return {
    campaign: {
      id: "meta_campaign_existing",
      objective: "OUTCOME_LEADS",
      specialAdCategories: ["HOUSING"],
      specialAdCategoryCountries: ["AU"],
      budgetMode,
    },
    adSets: adSetIds.map((id) => ({
      id,
      campaignId: "meta_campaign_existing",
      targeting: { geo_locations: { cities: [{ key: "perth-6000" }] } },
      optimizationGoal: "LEAD_GENERATION",
      billingEvent: "IMPRESSIONS",
      dailyBudgetMinorUnits: 7300,
      destination: { type: "ON_AD" },
      promotedObject: { page_id: "page_123" },
    })),
  };
}

function buildInput(controls: MetaPublishControls): PausedPublishPlanInput {
  return {
    adId: "ad_123",
    workspaceId: "workspace_123",
    connectionId: "connection_123",
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
    controls,
    state: publishState(),
  };
}

function publishState(): PublishLoadResult {
  return {
    ad: {
      id: "ad_123",
      templateId: "free-guide-template",
      colourMode: "template",
      metaPrimaryText: "Download the free seller guide.",
      metaHeadline: "Free seller guide",
      metaDescription: "A practical guide for Perth homeowners.",
      metaCta: "LEARN_MORE",
    },
    revision: {
      id: "revision_123",
      revisionNumber: 4,
      documentHash: "document-hash",
      feedPngHash: "feed-hash",
      feedPngPath: "workspace_123/ads/ad_123/feed.png",
      storyPngHash: "story-hash",
      storyPngPath: "workspace_123/ads/ad_123/story.png",
    },
    pack: {
      templateId: "free-guide-template",
      metadata: { title: "Free seller guide" },
      publishRequirements: {
        destinationMode: "instant_form",
        requiredCtaTypes: ["LEARN_MORE"],
      },
    } as unknown as PublishLoadResult["pack"],
    form: {
      name: "Free seller guide",
      formType: "higher_intent",
      intro: {
        headline: "Get the free guide",
        body: "Tell us where to send your guide.",
      },
      contactFields: [{ type: "email", required: true }],
      customQuestions: [{
        type: "short_answer",
        label: "Which suburb is your property in?",
        required: true,
      }],
      privacy: {
        url: "https://example.com/privacy",
        linkText: "Privacy Policy",
      },
      thankYou: {
        title: "Your guide is ready",
        body: "Use the button below to download it.",
        actionType: "visit_website",
      },
    },
    formDraftId: "form_draft_123",
    formRevision: 2,
  };
}
