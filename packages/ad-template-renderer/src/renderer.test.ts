import assert from "node:assert/strict";
import test from "node:test";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { AdTemplate } from "@blockwise/ad-template-contract";
import {
  measureTrackedTextWidth,
  renderBoth,
  renderPlacement,
  TEXT_PREFLIGHT_ERROR_CODE,
  TextPreflightError,
} from "./renderer.ts";

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
  const failure = await renderPlacement(
    { template, imageValues: {}, textValues: { headline: "IMPOSSIBLE" }, colourMap: colours },
    "feed",
  ).then(() => null, (error: unknown) => error);
  assert.ok(failure instanceof TextPreflightError);
  assert.equal(failure.message.startsWith(`${TEXT_PREFLIGHT_ERROR_CODE} `), true);
  assert.equal(failure.violations.length, 1);
  assert.equal(failure.violations[0]?.reason, "feed text layer feed-impossible cannot fit at the 24px readability floor");
  assert.match(failure.message, /cannot fit at the 24px readability floor/);
});

test("c6-shaped failures report every feed and story layer in one ordered preflight", async () => {
  const template = templateFixture();
  template.fonts = [{ file: "manrope-800.woff2" }];
  const failures = [
    ["feed", "feed-email-text", "email"],
    ["feed", "feed-web-text", "web"],
    ["story", "story-address", "address"],
    ["story", "story-phone-text", "phone"],
  ] as const;
  template.textInputs = failures.map(([, , key]) => ({ key, label: key, placeholder: "TEXT THAT CANNOT FIT", maxLength: 40 }));
  for (const [placement, layerId, inputKey] of failures) {
    const layout = placement === "feed" ? template.feedLayout : template.storyLayout;
    layout.layers.push({
      type: "text",
      layerId,
      inputKey,
      font: { file: "manrope-800.woff2" },
      fontSize: placement === "feed" ? 30 : 36,
      lineHeight: 1,
      tracking: 1,
      alignment: "left",
      maxCharacters: 40,
      maxLines: 1,
      colourRole: "mainText",
      overflowBehaviour: "scale_down",
      geometry: { x: 40, y: 40 + layout.layers.length * 12, width: 20, height: 20 },
    });
  }
  const failure = await renderBoth({
    template,
    imageValues: {},
    textValues: Object.fromEntries(template.textInputs.map((input) => [input.key, input.placeholder])),
    colourMap: colours,
  }).then(() => null, (error: unknown) => error);
  assert.ok(failure instanceof TextPreflightError);
  assert.deepEqual(
    failure.violations.map(({ placement, layerId }) => [placement, layerId]),
    failures.map(([placement, layerId]) => [placement, layerId]),
  );
  assert.equal(failure.violations.at(-1)?.reason, "story text layer story-phone-text cannot fit at the 32px readability floor");
  const payload = JSON.parse(failure.message.slice(TEXT_PREFLIGHT_ERROR_CODE.length + 1));
  assert.deepEqual(payload.violations, failure.violations);
});

test("multi-line text below a 1.0 line height is aggregated and single-line text is unchanged", async () => {
  const template = templateFixture();
  template.fonts = [{ file: "manrope-800.woff2" }];
  template.textInputs = [
    { key: "feedFeatures", label: "Feed features", placeholder: "ONE\nTWO", maxLength: 20 },
    { key: "storyFeatures", label: "Story features", placeholder: "ONE\nTWO", maxLength: 20 },
    { key: "singleLine", label: "Single line", placeholder: "ONE", maxLength: 20 },
  ];
  const layer = {
    type: "text" as const,
    font: { file: "manrope-800.woff2" },
    fontSize: 40,
    lineHeight: 0.8,
    tracking: 0,
    alignment: "left" as const,
    maxCharacters: 20,
    maxLines: 2,
    colourRole: "mainText" as const,
    overflowBehaviour: "scale_down" as const,
    geometry: { x: 40, y: 40, width: 800, height: 200 },
  };
  template.feedLayout.layers.push({ ...layer, layerId: "feed-features", inputKey: "feedFeatures" });
  template.storyLayout.layers.push({ ...layer, layerId: "story-features", inputKey: "storyFeatures" });
  template.feedLayout.layers.push({ ...layer, layerId: "feed-single", inputKey: "singleLine", maxLines: 1 });

  const failure = await renderBoth({
    template,
    imageValues: {},
    textValues: { feedFeatures: "ONE\nTWO", storyFeatures: "ONE\nTWO", singleLine: "ONE" },
    colourMap: colours,
  }).then(() => null, (error: unknown) => error);
  assert.ok(failure instanceof TextPreflightError);
  assert.deepEqual(failure.violations.map(({ placement, layerId }) => [placement, layerId]), [
    ["feed", "feed-features"],
    ["story", "story-features"],
  ]);
  assert.deepEqual(failure.violations.map(({ kind }) => kind), [
    "multiline_line_height_below_minimum",
    "multiline_line_height_below_minimum",
  ]);
  assert.match(failure.message, /feed text layer feed-features with maxLines 2 must use lineHeight at least 1/);
  assert.match(failure.message, /story text layer story-features with maxLines 2 must use lineHeight at least 1/);

  template.feedLayout.layers[1]!.lineHeight = 1;
  template.storyLayout.layers[1]!.lineHeight = 1.1;
  await assert.doesNotReject(renderBoth({
    template,
    imageValues: {},
    textValues: { feedFeatures: "ONE\nTWO", storyFeatures: "ONE\nTWO", singleLine: "ONE" },
    colourMap: colours,
  }));
});

