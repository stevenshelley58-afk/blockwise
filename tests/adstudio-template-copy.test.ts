import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  AD_STUDIO_TEMPLATES,
  extractBrandKitFromWebsite,
  generateAdStudioCampaignPack,
} from "../src/lib/adstudio/index.ts";
import { applyProvidedCopyToCampaignPack } from "../src/lib/adstudio/campaign-copy-enrichment.ts";

function brandKit() {
  return {
    ...extractBrandKitFromWebsite({
      workspaceId: "workspace_template_copy",
      websiteUrl: "https://copywire.example",
      marketCountry: "AU",
      htmlByUrl: { "https://copywire.example": "<html><head><title>Copy Realty</title></head><body></body></html>" },
    }),
    reviewStatus: "approved" as const,
  };
}

const IMAGE = "data:image/png;base64,AAAAprimary";

function buildTemplatePack(variantCount = 2) {
  const template = AD_STUDIO_TEMPLATES[0];
  assert.ok(template, "a template must be installed");
  return generateAdStudioCampaignPack({
    workspaceId: "workspace_template_copy",
    brandKit: brandKit(),
    goal: template.goal,
    suburb: "Scarborough",
    city: "Perth",
    state: "WA",
    offerId: template.offerId,
    platforms: ["meta"],
    variantCount,
    firstAd: {
      source: "gallery",
      templateId: template.id,
      description: "Open home Saturday, 18 Smith St Scarborough.",
      imageDataUrl: IMAGE,
      imageDataUrls: { property_photo: IMAGE, brand_logo: IMAGE },
      templateCloneImage: IMAGE,
      templateCloneImagesByFormat: { "4:5": IMAGE, "9:16": IMAGE },
      formats: ["9:16", "4:5"],
    },
  });
}

test("applyProvidedCopyToCampaignPack replaces offer-library copy on every variant", () => {
  const pack = buildTemplatePack(2);
  const provided = {
    primaryText: "Open home this Saturday at 18 Smith St, Scarborough. Renovated family home.",
    headline: "Scarborough open home Saturday",
    description: "Renovated 3-bed family home near the beach.",
    cta: "Book an appraisal",
  };

  const applied = applyProvidedCopyToCampaignPack(pack, provided);

  assert.ok(applied.variants.length >= 1, "fixture should produce at least one variant");
  for (const variant of applied.variants) {
    const copyPack = applied.copyPacks.find((candidate) => candidate.variantId === variant.variantId);
    assert.ok(copyPack, "every variant keeps a copy pack");
    assert.equal(copyPack.meta.primaryText[0], provided.primaryText);
    assert.equal(copyPack.meta.headlines[0], provided.headline);
    assert.equal(copyPack.meta.descriptions[0], provided.description);
    // "Book an appraisal" must map to the contact CTA, not collapse to LEARN_MORE.
    assert.equal(copyPack.meta.cta, "CONTACT_US");
    assert.equal(variant.headline, provided.headline);
  }

  // Compliance is re-run on the provided copy, not left stale from generation.
  assert.ok(applied.compliance.checkedAt, "compliance review must be recomputed");
  assert.notEqual(applied.campaign.status, undefined);
});

test("customer copy is merged before the single server-side clone flow", () => {
  const dialog = readFileSync("src/components/adstudio/new-ad-dialog.tsx", "utf8");
  const createRoute = readFileSync("src/app/api/adstudio/campaigns/route.ts", "utf8");
  const generation = readFileSync("src/lib/adstudio/generate-template-campaign.ts", "utf8");
  const copyGeneration = readFileSync("src/lib/adstudio/copy-generation.ts", "utf8");

  // The dialog no longer orchestrates copy/clone calls client-side — the whole
  // pipeline runs server-side (async job or the sync route fallback).
  assert.doesNotMatch(dialog, /\/api\/adstudio\/copy["'`]/);
  assert.doesNotMatch(dialog, /\/api\/adstudio\/generate-clone/);
  assert.doesNotMatch(dialog, /generateTemplateFieldsCopy/);

  // Server pipeline: the copy pass runs before the clone so the image carries
  // the user's copy; both the on-image fields and the feed copy travel onward.
  // Customer-typed on-image values (firstAd.onImageCopy) override the model's
  // suggestions VERBATIM — the anti-fabrication contract.
  assert.match(generation, /generateAdStudioTemplateCopy\(\{/);
  assert.match(generation, /\.\.\.copyResult\.onImage, \.\.\.customerOnImage/);
  assert.match(generation, /firstAd\.onImageCopy\?\.\[field\.key\]/);
  assert.match(generation, /copy: onImageCopy/);
  assert.match(generation, /copy: copyResult\.copy/);
  assert.ok(
    generation.indexOf("generateAdStudioTemplateCopy({") < generation.indexOf("buildTemplateCloneRequestsByFormat(template"),
    "copy generation must run before the clone so the image carries the user's copy",
  );

  // The campaign route has one generation call and no old fallback branch.
  assert.match(generation, /applyProvidedCopyToCampaignPack/);
  assert.match(createRoute, /runTemplateCampaignGeneration/);
  assert.doesNotMatch(createRoute, /generateAdStudioCampaignPack\(\{/);

  // The on-image instruction forbids reusing sample facts; field values are
  // clamped to the template's declared maxLength.
  assert.match(copyGeneration, /NEVER reuse the sample's facts/);
  assert.match(copyGeneration, /field\.maxLength && value\.length > field\.maxLength/);
  assert.match(copyGeneration, /PRIMARY_TEXT_FORMATTING_INSTRUCTION/);
  assert.match(copyGeneration, /actual newline characters/);
  assert.match(copyGeneration, /one-line hook followed by 2-4 short benefit or offer lines/);
});
