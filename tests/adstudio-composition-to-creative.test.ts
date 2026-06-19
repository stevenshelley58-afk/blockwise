import assert from "node:assert/strict";
import test from "node:test";

import { buildCreativeDesignJson } from "../src/lib/adstudio/creative-design-builder.ts";
import { BLOCKWISE_FABRIC_META_KEY, editableKindForObject, syncCreativeWithCopyAndImage } from "../src/lib/adstudio/creative-design-json.ts";
import { COMPOSITION_IDS, type CompositionCopy, type CompositionId } from "../src/lib/adstudio/creative/compositions.ts";
import { compositionToCreative } from "../src/lib/adstudio/creative/composition-to-creative.ts";
import { buildPalette, fontStacks } from "../src/lib/adstudio/creative/preview-engine.ts";
import type { AdStudioBrandKit } from "../src/lib/adstudio/types.ts";

const copy: CompositionCopy = {
  brand: "Realty Plus",
  eyebrow: "Local guide",
  headline: "A clearer local property move",
  subhead: "Useful local context before you decide what comes next.",
  cta: "Get the guide",
  stat: "+12.4%",
  statLabel: "local market movement",
  features: ["Recent local activity", "Plain-English context", "Owner next steps"],
};

test("compositionToCreative exposes locked baked layers and editable roles for every composition", () => {
  for (const compositionId of COMPOSITION_IDS) {
    const creative = buildCreative(compositionId);
    const roles = creative.canvas.objects.map((object) => object.role);

    assert.equal(creative.canvas.composition?.id, compositionId);
    assert.equal(creative.canvas.objects[0]?.role, "background_below");
    assert.equal(creative.canvas.objects[0]?.locked, true);
    assert.ok(roles.includes("headline"), `${compositionId} is missing headline`);
    assert.ok(roles.includes("cta_button"), `${compositionId} is missing CTA button`);
    assert.ok(roles.includes("cta_text"), `${compositionId} is missing CTA text`);
    assert.ok(roles.includes("brand_logo"), `${compositionId} is missing brand`);
    if (compositionId !== "valueForm") {
      assert.ok(roles.includes("primary_image"), `${compositionId} is missing primary image`);
    }
    assert.match(creative.previewSvg, /^<svg[\s>]/u);
    assert.match(creative.previewSvg, /Realty Plus/u);
    assert.equal(creative.canvas.objects.find((object) => object.role === "headline")?.content, copy.headline);
  }
});

test("composition clips flow into design JSON and editable kind mapping", () => {
  const arch = buildCreative("bannerArch");
  const circle = buildCreative("quoteProof");
  assert.equal(arch.canvas.objects.find((object) => object.role === "primary_image")?.clip, "arch");
  assert.equal(circle.canvas.objects.find((object) => object.role === "primary_image")?.clip, "circle");
  assert.equal(editableKindForObject({ role: "headline", type: "text" }), "headline");
  assert.equal(editableKindForObject({ role: "subheadline", type: "text" }), "description");
  assert.equal(editableKindForObject({ role: "cta_text", type: "text" }), "cta");
  assert.equal(editableKindForObject({ role: "primary_image", type: "image" }), "image");
});

test("composition copy and image sync re-renders without leaving stale headline text", () => {
  const creative = buildCreative("split");
  const updated = syncCreativeWithCopyAndImage(
    creative,
    {
      headline: "Updated local result",
      description: "Fresh description",
      cta: "Book now",
    },
    "data:image/png;base64,updated",
  );

  assert.equal(updated.canvas.composition?.copy.headline, "Updated local result");
  assert.equal(updated.canvas.objects.find((object) => object.role === "headline")?.content, "Updated local result");
  assert.equal(updated.canvas.objects.find((object) => object.role === "primary_image")?.content, "data:image/png;base64,updated");
  assert.match(updated.previewSvg, /Updated/u);
  assert.doesNotMatch(updated.previewSvg, /A clearer/u);
});

test("composition creative design JSON keeps z-order and lock state", () => {
  const creative = buildCreative("split");
  const json = buildCreativeDesignJson({
    creative,
    brandKit: brandKit(),
    copy: {
      headline: copy.headline,
      description: copy.subhead,
      cta: copy.cta,
    },
    imageSrc: "data:image/png;base64,photo",
  });
  const roles = json.objects.map((object) => object[BLOCKWISE_FABRIC_META_KEY]?.role);

  assert.deepEqual(roles.slice(0, 3), ["background_below", "primary_image", "background_above"]);
  assert.equal(json.objects.find((object) => object[BLOCKWISE_FABRIC_META_KEY]?.role === "background_below")?.selectable, false);
  assert.equal(json.objects.find((object) => object[BLOCKWISE_FABRIC_META_KEY]?.role === "headline")?.selectable, true);
  assert.equal(json.objects.find((object) => object[BLOCKWISE_FABRIC_META_KEY]?.role === "primary_image")?.src, "data:image/png;base64,photo");
});

function buildCreative(compositionId: CompositionId) {
  return compositionToCreative({
    compositionId,
    format: "4:5",
    palette: buildPalette("#123e75", "#e7b24b"),
    stacks: fontStacks("Georgia", "Inter"),
    copy,
    photoSrc: "data:image/png;base64,photo",
    ids: {
      creativeId: `creative_${compositionId}`,
      campaignId: "campaign_demo",
      variantId: "variant_demo",
    },
    safeZones: {
      metaStory: false,
      googleDemandGen: true,
    },
    paletteSeed: {
      primary: "#123e75",
      accent: "#e7b24b",
    },
    fontSeed: {
      headingFont: "Georgia",
      bodyFont: "Inter",
    },
  });
}

function brandKit(): AdStudioBrandKit {
  return {
    brandKitId: "brand_demo",
    workspaceId: "workspace_demo",
    source: { type: "website", url: "https://realty.example", lastExtractedAt: new Date(0).toISOString(), pagesScanned: [] },
    identity: { businessName: "Realty Plus", tradingName: "Realty Plus", marketCountry: "AU", marketRegion: "WA", licenceText: null },
    logos: { primaryLogoUrl: null, darkLogoUrl: null, lightLogoUrl: null, faviconUrl: null },
    colours: { primary: "#123e75", secondary: "#d9e7e3", accent: "#e7b24b", background: "#ffffff", text: "#10151f", confidence: { primary: 1, secondary: 1 } },
    typography: { headingFont: "Georgia", bodyFont: "Inter", fallbackHeading: "serif", fallbackBody: "sans-serif" },
    visualStyle: { styleTags: [], imageTreatment: "natural", layoutDensity: "medium", cornerRadius: "medium" },
    tone: { voice: "plain", avoid: [], preferredPhrases: [], sampleCopy: [] },
    assets: { headshots: [], officeImages: [], listingImages: [], socialProofImages: [] },
    contact: { phone: null, email: null, address: null, socialLinks: [] },
    compliance: { disclaimers: [], privacyPolicyUrl: null, termsUrl: null },
    reviewStatus: "approved",
    lockedFields: [],
  };
}
