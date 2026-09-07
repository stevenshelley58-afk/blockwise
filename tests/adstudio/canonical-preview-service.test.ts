import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleCanonicalPreview } from "../../src/lib/adstudio/canonical-preview.ts";

const document = {
  schema: "blockwise.ad-document",
  templateId: "preview-template",
  sharedImageValues: {},
  sharedTextValues: {},
  feedCropOverrides: {},
  storyCropOverrides: {},
  colourMode: "template",
  resolvedColourMap: { background: "#123456", primary: "#123456", secondary: "#123456", accent: "#123456", mainText: "#ffffff", inverseText: "#000000" },
  metaPrimaryText: "", metaHeadline: "", metaDescription: "", metaCta: "LEARN_MORE", revision: 1,
};
const template = {
  schema: "blockwise.ad-template", templateId: "preview-template", createdAt: "2026-09-07T00:00:00.000Z",
  feedLayout: { placement: "feed", layers: [{ type: "plate", layerId: "feed-bg", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1350 }, protected: true }], safeZones: [] },
  storyLayout: { placement: "story", layers: [{ type: "plate", layerId: "story-bg", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1920 }, protected: true }], safeZones: [] },
  imageInputs: [], textInputs: [], semanticColours: document.resolvedColourMap, assets: {}, fonts: [],
  metadata: { title: "Preview", description: "", gallerySamples: {}, metaCopyDefaults: { primaryText: [], headlines: [], descriptions: [], cta: "LEARN_MORE" }, aiWritingGuidance: { summary: "", fields: {} }, publishRequirements: { objective: "LEAD_GENERATION", specialAdCategory: null, instantForm: { required: false, dependency: null }, destination: { required: false, kind: "none", dependency: null }, requiredCtaTypes: [] }, replacementAssets: [], realAssetRefs: [] },
} as any;

describe("canonical preview service", () => {
  it("renders actual canonical PNG bytes without writes", async () => {
    const output = await handleCanonicalPreview({ adId: "ad-1", workspaceId: "ws-1", placement: "feed", document, deps: {
      loadAd: async () => ({ templateId: template.templateId }),
      loadTemplate: async () => template,
      resolveImages: async () => ({}),
    }});
    assert.equal(output.render.png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  });

  it("rejects inline images before any dependency I/O", async () => {
    let calls = 0;
    await assert.rejects(() => handleCanonicalPreview({ adId: "ad-1", workspaceId: "ws-1", placement: "feed", document: { ...document, sharedImageValues: { hero: "data:image/png;base64,AAAA" } }, deps: {
      loadAd: async () => { calls++; return { templateId: template.templateId }; },
      loadTemplate: async () => { calls++; return template; },
      resolveImages: async () => { calls++; return {}; },
    }}), /image_upload_required/);
    assert.equal(calls, 0);
  });

  it("rejects workspace/ad template mismatch before template or asset reads", async () => {
    let reads = 0;
    await assert.rejects(() => handleCanonicalPreview({ adId: "ad-1", workspaceId: "wrong", placement: "story", document, deps: {
      loadAd: async () => null,
      loadTemplate: async () => { reads++; return template; },
      resolveImages: async () => { reads++; return {}; },
    }}), /ad_not_found/);
    assert.equal(reads, 0);
  });
});

