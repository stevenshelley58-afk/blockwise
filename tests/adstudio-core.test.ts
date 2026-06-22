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
  resolveAdStudioTemplate,
} from "../src/lib/adstudio/index.ts";
import { repairCreativeTextLayout } from "../src/lib/adstudio/creative-design-json.ts";
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

test("generated creative layout keeps wrapped headline, subhead, and CTA separated", () => {
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
    goal: "seller_leads",
    suburb: "Spearwood",
    city: "Perth",
    state: "WA",
    offerId: "seller_prep_checklist",
    platforms: ["meta"],
    creativeFormats: ["4:5"],
    variantCount: 3,
  });
  const wrappedVariant = pack.variants.find((variant) => variant.headline === "Know what to sort before you list");
  assert.ok(wrappedVariant);
  const creative = pack.creatives.find((item) => item.variantId === wrappedVariant.variantId && item.format === "4:5");
  assert.ok(creative);

  const headline = creative.canvas.objects.find((object) => object.role === "headline");
  const subhead = creative.canvas.objects.find((object) => object.role === "subheadline");
  const cta = creative.canvas.objects.find((object) => object.role === "cta_button");
  assert.ok(headline);
  assert.ok(subhead);
  assert.ok(cta);

  const headlineBottom = headline.y + (headline.height ?? 0);
  const subheadBottom = subhead.y + (subhead.height ?? 0);
  assert.ok((headline.height ?? 0) > (headline.size ?? 0) * 1.5, "headline fixture should wrap to multiple lines");
  assert.ok(subhead.y - headlineBottom >= 18, `subhead overlaps headline: ${JSON.stringify({ headline, subhead })}`);
  assert.ok(cta.y - subheadBottom >= 24, `CTA crowds subhead: ${JSON.stringify({ subhead, cta })}`);
});

test("creative layout repair fixes existing overlapped generated canvases", () => {
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
    goal: "seller_leads",
    suburb: "Spearwood",
    city: "Perth",
    state: "WA",
    offerId: "seller_prep_checklist",
    platforms: ["meta"],
    creativeFormats: ["4:5"],
    variantCount: 3,
  });
  const creative = pack.creatives[0];
  assert.ok(creative);
  const badCreative = {
    ...creative,
    canvas: {
      ...creative.canvas,
      objects: creative.canvas.objects.map((object) => {
        if (object.role === "headline") {
          return { ...object, content: "Spearwood house hitting market soon", height: undefined };
        }
        if (object.role === "subheadline") {
          return { ...object, y: object.y - 80, height: undefined };
        }
        return object;
      }),
    },
  };

  const repaired = repairCreativeTextLayout(badCreative);
  const headline = repaired.canvas.objects.find((object) => object.role === "headline");
  const subhead = repaired.canvas.objects.find((object) => object.role === "subheadline");
  assert.ok(headline);
  assert.ok(subhead);
  assert.ok(subhead.y >= headline.y + (headline.height ?? 0) + 18);
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

test("template first-ad generation uses prepared photo assets per creative format", () => {
  const brandKit = extractBrandKitFromWebsite({
    workspaceId: "workspace_demo",
    websiteUrl: "https://northstar.example",
    marketCountry: "AU",
    htmlByUrl: {
      "https://northstar.example": sampleHtml,
    },
  });
  const template = resolveAdStudioTemplate("meta_002");

  const pack = generateAdStudioCampaignPack({
    workspaceId: "workspace_demo",
    brandKit: { ...brandKit, reviewStatus: "approved" as const },
    goal: "seller_leads",
    suburb: "Bicton",
    city: "Perth",
    state: "WA",
    offerId: "prelisting_timeline",
    platforms: ["meta"],
    variantCount: 1,
    firstAd: {
      mode: "template",
      source: "template_library",
      templateKey: template.templateKey ?? template.id,
      description: "Agent-led property planning for local owners.",
      imageDataUrl: "data:image/png;base64,original",
      formats: ["9:16", "4:5", "1:1"],
    },
    resolvedTemplate: template,
    sourceImagesByFormat: {
      "9:16": "/api/adstudio/media?path=workspace_demo%2Fadstudio%2Fphoto-prep%2Fstory.png",
      "4:5": "/api/adstudio/media?path=workspace_demo%2Fadstudio%2Fphoto-prep%2Ffeed.png",
      "1:1": "/api/adstudio/media?path=workspace_demo%2Fadstudio%2Fphoto-prep%2Fsquare.png",
    },
  });

  const imageByFormat = Object.fromEntries(
    pack.creatives.map((creative) => [
      creative.format,
      creative.canvas.objects.find((object) => object.role === "primary_image")?.content,
    ]),
  );

  assert.equal(imageByFormat["9:16"], "/api/adstudio/media?path=workspace_demo%2Fadstudio%2Fphoto-prep%2Fstory.png");
  assert.equal(imageByFormat["4:5"], "/api/adstudio/media?path=workspace_demo%2Fadstudio%2Fphoto-prep%2Ffeed.png");
  assert.equal(imageByFormat["1:1"], "/api/adstudio/media?path=workspace_demo%2Fadstudio%2Fphoto-prep%2Fsquare.png");
  assert.notEqual(imageByFormat["9:16"], imageByFormat["4:5"]);
});