test("c15 Story essential text collision is rejected with its signed painted overlap while adjacent text passes", async () => {
  const template = templateFixture();
  template.fonts = [{ file: "manrope-400.woff2" }, { file: "manrope-800.woff2" }];
  template.textInputs = [
    {
      key: "aboutCopy",
      label: "About",
      placeholder: "Ready to move into a home\nwith a minimalist design?\nCheck out this property! It\nhas a cozy living room,\nremodeled kitchen, huge\nbackyard, and so on.",
      maxLength: 220,
    },
    { key: "featuresHeading", label: "Features", placeholder: "PROPERTY FEATURES", maxLength: 24 },
  ];
  template.storyLayout.layers.push({
    type: "text",
    layerId: "story-about-copy",
    inputKey: "aboutCopy",
    font: { file: "manrope-400.woff2" },
    fontSize: 32,
    lineHeight: 1.12,
    tracking: 0,
    alignment: "left",
    maxCharacters: 220,
    maxLines: 6,
    colourRole: "mainText",
    overflowBehaviour: "scale_down",
    geometry: { x: 72, y: 1108, width: 936, height: 216 },
  }, {
    type: "text",
    layerId: "story-features-heading",
    inputKey: "featuresHeading",
    font: { file: "manrope-800.woff2" },
    fontSize: 38,
    lineHeight: 1,
    tracking: 0,
    alignment: "left",
    maxCharacters: 24,
    maxLines: 1,
    colourRole: "mainText",
    overflowBehaviour: "scale_down",
    geometry: { x: 120, y: 1218, width: 888, height: 46 },
  });

  const renderInput = {
    template,
    imageValues: {},
    textValues: { aboutCopy: template.textInputs[0]!.placeholder, featuresHeading: "PROPERTY FEATURES" },
    colourMap: colours,
  };
  const failure = await renderPlacement(renderInput, "story").then(() => null, (error: unknown) => error);
  assert.ok(failure instanceof TextPreflightError);
  const overlap = failure.violations.find(({ kind }) => kind === "essential_text_overlap");
  assert.deepEqual(overlap, {
    placement: "story",
    layerId: "story-about-copy",
    otherLayerId: "story-features-heading",
    kind: "essential_text_overlap",
    overlapPx: 100,
    reason: "story essential text layers story-about-copy and story-features-heading overlap by 100px vertically",
  });

  template.storyLayout.layers[1]!.geometry = { x: 72, y: 1094, width: 936, height: 192 };
  if (template.storyLayout.layers[1]!.type === "text") template.storyLayout.layers[1]!.lineHeight = 1;
  template.storyLayout.layers[2]!.geometry = { x: 120, y: 1292, width: 888, height: 38 };
  await assert.doesNotReject(renderPlacement(renderInput, "story"));
});

