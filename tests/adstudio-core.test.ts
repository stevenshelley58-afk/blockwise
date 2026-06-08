import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAdStudioExportPackage,
  buildAdStudioLiveResult,
  extractBrandKitFromWebsite,
  generateAdStudioCampaignPack,
  mergeBrandKitReview,
  approveAdStudioBrandKitForUse,
  scoreAdStudioVariant,
  validateGoogleSearchPack,
  validateMetaLeadAdPack,
  validateProviderJsonOutput,
} from "../src/lib/adstudio/index.ts";
import { hydrateStoredCreativeExportRenders } from "../src/lib/adstudio/export-render-storage.ts";

const sampleHtml = `
  <html>
    <head>
      <title>Northstar Realty Perth</title>
      <meta name="description" content="Licensed real estate agents in Perth and western suburbs.">
      <meta property="og:site_name" content="Northstar Realty">
      <link rel="icon" href="/favicon.ico">
      <style>
        :root { --brand: #087f7a; }
        body { font-family: Inter, sans-serif; color: #18201f; }
        .button { background: #087f7a; border-radius: 8px; }
      </style>
    </head>
    <body>
      <header>
        <img src="/logo.svg" alt="Northstar Realty logo">
        <a href="tel:0899990000">(08) 9999 0000</a>
        <a href="mailto:hello@northstar.example">hello@northstar.example</a>
      </header>
      <main>
        <h1>Calm property advice for Perth sellers</h1>
        <p>Information is general only. Speak with a licensed local agent.</p>
      </main>
    </body>
  </html>
`;

test("extractBrandKitFromWebsite extracts identity, assets, colours, typography, and compliance fields", () => {
  const kit = extractBrandKitFromWebsite({
    workspaceId: "workspace_demo",
    websiteUrl: "https://northstar.example",
    marketCountry: "AU",
    htmlByUrl: {
      "https://northstar.example": sampleHtml,
    },
  });

  assert.equal(kit.source.url, "https://northstar.example");
  assert.equal(kit.identity.businessName, "Northstar Realty");
  assert.equal(kit.logos.primaryLogoUrl, "https://northstar.example/logo.svg");
  assert.equal(kit.logos.faviconUrl, "https://northstar.example/favicon.ico");
  assert.equal(kit.colours.primary, "#087F7A");
  assert.equal(kit.typography.headingFont, "Inter");
  assert.equal(kit.contact.email, "hello@northstar.example");
  assert.equal(kit.reviewStatus, "pending_user_review");
  assert.deepEqual(kit.compliance.disclaimers, [
    "Information is general only. Speak with a licensed local agent.",
  ]);
});

test("mergeBrandKitReview preserves locked fields during a future extraction merge", () => {
  const existing = extractBrandKitFromWebsite({
    workspaceId: "workspace_demo",
    websiteUrl: "https://northstar.example",
    marketCountry: "AU",
    htmlByUrl: {
      "https://northstar.example": sampleHtml,
    },
  });
  const next = {
    ...existing,
    identity: { ...existing.identity, businessName: "Wrong Agency" },
    colours: { ...existing.colours, primary: "#B83B5E" },
  };

  const merged = mergeBrandKitReview(existing, next, {
    reviewStatus: "approved",
    lockedFields: ["identity.businessName", "colours.primary"],
  });

  assert.equal(merged.identity.businessName, "Northstar Realty");
  assert.equal(merged.colours.primary, "#087F7A");
  assert.equal(merged.reviewStatus, "approved");
  assert.deepEqual(merged.lockedFields, ["identity.businessName", "colours.primary"]);
});

test("approveAdStudioBrandKitForUse returns an approved kit with generation-critical fields locked", () => {
  const brandKit = extractBrandKitFromWebsite({
    workspaceId: "workspace_demo",
    websiteUrl: "https://northstar.example",
    marketCountry: "AU",
    htmlByUrl: {
      "https://northstar.example": sampleHtml,
    },
  });

  const approved = approveAdStudioBrandKitForUse({
    ...brandKit,
    lockedFields: ["identity.businessName"],
  });

  assert.equal(approved.reviewStatus, "approved");
  assert.equal(approved.lockedFields.includes("identity.businessName"), true);
  assert.equal(approved.lockedFields.includes("logos.primaryLogoUrl"), true);
  assert.equal(approved.lockedFields.includes("colours.primary"), true);
  assert.equal(approved.lockedFields.includes("typography.headingFont"), true);
  assert.equal(approved.lockedFields.includes("tone.voice"), true);
});

