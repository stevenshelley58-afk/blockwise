import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { renderPlacement } from "../../packages/ad-template-renderer/src/renderer.ts";

const route = readFileSync("src/app/api/adstudio/ads/[id]/preview/route.ts", "utf8");
const saveRoute = readFileSync("src/app/api/adstudio/ads/[id]/save/route.ts", "utf8");
const saveService = readFileSync("src/lib/adstudio/save-ad.ts", "utf8");

describe("canonical preview route contract", () => {
  it("authenticates before service/renderer work and rejects inline data", () => {
    assert.ok(route.indexOf("requireAdStudioRequest") < route.indexOf("createSupabaseServiceClient"));
    assert.ok(route.indexOf("containsInlineImageData") < route.indexOf("createSupabaseServiceClient"));
    assert.match(route, /cache-control.*private, no-store/);
    assert.doesNotMatch(route, /commit_ad_revision|\.upload\(/);
    assert.match(route, /render-assets/);
    assert.doesNotMatch(route, /from ["']\.\.\/save\/route/);
  });

  it("uses the same renderer and asset inputs as save", () => {
    assert.match(saveService, /renderPlacement/);
    assert.match(saveService, /renderPlacement/);
    assert.match(route, /feedCropOverrides/);
    assert.match(saveService, /feedCropOverrides/);
    assert.match(saveService, /storyCropOverrides/);
    assert.match(saveService, /storyCropOverrides/);
  });

  it("canonical renderer is deterministic for identical replacement inputs", async () => {
    const template = {
      schema: "blockwise.ad-template",
      templateId: "preview-parity",
      createdAt: "2026-09-07T00:00:00.000Z",
      feedLayout: { placement: "feed", layers: [{ type: "plate", layerId: "bg", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1350 }, protected: true }], safeZones: [] },
      storyLayout: { placement: "story", layers: [{ type: "plate", layerId: "bg-story", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1920 }, protected: true }], safeZones: [] },
      imageInputs: [], textInputs: [], semanticColours: { background: "#123456", primary: "#123456", secondary: "#123456", accent: "#123456", mainText: "#ffffff", inverseText: "#000000" }, assets: {}, fonts: [], metadata: { title: "Parity", description: "", gallerySamples: {}, metaCopyDefaults: { primaryText: [], headlines: [], descriptions: [], cta: "LEARN_MORE" }, aiWritingGuidance: { summary: "", fields: {} }, publishRequirements: { objective: "LEAD_GENERATION", specialAdCategory: null, instantForm: { required: false, dependency: null }, destination: { required: false, kind: "none", dependency: null }, requiredCtaTypes: [] }, replacementAssets: [], realAssetRefs: [] },
    } as any;
    const input = { template, imageValues: {}, textValues: {}, colourMap: template.semanticColours };
    const one = await renderPlacement(input, "feed");
    const two = await renderPlacement(input, "feed");
    assert.deepEqual(one.png, two.png);
  });
});