test("c15 Story address is rejected when its exact painted bounds exceed right geometry by 4px", async () => {
  const template = templateFixture();
  template.fonts = [{ file: "manrope-400.woff2" }];
  template.textInputs = [{
    key: "propertyAddress",
    label: "Address",
    placeholder: "123 Anywhere St.,\nAny City, ST 12345",
    maxLength: 60,
  }];
  template.storyLayout.layers.push({
    type: "text",
    layerId: "story-address",
    inputKey: "propertyAddress",
    font: { file: "manrope-400.woff2" },
    fontSize: 32,
    lineHeight: 1.15,
    tracking: -0.5,
    alignment: "right",
    maxCharacters: 60,
    maxLines: 2,
    colourRole: "mainText",
    overflowBehaviour: "scale_down",
    geometry: { x: 624, y: 706, width: 344, height: 86 },
  });

  const failure = await renderPlacement({
    template,
    imageValues: {},
    textValues: { propertyAddress: "123 Anywhere St.,\nAny City, ST 12345" },
    colourMap: colours,
  }, "story").then(() => null, (error: unknown) => error);
  assert.ok(failure instanceof TextPreflightError);
  assert.deepEqual(failure.violations, [{
    placement: "story",
    layerId: "story-address",
    kind: "painted_bounds_outside_geometry",
    edge: "right",
    overflowPx: 4,
    reason: "story text layer story-address painted bounds exceed geometry by 4px on right",
  }]);
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

  const dot = templateFixture();
  dot.feedLayout.layers.push({
    type: "vector",
    layerId: "feed-dot-divider",
    shape: "line",
    colourRole: "mainText",
    opacity: 1,
    geometry: { x: 80, y: 80, width: 3, height: 3 },
  });
  await assert.rejects(
    renderPlacement({ template: dot, imageValues: {}, textValues: {}, colourMap: colours }, "feed"),
    /feed-dot-divider line vector must be at least 8px long/,
  );
});

test("vertical line vectors follow their major axis and unsupported icons never become rings", async () => {
  const template = templateFixture();
  template.feedLayout.layers.push({
    type: "vector",
    layerId: "feed-column-divider",
    shape: "line",
    colourRole: "mainText",
    opacity: 1,
    geometry: { x: 100, y: 100, width: 3, height: 252 },
  });
  const output = await renderPlacement({ template, imageValues: {}, textValues: {}, colourMap: colours }, "feed");
  const image = await loadImage(output.png);
  const canvas = createCanvas(output.width, output.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  assert.deepEqual(Array.from(ctx.getImageData(101, 110, 1, 1).data), [17, 17, 17, 255]);
  assert.deepEqual(Array.from(ctx.getImageData(101, 340, 1, 1).data), [17, 17, 17, 255]);
  assert.deepEqual(Array.from(ctx.getImageData(130, 226, 1, 1).data), [255, 255, 255, 255]);

  const unsupported = templateFixture();
  unsupported.feedLayout.layers.push({
    type: "icon",
    layerId: "feed-unknown-icon",
    icon: "unknown" as "phone",
    colourRole: "mainText",
    geometry: { x: 80, y: 80, width: 40, height: 40 },
  });
  await assert.rejects(
    renderPlacement({ template: unsupported, imageValues: {}, textValues: {}, colourMap: colours }, "feed"),
    /unsupported icon feed-unknown-icon/,
  );
});

test("tracking is one absolute canvas pixel per grapheme gap and c5 REAL ESTATE fits", async () => {
  const measuringContext = createCanvas(320, 80).getContext("2d");
  measuringContext.font = '24px "manrope-800"';
  const untrackedWidth = measureTrackedTextWidth(measuringContext, "AB", 0);
  const trackedWidth = measureTrackedTextWidth(measuringContext, "AB", 1);
  assert.equal(trackedWidth - untrackedWidth, 1, "tracking=1 must add 1px, not one font-size, to one grapheme gap");

  const template = templateFixture();
  template.textInputs = [{ key: "brandName", label: "Brand name", placeholder: "REAL ESTATE", maxLength: 11 }];
  template.fonts = [{ file: "manrope-800.woff2" }];
  template.feedLayout.layers.push({
    type: "text",
    layerId: "feed-brand-name",
    inputKey: "brandName",
    font: { file: "manrope-800.woff2" },
    fontSize: 30,
    lineHeight: 1,
    tracking: 1,
    alignment: "left",
    maxCharacters: 11,
    maxLines: 1,
    colourRole: "mainText",
    overflowBehaviour: "scale_down",
    geometry: { x: 40, y: 40, width: 254, height: 38 },
  });

  const rendered = await renderPlacement({
    template,
    imageValues: {},
    textValues: { brandName: "REAL ESTATE" },
    colourMap: colours,
  }, "feed");
  assert.equal(rendered.width, 1080);
  assert.equal(rendered.height, 1350);
  assert.ok(rendered.png.length > 0, "successful render proves the text remains at or above the 24px floor");
});
