import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { AD_STUDIO_TEMPLATES, extractBrandKitFromWebsite, generateAdStudioCampaignPack } from "../src/lib/adstudio/index.ts";
import { syncCreativeWithCopyAndImage } from "../src/lib/adstudio/creative-design-json.ts";

function brandKit() {
  return {
    ...extractBrandKitFromWebsite({
      workspaceId: "workspace_wiring",
      websiteUrl: "https://wire.example",
      marketCountry: "AU",
      htmlByUrl: { "https://wire.example": "<title>Wire Realty</title>" },
    }),
    reviewStatus: "approved" as const,
  };
}

test("a selected template cannot be opened as layers before a clone exists", () => {
  const template = AD_STUDIO_TEMPLATES[0]!;
  assert.throws(() => generateAdStudioCampaignPack({
    workspaceId: "workspace_wiring",
    brandKit: brandKit(),
    goal: template.goal,
    suburb: "Scarborough",
    city: "Perth",
    state: "WA",
    offerId: template.offerId,
    platforms: ["meta"],
    variantCount: 1,
    firstAd: {
      source: "gallery",
      templateId: template.id,
      description: "Listing launch",
      imageDataUrl: "data:image/png;base64,PHOTO",
      formats: ["9:16", "4:5"],
    },
  }), /must be cloned before it can be opened or edited/);
});
test("the finished clone is one flat creative, ready for image-anchored editing", () => {
  const template = AD_STUDIO_TEMPLATES[0]!;
  const feed = "/api/adstudio/media?path=clone-feed.png";
  const story = "/api/adstudio/media?path=clone-story.png";
  const pack = generateAdStudioCampaignPack({
    workspaceId: "workspace_wiring",
    brandKit: brandKit(),
    goal: template.goal,
    suburb: "Scarborough",
    city: "Perth",
    state: "WA",
    offerId: template.offerId,
    platforms: ["meta"],
    variantCount: 1,
    firstAd: {
      source: "gallery",
      templateId: template.id,
      description: "Listing launch",
      imageDataUrl: feed,
      templateCloneImage: feed,
      templateCloneImagesByFormat: { "4:5": feed, "9:16": story },
      formats: ["9:16", "4:5"],
    },
  });
  assert.deepEqual(pack.creatives.map((creative) => creative.format).sort(), ["4:5", "9:16"]);
  for (const creative of pack.creatives) {
    assert.equal(creative.canvas.objects.length, 1);
    assert.equal(creative.canvas.objects[0]?.objectId, "template_clone_image");
    assert.equal(creative.canvas.objects.some((object) => object.type === "text"), false);
    assert.equal(creative.canvas.fabricJson, null);
    const synced = syncCreativeWithCopyAndImage(
      creative,
      { headline: "SHOULD NOT REWRITE", description: "SHOULD NOT REWRITE", cta: "SHOULD NOT REWRITE" },
      "/api/adstudio/media?path=shared-picker-image.png",
    );
    assert.equal(synced, creative, "generic autosave must leave the finished clone untouched");
  }
});

test("draft image syncing keeps a durable image reference for layered legacy creatives", () => {
  const legacy = generateAdStudioCampaignPack({
    workspaceId: "workspace_wiring",
    brandKit: brandKit(),
    goal: "seller_leads",
    suburb: "Scarborough",
    city: "Perth",
    state: "WA",
    offerId: "seller_prep_checklist",
    platforms: ["meta"],
    variantCount: 1,
    sourceImageDataUrl: "/api/adstudio/media?path=old.png",
  }).creatives[0]!;
  const image = syncCreativeWithCopyAndImage(
    legacy,
    { headline: "Headline", description: "Description", cta: "Learn more" },
    "/api/adstudio/media?path=new.png",
  ).canvas.objects.find((object) => object.role === "primary_image");

  assert.equal(image?.content, "/api/adstudio/media?path=new.png");
  assert.equal(image?.assetId, "/api/adstudio/media?path=new.png");
});

test("the active workbench has one post-clone editor and no Fabric editor", () => {
  const workbench = readFileSync("src/components/adstudio/ad-studio-workbench.tsx", "utf8");
  assert.match(workbench, /<InPlaceAdEditor/);
  assert.doesNotMatch(workbench, /FabricAdEditor|fabric-ad-editor/);
  assert.match(workbench, /if \(isCloneCreative\(currentCreative\)\)/);
});