test("template first-ad generation binds uploaded images to distinct template slots", () => {
  const brandKit = extractBrandKitFromWebsite({
    workspaceId: "workspace_demo",
    websiteUrl: "https://northstar.example",
    marketCountry: "AU",
    htmlByUrl: {
      "https://northstar.example": sampleHtml,
    },
  });
  const template = resolveAdStudioTemplate("gold_interior_design_collage");
  const slotImages = {
    primary_photo: "data:image/png;base64,PRIMARY",
    secondary_top: "data:image/png;base64,TOP",
    secondary_mid: "data:image/png;base64,MID",
    secondary_low: "data:image/png;base64,LOW",
  };

  const pack = generateAdStudioCampaignPack({
    workspaceId: "workspace_demo",
    brandKit: { ...brandKit, reviewStatus: "approved" as const },
    goal: "seller_leads",
    suburb: "Mount Lawley",
    city: "Perth",
    state: "WA",
    offerId: "download_guide",
    platforms: ["meta"],
    variantCount: 1,
    firstAd: {
      mode: "template",
      source: "template_library",
      templateId: template.id,
      templateKey: template.templateKey ?? template.id,
      description: "Interior design collage for a family home.",
      imageDataUrl: slotImages.primary_photo,
      imageDataUrls: Object.values(slotImages),
      imageSlotDataUrls: slotImages,
      formats: ["9:16", "4:5", "1:1"],
    },
    resolvedTemplate: template,
  });

  const feed = pack.creatives.find((creative) => creative.format === "4:5");
  assert.ok(feed);

  const imagesBySlot = Object.fromEntries(
    feed.canvas.objects
      .filter((object) => object.type === "image")
      .map((object) => [object.sourceLayerId, object.content]),
  );
  assert.equal(imagesBySlot.primary_photo, slotImages.primary_photo);
  assert.equal(imagesBySlot.secondary_top, slotImages.secondary_top);
  assert.equal(imagesBySlot.secondary_mid, slotImages.secondary_mid);
  assert.equal(imagesBySlot.secondary_low, slotImages.secondary_low);
});

test("template generation treats observed ads as evidence, not the campaign source", () => {
  const brandKit = extractBrandKitFromWebsite({
    workspaceId: "workspace_demo",
    websiteUrl: "https://northstar.example",
    marketCountry: "AU",
    htmlByUrl: {
      "https://northstar.example": sampleHtml,
    },
  });
  const template = resolveAdStudioTemplate("meta_055");

  const pack = generateAdStudioCampaignPack({
    workspaceId: "workspace_demo",
    brandKit: { ...brandKit, reviewStatus: "approved" as const },
    goal: "seller_leads",
    suburb: "North Perth",
    city: "Perth",
    state: "WA",
    offerId: "recent_sales_report",
    platforms: ["meta"],
    firstAd: {
      mode: "template",
      source: "template_library",
      templateKey: template.templateKey ?? template.id,
      description: "Recent sale context for North Perth owners.",
      imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      formats: ["9:16", "4:5", "1:1"],
    },
    resolvedTemplate: {
      ...template,
      source: "radar",
      exemplars: ["observed-ad-evidence-1"],
    },
  });

  assert.equal(pack.campaign.templateKey, "meta_055");
  assert.equal(pack.campaign.sourceObservedAdId, null);
  assert.deepEqual(pack.campaign.templateSnapshot?.exemplars, ["observed-ad-evidence-1"]);
});

