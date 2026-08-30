import assert from "node:assert/strict";
import test from "node:test";
import { adTemplateSchema } from "./schema.ts";
import { ICON_NAMES } from "./types.ts";

function templateWithLayer(layer: Record<string, unknown>) {
  return {
    schema: "blockwise.ad-template",
    templateId: "render-primitives",
    createdAt: "2026-08-30T00:00:00.000Z",
    feedLayout: { placement: "feed", layers: [
      { type: "plate", layerId: "feed-bg", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1350 }, protected: true },
      layer,
    ], safeZones: [] },
    storyLayout: { placement: "story", layers: [
      { type: "plate", layerId: "story-bg", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1920 }, protected: true },
    ], safeZones: [] },
    imageInputs: [],
    textInputs: [{ key: "headline", label: "Headline", placeholder: "Hello", maxLength: 80 }],
    semanticColours: { background: "#fff", primary: "#111", secondary: "#222", accent: "#333", mainText: "#111", inverseText: "#fff" },
    assets: {},
    fonts: [{ file: "manrope-400.woff2" }],
    metadata: {
      title: "Render primitives", description: "Contract boundary fixture", gallerySamples: {},
      metaCopyDefaults: { primaryText: [], headlines: [], descriptions: [], cta: "LEARN_MORE" },
      aiWritingGuidance: { summary: "", fields: {} },
      publishRequirements: { objective: "OUTCOME_LEADS", specialAdCategory: null, instantForm: { required: false, dependency: null }, destination: { required: false, kind: "none", dependency: null }, requiredCtaTypes: [] },
      replacementAssets: [], realAssetRefs: [],
    },
  };
}

function textLayer(lineHeight: number) {
  return {
    type: "text", layerId: "feed-headline", inputKey: "headline",
    font: { file: "manrope-400.woff2" }, fontSize: 64, lineHeight, tracking: 0,
    alignment: "left", maxCharacters: 80, maxLines: 2, colourRole: "mainText",
    overflowBehaviour: "scale_down", geometry: { x: 80, y: 80, width: 800, height: 180 },
  };
}

test("lineHeight is a bounded unitless renderer multiplier", () => {
  for (const value of [0.8, 1.1, 1.6, 2.5]) {
    assert.equal(adTemplateSchema.safeParse(templateWithLayer(textLayer(value))).success, true);
  }
  for (const value of [0.79, 2.51, 26, 29]) {
    assert.equal(adTemplateSchema.safeParse(templateWithLayer(textLayer(value))).success, false);
  }
});

test("only renderer-backed canonical icon names are accepted", () => {
  for (const icon of ICON_NAMES) {
    assert.equal(adTemplateSchema.safeParse(templateWithLayer({
      type: "icon", layerId: `feed-icon-${icon}`, icon, colourRole: "mainText",
      geometry: { x: 80, y: 80, width: 64, height: 64 },
    })).success, true);
  }
  assert.equal(adTemplateSchema.safeParse(templateWithLayer({
    type: "icon", layerId: "feed-icon-unsupported", icon: "telephone", colourRole: "mainText",
    geometry: { x: 80, y: 80, width: 64, height: 64 },
  })).success, false);
});
