import assert from "node:assert/strict";
import test from "node:test";
import { adTemplateSchema } from "./schema.ts";

function templateWithLayer(layer: Record<string, unknown>): any {
  return {
    schema: "blockwise.ad-template",
    templateId: "render-primitives",
    createdAt: "2026-08-30T00:00:00.000Z",
    feedLayout: {
      placement: "feed",
      layers: [
        { type: "plate", layerId: "feed-bg", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1350 }, protected: true },
        layer,
      ],
      safeZones: [],
    },
    storyLayout: {
      placement: "story",
      layers: [
        { type: "plate", layerId: "story-bg", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1920 }, protected: true },
      ],
      safeZones: [],
    },
    imageInputs: [],
    textInputs: [{ key: "headline", label: "Headline", placeholder: "Hello", maxLength: 80 }],
    semanticColours: { background: "#fff", primary: "#111", secondary: "#222", accent: "#333", mainText: "#111", inverseText: "#fff" },
    assets: {},
    fonts: [{ file: "manrope-400.woff2" }],
    metadata: {
      title: "Render primitives",
      description: "Contract boundary fixture",
      gallerySamples: {},
      metaCopyDefaults: { primaryText: [], headlines: [], descriptions: [], cta: "LEARN_MORE" },
      aiWritingGuidance: { summary: "", fields: {} },
      publishRequirements: {
        objective: "OUTCOME_LEADS",
        specialAdCategory: null,
        instantForm: { required: false, dependency: null },
        destination: { required: false, kind: "none", dependency: null },
        requiredCtaTypes: [],
      },
      replacementAssets: [],
      realAssetRefs: [],
    },
  };
}

function textLayer(): Record<string, unknown> {
  return {
    type: "text",
    layerId: "feed-headline",
    inputKey: "headline",
    font: { file: "manrope-400.woff2" },
    fontSize: 64,
    lineHeight: 1.1,
    tracking: 0,
    alignment: "left",
    maxCharacters: 80,
    maxLines: 2,
    colourRole: "mainText",
    overflowBehaviour: "scale_down",
    geometry: { x: 80, y: 80, width: 800, height: 180 },
  };
}

test("ring vectors require square resolved geometry", () => {
  assert.equal(adTemplateSchema.safeParse(templateWithLayer({
    type: "vector", layerId: "feed-ring", shape: "ring", colourRole: "mainText", opacity: 1,
    geometry: { x: 80, y: 80, width: 240, height: 240 },
  })).success, true);
  assert.equal(adTemplateSchema.safeParse(templateWithLayer({
    type: "vector", layerId: "feed-ring", shape: "ring", colourRole: "mainText", opacity: 1,
    geometry: { x: 80, y: 80, width: 240, height: 400 },
  })).success, false);

  const normalizedStory = templateWithLayer({
    type: "vector", layerId: "feed-ring", shape: "ring", colourRole: "mainText", opacity: 1,
    geometry: { x: 80, y: 80, width: 240, height: 240 },
  });
  normalizedStory.storyLayout.layers.push({
    type: "vector", layerId: "story-ring", shape: "ring", colourRole: "mainText", opacity: 1,
    geometry: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
  });
  assert.equal(adTemplateSchema.safeParse(normalizedStory).success, false);
  normalizedStory.storyLayout.layers[1].geometry.height = 0.1125;
  assert.equal(adTemplateSchema.safeParse(normalizedStory).success, true);
});

test("each placement starts with a protected full-canvas background plate", () => {
  const missing = templateWithLayer(textLayer());
  missing.storyLayout.layers = [];
  assert.equal(adTemplateSchema.safeParse(missing).success, false);

  const partial = templateWithLayer(textLayer());
  partial.feedLayout.layers[0].geometry = { x: 1, y: 0, width: 1079, height: 1350 };
  assert.equal(adTemplateSchema.safeParse(partial).success, false);

  const normalized = templateWithLayer(textLayer());
  normalized.feedLayout.layers[0].geometry = { x: 0, y: 0, width: 1, height: 1 };
  normalized.storyLayout.layers[0].geometry = { x: 0, y: 0, width: 1, height: 1 };
  assert.equal(adTemplateSchema.safeParse(normalized).success, true);
});

test("placeholder hard lines must fit every referencing text layer", () => {
  const invalid = templateWithLayer(textLayer());
  invalid.textInputs[0].placeholder = "First line\nSecond line\nThird line";
  assert.equal(adTemplateSchema.safeParse(invalid).success, false);

  const valid = templateWithLayer({ ...textLayer(), maxLines: 3, geometry: { x: 80, y: 80, width: 800, height: 240 } });
  valid.textInputs[0].placeholder = "First line\nSecond line\nThird line";
  assert.equal(adTemplateSchema.safeParse(valid).success, true);
});

test("authored text meets placement readability floors", () => {
  assert.equal(adTemplateSchema.safeParse(templateWithLayer({ ...textLayer(), fontSize: 24 })).success, true);
  assert.equal(adTemplateSchema.safeParse(templateWithLayer({ ...textLayer(), fontSize: 23 })).success, false);

  const story = templateWithLayer(textLayer());
  story.feedLayout.layers = story.feedLayout.layers.slice(0, 1);
  story.storyLayout.layers.push({
    ...textLayer(), layerId: "story-headline", fontSize: 31,
    geometry: { x: 80, y: 240, width: 800, height: 180 },
  });
  assert.equal(adTemplateSchema.safeParse(story).success, false);
  story.storyLayout.layers[1].fontSize = 32;
  assert.equal(adTemplateSchema.safeParse(story).success, true);
});

test("text tracking is absolute canvas pixels bounded to the authored -4..4 range", () => {
  assert.equal(adTemplateSchema.safeParse(templateWithLayer({ ...textLayer(), tracking: -4 })).success, true);
  assert.equal(adTemplateSchema.safeParse(templateWithLayer({ ...textLayer(), tracking: 4 })).success, true);
  assert.equal(adTemplateSchema.safeParse(templateWithLayer({ ...textLayer(), tracking: -4.01 })).success, false);
  assert.equal(adTemplateSchema.safeParse(templateWithLayer({ ...textLayer(), tracking: 4.01 })).success, false);
});

test("multi-line text requires a full font-size of line separation", () => {
  const tooTight = adTemplateSchema.safeParse(templateWithLayer({ ...textLayer(), lineHeight: 0.8 }));
  assert.equal(tooTight.success, false);
  if (!tooTight.success) {
    assert.match(tooTight.error.issues[0]?.message ?? "", /feed text layer feed-headline with maxLines 2 must use lineHeight at least 1/);
  }

  assert.equal(adTemplateSchema.safeParse(templateWithLayer({ ...textLayer(), lineHeight: 1 })).success, true);
  assert.equal(adTemplateSchema.safeParse(templateWithLayer({ ...textLayer(), lineHeight: 1.2 })).success, true);
  assert.equal(adTemplateSchema.safeParse(templateWithLayer({ ...textLayer(), maxLines: 1, lineHeight: 0.8 })).success, true);
});
