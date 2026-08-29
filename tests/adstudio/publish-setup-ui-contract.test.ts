import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildExplicitMetaPublishControls,
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
    dailyBudgetDollars: "35.50",
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
    }));

    assert.ok(result.controls);
    assert.equal(Object.hasOwn(result.controls, "dailyBudgetMinorUnits"), false);
    assert.equal(Object.hasOwn(result.controls, "geo"), false);
    assert.equal(Object.hasOwn(result.controls, "placements"), false);
    assert.equal(Object.hasOwn(result.controls, "schedule"), false);
    assert.equal(result.summary?.usesExistingAdSetSettings, true);
  });

  it("keeps both customer confirmations and explicit labels visible", () => {
    const source = readFileSync("src/app/(customer)/ad-studio/templates/[templateId]/publish/publish-flow.tsx", "utf8");
    assert.match(source, /Daily budget \(AUD\)/);
    assert.match(source, /Audience location/);
    assert.match(source, /Placements/);
    assert.match(source, /Choose start timing/);
    assert.match(source, /Thank-you button destination/);
    assert.match(source, /I confirm this daily budget, audience, placement and schedule setup is correct/);
    assert.match(source, /activationConfirmed/);
  });
});