test("buildAdStudioLiveResult surfaces persistence failures without discarding usable generated output", () => {
  const liveResult = buildAdStudioLiveResult({
    data: { campaignId: "campaign_demo" },
    persistenceError: "relation adstudio_campaigns does not exist",
  });

  assert.deepEqual(liveResult.data, { campaignId: "campaign_demo" });
  assert.deepEqual(liveResult.persistence, {
    status: "not_persisted",
    warning: "relation adstudio_campaigns does not exist",
  });
});

test("generateAdStudioCampaignPack creates five compliant seller checklist variants", () => {
  const brandKit = extractBrandKitFromWebsite({
    workspaceId: "workspace_demo",
    websiteUrl: "https://northstar.example",
    marketCountry: "AU",
    htmlByUrl: {
      "https://northstar.example": sampleHtml,
    },
  });
  const approvedBrandKit = { ...brandKit, reviewStatus: "approved" as const };
  const pack = generateAdStudioCampaignPack({
    workspaceId: "workspace_demo",
    brandKit: approvedBrandKit,
    goal: "seller_leads",
    suburb: "Scarborough",
    city: "Perth",
    state: "WA",
    offerId: "seller_prep_checklist",
    platforms: ["meta", "google_search", "google_pmax", "google_demand_gen"],
    variantCount: 5,
  });

  assert.equal(pack.campaign.goal, "seller_leads");
  assert.equal(pack.variants.length, 5);
  assert.equal(pack.copyPacks[0]?.meta.specialAdCategory, "housing");
  assert.doesNotMatch(pack.copyPacks[0]?.meta.primaryText[0] ?? "", /^Thinking about selling/i);
  assert.match(pack.copyPacks[0]?.meta.primaryText[0] ?? "", /Before you list in Scarborough/);
  assert.equal(pack.copyPacks[0]?.meta.cta, "DOWNLOAD");
  assert.equal(pack.creatives.every((creative) => creative.canvas.objects.every((object) => String(object.type) !== "ai_text_image")), true);
  assert.equal(pack.compliance.status, "approved");
});

test("generateAdStudioCampaignPack keeps appraisal defaults offer-aware", () => {
  const brandKit = extractBrandKitFromWebsite({
    workspaceId: "workspace_demo",
    websiteUrl: "https://northstar.example",
    marketCountry: "AU",
    htmlByUrl: {
      "https://northstar.example": sampleHtml,
    },
  });
  const pack = generateAdStudioCampaignPack({
    workspaceId: "workspace_demo",
    brandKit: { ...brandKit, reviewStatus: "approved" as const },
    goal: "appraisal_bookings",
    suburb: "Scarborough",
    city: "Perth",
    state: "WA",
    offerId: "home_value_update",
    platforms: ["meta"],
    variantCount: 5,
  });

  assert.equal(pack.campaign.offerId, "home_value_update");
  assert.equal(pack.variants.length, 5);
  assert.match(pack.copyPacks[0]?.meta.primaryText[0] ?? "", /price update/);
  assert.equal(pack.copyPacks[0]?.landingPage.headline, "Scarborough price update");
  assert.doesNotMatch(pack.copyPacks[0]?.landingPage.subheadline ?? "", /seller checklist/i);
  assert.equal(pack.compliance.status, "approved");
});

