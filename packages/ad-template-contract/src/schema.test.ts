import assert from "node:assert/strict";
import test from "node:test";
import { adTemplateSchema } from "./schema.ts";

const rect = { x: 0, y: 0, width: 1080, height: 1350 };
const base = {
  schema: "blockwise.ad-template",
  templateId: "strict-template",
  createdAt: "2026-08-30T00:00:00.000Z",
  feedLayout: { placement: "feed", layers: [{ type: "plate", layerId: "feed-bg", colourRole: "background", geometry: rect, protected: true }], safeZones: [] },
  storyLayout: { placement: "story", layers: [{ type: "plate", layerId: "story-bg", colourRole: "background", geometry: { ...rect, height: 1920 }, protected: true }], safeZones: [] },
  imageInputs: [{ key: "hero", label: "Hero", acceptedTypes: ["image/webp"], defaultAssetKey: "hero-asset" }],
  textInputs: [{ key: "headline", label: "Headline", placeholder: "Hello", maxLength: 80 }],
  semanticColours: { background: "#fff", primary: "#111", secondary: "#222", accent: "#333", mainText: "#111", inverseText: "#fff" },
  assets: { "hero-asset": { fileName: "hero.webp", mimeType: "image/webp" } },
  fonts: [{ file: "manrope-400.woff2" }],
  metadata: {
    title: "Strict template", description: "A valid direct template",
    gallerySamples: { feed: { placement: "feed", purpose: "gallery" }, story: { placement: "story", purpose: "gallery" } },
    metaCopyDefaults: { primaryText: [], headlines: [], descriptions: [], cta: "LEARN_MORE" },
    aiWritingGuidance: { summary: "Use verified claims.", fields: {} },
    publishRequirements: { objective: "OUTCOME_LEADS", specialAdCategory: null, instantForm: { required: false, dependency: null }, destination: { required: false, kind: "none", dependency: null }, requiredCtaTypes: [] },
    replacementAssets: [{ inputKey: "hero", assetKey: "hero-asset" }],
    realAssetRefs: [{ inputKey: "hero", kind: "property", required: true }],
  },
};

const clone = () => structuredClone(base);

test("accepts the fully declared direct template", () => {
  assert.equal(adTemplateSchema.safeParse(base).success, true);
});

test("rejects duplicate inputs/fonts/layers and undeclared references", () => {
  const duplicateInputs = clone();
  duplicateInputs.textInputs.push({ key: "hero", label: "Collision", placeholder: "", maxLength: 10 });
  assert.equal(adTemplateSchema.safeParse(duplicateInputs).success, false);

  const duplicateFonts = clone();
  duplicateFonts.fonts.push({ file: "manrope-400.woff2" });
  assert.equal(adTemplateSchema.safeParse(duplicateFonts).success, false);

  const duplicateLayers = clone();
  duplicateLayers.storyLayout.layers[0].layerId = "feed-bg";
  assert.equal(adTemplateSchema.safeParse(duplicateLayers).success, false);

  const missingReference = clone();
  missingReference.feedLayout.layers.push({ type: "image_slot", layerId: "hero-slot", inputKey: "missing", geometry: { x: 0, y: 0, width: 100, height: 100 }, mask: "none", minSourceWidth: 1, minSourceHeight: 1, defaultCrop: { x: 0, y: 0, width: 1, height: 1 }, allowedPlacementOverrides: [] });
  assert.equal(adTemplateSchema.safeParse(missingReference).success, false);
});

test("rejects placement-mismatched samples, duplicate replacements, and unsafe zones", () => {
  const mismatch = clone();
  mismatch.metadata.gallerySamples.feed!.placement = "story";
  assert.equal(adTemplateSchema.safeParse(mismatch).success, false);

  const duplicateReplacement = clone();
  duplicateReplacement.metadata.replacementAssets.push({ inputKey: "hero", assetKey: "hero-asset" });
  assert.equal(adTemplateSchema.safeParse(duplicateReplacement).success, false);

  const unsafe = clone();
  unsafe.feedLayout.safeZones.push({ x: 1000, y: 0, width: 100, height: 100 });
  assert.equal(adTemplateSchema.safeParse(unsafe).success, false);
});

test("allows a template to require executable offer fulfilment without embedding an asset name", () => {
  const required = clone();
  (required.metadata.publishRequirements as Record<string, unknown>).fulfilment = {
    required: true,
    dependency: "Deliver the approved seller guide after form submission",
  };
  assert.equal(adTemplateSchema.safeParse(required).success, true);

  const arbitraryAsset = clone();
  (arbitraryAsset.metadata.publishRequirements as Record<string, unknown>).fulfilment = {
    required: true,
    dependency: "Deliver the approved seller guide",
    asset: "seller-guide.pdf",
  };
  assert.equal(adTemplateSchema.safeParse(arbitraryAsset).success, false);
});