test("ad radar inspiration keeps the explicitly copied observed ad id", () => {
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
    goal: "seller_leads",
    suburb: "Scarborough",
    city: "Perth",
    state: "WA",
    offerId: "seller_prep_checklist",
    platforms: ["meta"],
    firstAd: {
      mode: "custom",
      source: "ad_radar",
      observedAdId: "observed-ad-user-picked",
      description: "Use this competitor angle but make it our own.",
      imageDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      formats: ["9:16", "4:5", "1:1"],
    },
  });

  assert.equal(pack.campaign.templateKey, null);
  assert.equal(pack.campaign.sourceObservedAdId, "observed-ad-user-picked");
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
          privacyPolicyUrl: "https://northstar.example/privacy",
          thankYouScreen: { title: "Thanks", body: "Your checklist is on the way." },
        },
      }),
  });

  assert.equal(repaired.ok, true);
  assert.equal(repaired.repaired, true);

  const failed = validateProviderJsonOutput({
    rawText: "{invalid",
    schemaName: "metaLeadAdPack",
    repair: () => "{still invalid",
  });

  assert.equal(failed.ok, false);
  assert.match(failed.error, /Provider output was not valid JSON/);
});

test("buildAdStudioExportPackage emits the required manifest and file paths", async () => {
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
    goal: "seller_leads",
    suburb: "Scarborough",
    city: "Perth",
    state: "WA",
    offerId: "seller_prep_checklist",
    platforms: ["meta", "google_search", "google_pmax", "google_demand_gen"],
    variantCount: 2,
  });
  const exportPackage = await buildAdStudioExportPackage(pack);

  assert.equal(exportPackage.manifest.campaignId, pack.campaign.campaignId);
  assert.ok(exportPackage.files["manifest.json"]);
  assert.ok(exportPackage.files["meta/copy.json"]);
  assert.ok(exportPackage.files["google-search/responsive_search_ads.csv"]);
  assert.ok(exportPackage.files["google-pmax/copy.json"]);
  assert.ok(exportPackage.files["demand-gen/copy.json"]);
  assert.ok(exportPackage.files["compliance/compliance_report.pdf"].byteLength > 40);
  assert.ok(exportPackage.zipBytes.byteLength > 100);
});

test("stored creative export renders hydrate from workspace storage before packaging", async () => {
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
    goal: "seller_leads",
    suburb: "Scarborough",
    city: "Perth",
    state: "WA",
    offerId: "seller_prep_checklist",
    platforms: ["meta"],
    variantCount: 1,
  });
  const creative = pack.creatives.find((item) => item.format === "1:1");
  assert.ok(creative);

  const storagePath = "workspace_demo/adstudio/exports/campaign/render.png";
  const storedBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const hydrated = await hydrateStoredCreativeExportRenders(
    {
      storage: {
        from(bucket: string) {
          assert.equal(bucket, "workspace-artifacts");
          return {
            async download(path: string) {
              assert.equal(path, storagePath);
              return { data: new Blob([storedBytes], { type: "image/png" }), error: null };
            },
          };
        },
      },
    },
    "workspace_demo",
    [
      {
        creativeId: creative.creativeId,
        variantId: creative.variantId,
        format: creative.format,
        width: creative.canvas.width,
        height: creative.canvas.height,
        mimeType: "image/png",
        storagePath,
      },
    ],
  );

  assert.match(hydrated?.[0]?.dataUrl ?? "", /^data:image\/png;base64,/);
  const exportPackage = await buildAdStudioExportPackage(pack, { creativeRenders: hydrated });
  assert.deepEqual([...exportPackage.files["meta/feed_1x1.png"]], [...storedBytes]);

  await assert.rejects(
    () =>
      hydrateStoredCreativeExportRenders({ storage: { from: () => ({ download: async () => ({ data: null }) }) } }, "workspace_demo", [
        {
          creativeId: creative.creativeId,
          variantId: creative.variantId,
          format: creative.format,
          width: creative.canvas.width,
          height: creative.canvas.height,
          mimeType: "image/png",
          storagePath: "other_workspace/adstudio/exports/render.png",
        },
      ]),
    /not found/,
  );
});