test("first-ad generation uses the uploaded image as the full creative visual", () => {
  const brandKit = extractBrandKitFromWebsite({
    workspaceId: "workspace_demo",
    websiteUrl: "https://northstar.example",
    marketCountry: "AU",
    htmlByUrl: {
      "https://northstar.example": sampleHtml,
    },
  });
  const uploadedImage = "data:image/png;base64,iVBORw0KGgo=";
  const pack = generateAdStudioCampaignPack({
    workspaceId: "workspace_demo",
    brandKit: { ...brandKit, reviewStatus: "approved" as const },
    goal: "seller_leads",
    suburb: "Scarborough",
    city: "Perth",
    state: "WA",
    offerId: "seller_prep_checklist",
    platforms: ["meta"],
    variantCount: 3,
    firstAd: {
      mode: "custom",
      description: "Open home this weekend with a renovated kitchen.",
      imageDataUrl: uploadedImage,
      formats: ["9:16", "4:5", "1:1"],
    },
  });
  const story = pack.creatives.find((creative) => creative.format === "9:16");
  assert.ok(story);

  const image = story.canvas.objects.find((object) => object.role === "primary_image");
  const subhead = story.canvas.objects.find((object) => object.role === "subheadline");
  assert.deepEqual(
    { content: image?.content, x: image?.x, y: image?.y, width: image?.width, height: image?.height },
    { content: uploadedImage, x: 0, y: 0, width: story.canvas.width, height: story.canvas.height },
  );
  assert.equal(pack.campaign.offerId, "open_home_followup");
  assert.equal(pack.copyPacks[0]?.landingPage.headline, "Open-home follow-up guide");
  assert.equal(subhead?.content, pack.copyPacks[0]?.landingPage.subheadline);
  assert.doesNotMatch(String(subhead?.content ?? ""), /seller prep checklist/i);
  assert.ok(story.canvas.objects.findIndex((object) => object.role === "primary_image") < story.canvas.objects.findIndex((object) => object.role === "headline"));
  assert.ok(story.canvas.objects.findIndex((object) => object.role === "image_scrim") < story.canvas.objects.findIndex((object) => object.role === "headline"));
});

test("scoreAdStudioVariant weights offer clarity, relevance, intent, brand fit, compliance, and hierarchy", () => {
  const score = scoreAdStudioVariant({
    offerClarity: 18,
    localRelevance: 14,
    leadIntentStrength: 18,
    brandFit: 13,
    complianceSafety: 20,
    visualHierarchy: 8,
    notes: ["Strong checklist offer"],
    warnings: [],
  });

  assert.equal(score.score, 91);
  assert.deepEqual(score.notes, ["Strong checklist offer"]);
});

test("platform validators enforce Meta housing and Google Search limits outside prompts", () => {
  assert.deepEqual(
    validateMetaLeadAdPack({
      platform: "meta",
      specialAdCategory: null,
      primaryText: ["Thinking about selling in Scarborough?"],
      headlines: ["Seller checklist"],
      descriptions: ["Download the guide"],
      cta: "LEARN_MORE",
      leadForm: {
        headline: "Get the seller checklist",
        questions: [],
        privacyPolicyUrl: "https://northstar.example/privacy",
        thankYouScreen: { title: "Thanks", body: "Your checklist is on the way." },
      },
    }).issues.map((issue) => issue.code),
    ["meta_housing_special_category_required"],
  );

  assert.deepEqual(
    validateGoogleSearchPack({
      platform: "google_search",
      finalUrl: "https://northstar.example/seller-checklist",
      headlines: ["This headline is far too long for search ads", "Short one"],
      descriptions: ["A".repeat(91), "Short description"],
      paths: ["selling-in-scarborough", "guide"],
      keywords: [],
      negativeKeywords: [],
    }).issues.map((issue) => issue.code),
    [
      "google_search_min_headlines",
      "google_search_headline_too_long",
      "google_search_description_too_long",
      "google_search_path_too_long",
    ],
  );
});

test("validateProviderJsonOutput repairs invalid provider JSON once and hard-fails when repair is invalid", () => {
  const repaired = validateProviderJsonOutput({
    rawText: "{invalid",
    schemaName: "metaLeadAdPack",
    repair: () =>
      JSON.stringify({
        platform: "meta",
        specialAdCategory: "housing",
        primaryText: ["Thinking about selling in Scarborough?"],
        headlines: ["Seller checklist"],
        descriptions: ["Download the guide"],
        cta: "LEARN_MORE",
        leadForm: {
          headline: "Get the seller checklist",
          questions: [],
          privacyPolicyUrl: "https://northstar.example