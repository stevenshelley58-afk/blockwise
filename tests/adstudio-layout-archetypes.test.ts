import assert from "node:assert/strict";
import test from "node:test";

import {
  extractBrandKitFromWebsite,
  generateAdStudioCampaignPack,
  runLayoutQA,
  selectLayoutArchetype,
} from "../src/lib/adstudio/index.ts";
import type { AdStudioCreative } from "../src/lib/adstudio/types.ts";

const sampleHtml = `
  <html>
    <head>
      <title>Northstar Realty Perth</title>
      <meta property="og:site_name" content="Northstar Realty">
      <style>
        :root { --brand: #087f7a; }
        body { font-family: Inter, sans-serif; color: #18201f; }
      </style>
    </head>
    <body>
      <img src="/logo.svg" alt="Northstar Realty logo">
      <p>Information is general only. Speak with a licensed local agent.</p>
    </body>
  </html>
`;

function approvedBrandKit() {
  return {
    ...extractBrandKitFromWebsite({
      workspaceId: "workspace_demo",
      websiteUrl: "https://northstar.example",
      marketCountry: "AU",
      htmlByUrl: {
        "https://northstar.example": sampleHtml,
      },
    }),
    reviewStatus: "approved" as const,
  };
}

test("selectLayoutArchetype maps the supported real estate archetypes deterministically", () => {
  assert.equal(selectLayoutArchetype(baseSelection({ templateId: "just_listed", offerId: "home_value_update" })), "listing_hero");
  assert.equal(selectLayoutArchetype(baseSelection({ templateId: "coming_soon", offerId: "home_value_update" })), "coming_soon");
  assert.equal(selectLayoutArchetype(baseSelection({ templateId: "open_home", offerId: "open_home_followup" })), "open_home");
  assert.equal(selectLayoutArchetype(baseSelection({ templateId: "just_sold", offerId: "recent_sales_report" })), "just_sold");
  assert.equal(selectLayoutArchetype(baseSelection({ templateId: "market_update", offerId: "suburb_market_report" })), "market_stat");
  assert.equal(selectLayoutArchetype(baseSelection({ templateId: "free_appraisal", offerId: "home_value_update" })), "appraisal");
  assert.equal(selectLayoutArchetype(baseSelection({ templateId: "seller_checklist" })), "seller_guide");
  assert.equal(selectLayoutArchetype(baseSelection({ templateId: "buyer_demand", offerId: "home_value_update" })), "social_proof");
});

test("generated first-ad creative keeps uploaded owner image as the source visual", () => {
  const uploadedImage = "data:image/png;base64,iVBORw0KGgo=";
  const pack = generateAdStudioCampaignPack({
    workspaceId: "workspace_demo",
    brandKit: approvedBrandKit(),
    goal: "seller_leads",
    suburb: "Scarborough",
    city: "Perth",
    state: "WA",
    offerId: "seller_prep_checklist",
    platforms: ["meta"],
    variantCount: 1,
    firstAd: {
      mode: "template",
      templateId: "coming_soon",
      description: "Coming soon listing for local owners.",
      imageDataUrl: uploadedImage,
      formats: ["9:16", "4:5", "1:1"],
    },
  });
  const creative = pack.creatives.find((item) => item.format === "9:16");
  assert.ok(creative);

  const image = creative.canvas.objects.find((object) => object.role === "primary_image");
  const announcementBand = creative.canvas.objects.find((object) => object.role === "announcement_band");
  assert.equal(image?.content, uploadedImage);
  assert.equal(image?.assetId, undefined);
  assert.deepEqual(
    { x: image?.x, y: image?.y, width: image?.width, height: image?.height },
    { x: 0, y: 0, width: creative.canvas.width, height: creative.canvas.height },
  );
  assert.ok(announcementBand, "coming_soon archetype should add its support band");
});

test("layout QA passes generated archetype creatives and reports deterministic failures", () => {
  const pack = generateAdStudioCampaignPack({
    workspaceId: "workspace_demo",
    brandKit: approvedBrandKit(),
    goal: "appraisal_bookings",
    suburb: "Scarborough",
    city: "Perth",
    state: "WA",
    offerId: "home_value_update",
    platforms: ["meta"],
    creativeFormats: ["4:5"],
    variantCount: 1,
  });
  const creative = pack.creatives[0];
  assert.ok(creative);

  const result = runLayoutQA(creative);
  assert.equal(result.pass, true, JSON.stringify(result, null, 2));
  assert.deepEqual(Object.keys(result.checks), ["overlap", "readability", "cta", "logo", "safeZone"]);

  const badCreative: AdStudioCreative = {
    ...creative,
    canvas: {
      ...creative.canvas,
      objects: creative.canvas.objects.map((object) => {
        if (object.role === "subheadline") return { ...object, y: 10, height: 4 };
        return object;
      }),
    },
  };
  const failed = runLayoutQA(badCreative);
  assert.equal(failed.pass, false);
  assert.deepEqual(
    failed.checks.readability.issues.map((issue) => issue.code),
    ["layout_text_clipped"],
  );
  assert.ok(failed.checks.safeZone.issues.length > 0);
});

function baseSelection(overrides: Partial<Parameters<typeof selectLayoutArchetype>[0]>) {
  return {
    offerId: "seller_prep_checklist",
    goal: "seller_leads" as const,
    ...overrides,
  };
}
