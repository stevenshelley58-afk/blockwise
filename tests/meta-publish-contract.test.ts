import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMetaCreativePayload,
  buildMetaAssetFeedSpec,
  buildDefaultMetaCreativeFeatures,
  buildMetaInstantFormPayload,
  buildMetaAdSetPayload,
  validateMetaInstantFormSpec,
} from "../src/lib/providers/meta-execution.ts";

test("Meta creative payload snapshots placement routing at the creative root", () => {
  const payload = buildMetaCreativePayload({
    name: "Example",
    creative: {
      pageId: "page_1",
      instagramActorId: "ig_1",
      primaryText: "Primary",
      headline: "Headline",
      description: "Description",
      cta: "LEARN_MORE",
    },
    link: "https://example.test/ad",
    leadFormId: "form_1",
    imageHash: "feed_hash",
    storyImageHash: "story_hash",
    useAssetFeed: true,
    creativeFeatures: buildDefaultMetaCreativeFeatures(),
  });

  assert.deepEqual(payload.asset_feed_spec, buildMetaAssetFeedSpec("feed_hash", "story_hash"));
  assert.equal((payload.object_story_spec as { link_data: Record<string, unknown> }).link_data.asset_feed_spec, undefined);
  assert.deepEqual(
    (payload.degrees_of_freedom_spec as { creative_features_spec: Record<string, { enroll_status: string }> }).creative_features_spec,
    Object.fromEntries(Object.keys(buildDefaultMetaCreativeFeatures()).map((key) => [key, { enroll_status: "OPT_OUT" }])),
  );
});

test("v26 HEC-F ad sets explicitly enable Advantage audience and never route to Explore", () => {
  const plan = {
    campaign: { budgetMode: "campaign" as const },
    setup: { pageId: "page_1" },
  };
  const adSet = {
    billingEvent: "IMPRESSIONS" as const,
    optimizationGoal: "LEAD_GENERATION" as const,
    dailyBudgetMinorUnits: 2000,
    targeting: { publisher_platforms: ["facebook", "instagram"], instagram_positions: ["stream", "story"] },
    startTime: null,
    endTime: null,
  };
  const payload = buildMetaAdSetPayload(plan as never, adSet as never, "Example", "campaign_1");
  assert.deepEqual(payload.targeting_automation, { advantage_audience: 1 });
  assert.equal(JSON.stringify(payload).includes('"explore"'), false);
});

test("Instant Form payload snapshots visible intro, question headline and thank-you action", () => {
  const form = {
    localId: "form_1",
    name: "Example form",
    headline: "Find your value",
    intro: "Get a local appraisal.",
    contactFields: ["FIRST_NAME", "EMAIL"] as ("FIRST_NAME" | "EMAIL")[],
    customQuestions: ["When are you moving?"],
    questions: ["When are you moving?"],
    privacyPolicyUrl: "https://example.test/privacy",
    thankYouTitle: "Thank you",
    thankYouBody: "We will be in touch.",
    thankYouButtonType: "VIEW_WEBSITE" as const,
    thankYouButtonText: "Visit website",
    thankYouWebsiteUrl: "https://example.test/next",
  };
  assert.deepEqual(buildMetaInstantFormPayload("Provider name", form), {
    name: "Provider name",
    locale: "en_AU",
    context_card: { title: "Find your value", content: ["Get a local appraisal."], style: "PARAGRAPH_STYLE" },
    question_page_custom_headline: "Find your value",
    follow_up_action_url: "https://example.test/next",
    privacy_policy: { url: "https://example.test/privacy", link_text: "Privacy Policy" },
    is_optimized_for_quality: true,
    questions: [{ type: "FIRST_NAME", key: "first_name" }, { type: "EMAIL", key: "email" }, { type: "CUSTOM", key: "custom_1", label: "When are you moving?" }],
    thank_you_page: { title: "Thank you", body: "We will be in touch.", button_text: "Visit website", button_type: "VIEW_WEBSITE", website_url: "https://example.test/next" },
  });
  assert.match(validateMetaInstantFormSpec({ ...form, customQuestions: ["What is your income?"] }).join(" "), /prohibited sensitive/i);
});

test("Meta creative payload fails closed to a single image when either placement asset is absent", () => {
  const payload = buildMetaCreativePayload({
    name: "Example",
    creative: { pageId: "page_1", instagramActorId: null, primaryText: "P", headline: "H", description: "D", cta: "LEARN_MORE" },
    link: "https://example.test/ad",
    leadFormId: "form_1",
    imageHash: "feed_hash",
    storyImageHash: null,
    useAssetFeed: true,
    creativeFeatures: {},
  });

  assert.equal(payload.asset_feed_spec, undefined);
});
