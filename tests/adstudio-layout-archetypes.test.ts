import assert from "node:assert/strict";
import test from "node:test";

import {
  buildArchetypeCreative,
  extractBrandKitFromWebsite,
  generateAdStudioCampaignPack,
  runLayoutQA,
  selectLayoutArchetype,
} from "../src/lib/adstudio/index.ts";
import type { AdStudioCampaign, AdStudioCampaignVariant, AdStudioCreative } from "../src/lib/adstudio/types.ts";
import type { CreativeSkeleton } from "../src/lib/ad-template-library/skeleton.ts";

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
  assert.equal(image?.content, uploadedImage);
  assert.equal(image?.assetId, undefined);
  assert.equal(creative.canvas.composition?.id, "posterGradient");
  assert.deepEqual(
    { x: image?.x, y: image?.y, width: image?.width, height: image?.height },
    { x: 0, y: 0, width: creative.canvas.width, height: creative.canvas.height },
  );
  assert.ok(creative.canvas.objects.some((object) => object.role === "background_below" && object.locked));
  assert.ok(creative.canvas.objects.some((object) => object.role === "cta_text" && !object.locked));
});

test("every composite creative is tagged source=template_composite (both render paths)", () => {
  const pack = generateAdStudioCampaignPack({
    workspaceId: "workspace_demo",
    brandKit: approvedBrandKit(),
    goal: "appraisal_bookings",
    suburb: "Scarborough",
    city: "Perth",
    state: "WA",
    offerId: "home_value_update",
    platforms: ["meta"],
    // 4:5/1:1/9:16 exercise the composition path; 1.91:1 the archetype path.
    creativeFormats: ["4:5", "1:1", "9:16", "1.91:1"],
    variantCount: 2,
  });
  assert.ok(pack.creatives.length >= 8);
  for (const creative of pack.creatives) {
    assert.equal(creative.source, "template_composite", `format ${creative.format} missing composite source tag`);
  }
});

function miniCampaign(): AdStudioCampaign {
  return {
    campaignId: "camp_1",
    workspaceId: "workspace_demo",
    brandKitId: "bk_1",
    name: "Scarborough Just Sold",
    goal: "seller_leads",
    market: { country: "AU", state: "WA", city: "Perth", suburb: "Scarborough" },
    audienceIntent: "sellers",
    offerId: "recent_sales_report",
    platforms: ["meta"],
    creativeFormats: ["1.91:1"],
    status: "ready",
  };
}

function miniVariant(): AdStudioCampaignVariant {
  return {
    variantId: "var_1",
    campaignId: "camp_1",
    angle: "Recent result",
    headline: "Just sold in Scarborough",
    offer: "Recent sales report",
    cta: "Request update",
    score: {
      score: 90,
      notes: [],
      warnings: [],
      dimensions: { offerClarity: 20, localRelevance: 15, leadIntentStrength: 20, brandFit: 15, complianceSafety: 20, visualHierarchy: 10 },
    },
    status: "approved",
    lockedFields: [],
  };
}

function frameSkeleton(): CreativeSkeleton {
  return {
    version: 1,
    archetype: "just_sold",
    shot: { type: "exterior_hero", lighting: "golden hour", mood: "aspirational" },
    composition: {
      focal_point: "facade",
      horizon: "low",
      image_frames: [
        { id: "p", role: "primary", x: 0, y: 0, width: 1, height: 0.72 },
        { id: "h", role: "agent_headshot", x: 0.72, y: 0.7, width: 0.2, height: 0.2 },
      ],
      copy_safe_zones: [{ id: "z", x: 0.06, y: 0.74, width: 0.6, height: 0.2, priority: "primary" }],
    },
    color: { palette: ["#123456"], overlay: "bottom scrim", contrast: "high" },
    text_system: { headline_zone: "lower_left", badge: "sold_ribbon", cta_style: "solid_pill" },
    copy: { hook_style: "statement", headline_pattern: "Just sold in {suburb}", cta: "Request update" },
    variables: ["suburb"],
    confidence: 90,
  };
}

