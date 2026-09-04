import assert from "node:assert/strict";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import type { AdTemplate } from "@blockwise/ad-template-contract";
import { renderPlacement } from "./renderer.ts";

const colours = {
  background: "#ffffff",
  primary: "#111111",
  secondary: "#777777",
  accent: "#ff5500",
  mainText: "#111111",
  inverseText: "#ffffff",
};

function templateFixture(): AdTemplate {
  return {
    schema: "blockwise.ad-template",
    templateId: "renderer-guards",
    createdAt: "2026-09-04T00:00:00.000Z",
    feedLayout: {
      placement: "feed",
      layers: [{ type: "plate", layerId: "feed-bg", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1350 }, protected: true }],
      safeZones: [],
    },
    storyLayout: {
      placement: "story",
      layers: [{ type: "plate", layerId: "story-bg", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1920 }, protected: true }],
      safeZones: [],
    },
    imageInputs: [],
    textInputs: [],
    semanticColours: colours,
    assets: {},
    fonts: [],
    metadata: {
      title: "Renderer guards",
      description: "Fail-closed renderer fixture",
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

test("scale-down fails instead of emitting unreadable text", async () => {
  const template = templateFixture();
  template.textInputs = [{ key: "headline", label: "Headline", placeholder: "IMPOSSIBLE", maxLength: 20 }];
  template.fonts = [{ file: "manrope-800.woff2" }];
  template.feedLayout.layers.push({
    type: "text",
    layerId: "feed-impossible",
    inputKey: "headline",
    font: { file: "manrope-800.woff2" },
    fontSize: 80,
    lineHeight: 1,
    tracking: 0.01,
    alignment: "left",
    maxCharacters: 20,
    maxLines: 1,
    colourRole: "mainText",
    overflowBehaviour: "scale_down",
    geometry: { x: 40, y: 40, width: 8, height: 8 },
  });
  await assert.rejects(
    renderPlacement({ template, imageValues: {}, textValues: { headline: "IMPOSSIBLE" }, colourMap: colours }, "feed"),
    /cannot fit at the 24px readability floor/,
  );
});

test("rendering fails when any output pixel remains transparent", async () => {
  const template = templateFixture();
  const transparent = createCanvas(1080, 1350).toBuffer("image/png");
  template.assets = { background: { fileName: "transparent.png", mimeType: "image/png" } };
  template.feedLayout.layers[0] = {
    type: "plate",
    layerId: "feed-transparent-background",
    colourRole: "background",
    assetKey: "background",
    geometry: { x: 0, y: 0, width: 1080, height: 1350 },
    protected: true,
  };
  await assert.rejects(
    renderPlacement({ template, imageValues: { background: transparent }, textValues: {}, colourMap: colours }, "feed"),
    /feed render is not fully opaque/,
  );
});

test("renderer rejects missing, partial, and non-square structural primitives", async () => {
  const missing = templateFixture();
  missing.feedLayout.layers.shift();
  await assert.rejects(
    renderPlacement({ template: missing, imageValues: {}, textValues: {}, colourMap: colours }, "feed"),
    /first layer must be a protected full-canvas background plate/,
  );

  const partial = templateFixture();
  partial.feedLayout.layers[0]!.geometry = { x: 1, y: 0, width: 1079, height: 1350 };
  await assert.rejects(
    renderPlacement({ template: partial, imageValues: {}, textValues: {}, colourMap: colours }, "feed"),
    /first layer must be a protected full-canvas background plate/,
  );

  const ring = templateFixture();
  ring.feedLayout.layers.push({
    type: "vector",
    layerId: "feed-stretched-ring",
    shape: "ring",
    colourRole: "mainText",
    opacity: 1,
    geometry: { x: 80, y: 80, width: 240, height: 400 },
  });
  await assert.rejects(
    renderPlacement({ template: ring, imageValues: {}, textValues: {}, colourMap: colours }, "feed"),
    /ring vector feed-stretched-ring must use square geometry/,
  );
});

test("diagnostics report actual painted text bounds, font size, and line count", async () => {
  const template = templateFixture();
  template.textInputs = [{ key: "headline", label: "Headline", placeholder: "HELLO HOME", maxLength: 40 }];
  template.fonts = [{ file: "manrope-800.woff2" }];
  template.feedLayout.layers.push({
    type: "text",
    layerId: "feed-headline",
    inputKey: "headline",
    font: { file: "manrope-800.woff2" },
    fontSize: 48,
    lineHeight: 1.1,
    tracking: 0,
    alignment: "left",
    maxCharacters: 40,
    maxLines: 1,
    colourRole: "mainText",
    overflowBehaviour: "scale_down",
    geometry: { x: 80, y: 120, width: 600, height: 100 },
  });
  const rendered = await renderPlacement({
    template,
    imageValues: {},
    textValues: { headline: "HELLO HOME" },
    colourMap: colours,
    collectDiagnostics: true,
  }, "feed");
  const withoutDiagnostics = await renderPlacement({
    template,
    imageValues: {},
    textValues: { headline: "HELLO HOME" },
    colourMap: colours,
  }, "feed");
  assert.deepEqual(rendered.png, withoutDiagnostics.png);
  const diagnostic = rendered.diagnostics?.textLayers[0];
  assert.equal(diagnostic?.status, "painted");
  assert.equal(diagnostic?.fontFamily, "manrope-800");
  assert.equal(diagnostic?.fontSizePx, 48);
  assert.equal(diagnostic?.lineCount, 1);
  assert.equal(diagnostic?.maxLines, 1);
  assert.equal(diagnostic?.withinGeometry, true);
  assert.ok(diagnostic?.paintedBounds);
  assert.ok(diagnostic!.paintedBounds!.width > 0);
  assert.ok(diagnostic!.paintedBounds!.height > 0);
});