test("buildArchetypeCreative places multi-slot frames incl agent_headshot cut-out (archetype path)", () => {
  const brandKit = approvedBrandKit();
  const creative = buildArchetypeCreative({
    campaign: miniCampaign(),
    variant: miniVariant(),
    brandKit: { ...brandKit, assets: { ...brandKit.assets, listingImages: [], headshots: ["data:image/png;base64,HEAD"] } },
    format: "1.91:1", // archetype path (not a composition format)
    sourceImageDataUrl: "data:image/png;base64,USER",
    creativeSkeleton: frameSkeleton(),
  });

  const images = creative.canvas.objects.filter((object) => object.type === "image");
  const primary = images.find((object) => object.role === "primary_image");
  const headshot = images.find((object) => object.role === "agent_headshot_image");
  assert.equal(primary?.content, "data:image/png;base64,USER");
  assert.ok(headshot, "expected an agent_headshot image object");
  assert.equal(headshot?.clip, "circle");
  // The headshot renders as a clipped cut-out (circle) in the preview SVG.
  assert.match(creative.previewSvg, /clipPath/);
});

function skeletonWith(archetype: CreativeSkeleton["archetype"]): CreativeSkeleton {
  return {
    ...frameSkeleton(),
    archetype,
    // Neutral badge so the optional ribbon support object never differs by archetype.
    text_system: { headline_zone: "lower_left", badge: "clean panel", cta_style: "solid_pill" },
  };
}

test("frame-carrying template geometry is independent of the per-archetype recipe (Phase 8)", () => {
  const build = (archetype: CreativeSkeleton["archetype"]) =>
    buildArchetypeCreative({
      campaign: miniCampaign(),
      variant: miniVariant(),
      brandKit: approvedBrandKit(),
      format: "1.91:1",
      sourceImageDataUrl: "data:image/png;base64,USER",
      creativeSkeleton: skeletonWith(archetype),
    });

  const justSold = build("just_sold");
  const appraisal = build("appraisal");
  const headlineOf = (creative: AdStudioCreative) => creative.canvas.objects.find((object) => object.role === "headline");
  const a = headlineOf(justSold);
  const b = headlineOf(appraisal);
  assert.ok(a && b);
  // Same frames + copy-safe zones => same copy geometry, regardless of archetype.
  assert.deepEqual({ x: a.x, y: a.y, width: a.width }, { x: b.x, y: b.y, width: b.width });
});

test("agent_profile/brand skeletons are accepted and still place their frames", () => {
  const brandKit = approvedBrandKit();
  const creative = buildArchetypeCreative({
    campaign: miniCampaign(),
    variant: miniVariant(),
    brandKit: { ...brandKit, assets: { ...brandKit.assets, headshots: ["data:image/png;base64,HEAD"] } },
    format: "1.91:1",
    sourceImageDataUrl: "data:image/png;base64,USER",
    creativeSkeleton: skeletonWith("agent_profile"),
  });
  assert.ok(creative.canvas.objects.some((object) => object.role === "agent_headshot_image"));
  assert.ok(creative.canvas.objects.some((object) => object.role === "headline"));
});

test("buildArchetypeCreative keeps a single full-bleed image when the template has no frames", () => {
  const creative = buildArchetypeCreative({
    campaign: miniCampaign(),
    variant: miniVariant(),
    brandKit: approvedBrandKit(),
    format: "1.91:1",
    sourceImageDataUrl: "data:image/png;base64,USER",
    // no creativeSkeleton => full-bleed fallback
  });
  const images = creative.canvas.objects.filter((object) => object.type === "image");
  assert.equal(images.length, 1);
  assert.equal(images[0]?.role, "primary_image");
  assert.equal(images[0]?.width, creative.canvas.width);
  assert.equal(images[0]?.height, creative.canvas.height);
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
