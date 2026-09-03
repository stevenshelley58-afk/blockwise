import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { ICON_NAMES, type AdTemplate, type IconName } from "@blockwise/ad-template-contract";
import { renderPlacement, resolveContainDestinationRect, resolveCoverSourceRect } from "./renderer.ts";

const colours = {
  background: "#ffffff", primary: "#111111", secondary: "#777777",
  accent: "#ff5500", mainText: "#111111", inverseText: "#ffffff",
};

function templateWithIcon(icon: IconName): AdTemplate {
  return {
    schema: "blockwise.ad-template",
    templateId: `renderer-icon-${icon}`,
    createdAt: "2026-08-30T00:00:00.000Z",
    feedLayout: {
      placement: "feed",
      layers: [
        { type: "plate", layerId: `feed-bg-${icon}`, colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1350 }, protected: true },
        { type: "icon", layerId: `feed-icon-${icon}`, icon, colourRole: "mainText", geometry: { x: 440, y: 575, width: 200, height: 200 } },
      ],
      safeZones: [],
    },
    storyLayout: {
      placement: "story",
      layers: [{ type: "plate", layerId: `story-bg-${icon}`, colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1920 }, protected: true }],
      safeZones: [],
    },
    imageInputs: [], textInputs: [], semanticColours: colours, assets: {}, fonts: [],
    metadata: {
      title: `Renderer icon ${icon}`, description: "Deterministic vector icon fixture", gallerySamples: {},
      metaCopyDefaults: { primaryText: [], headlines: [], descriptions: [], cta: "LEARN_MORE" },
      aiWritingGuidance: { summary: "", fields: {} },
      publishRequirements: {
        objective: "OUTCOME_LEADS", specialAdCategory: null,
        instantForm: { required: false, dependency: null },
        destination: { required: false, kind: "none", dependency: null },
        requiredCtaTypes: [],
      },
      replacementAssets: [], realAssetRefs: [],
    },
  };
}

test("every supported icon renders a distinct deterministic vector", async () => {
  const blank = templateWithIcon("arrow");
  blank.feedLayout.layers = blank.feedLayout.layers.filter((layer) => layer.type !== "icon");
  const blankRender = await renderPlacement({ template: blank, imageValues: {}, textValues: {}, colourMap: colours }, "feed");
  const blankHash = createHash("sha256").update(blankRender.png).digest("hex");
  const hashes = new Set<string>();
  for (const icon of ICON_NAMES) {
    const template = templateWithIcon(icon);
    const first = await renderPlacement({ template, imageValues: {}, textValues: {}, colourMap: colours }, "feed");
    const second = await renderPlacement({ template, imageValues: {}, textValues: {}, colourMap: colours }, "feed");
    assert.deepEqual(first.png, second.png, `${icon} must render deterministically`);
    const hash = createHash("sha256").update(first.png).digest("hex");
    assert.notEqual(hash, blankHash, `${icon} must render visible geometry`);
    hashes.add(hash);
  }
  assert.equal(hashes.size, ICON_NAMES.length, "every supported icon must have distinct visible geometry");
});

test("cover source geometry preserves aspect ratio inside a supplied focal crop", () => {
  assert.deepEqual(
    resolveCoverSourceRect(400, 200, { x: 0, y: 0, width: 1, height: 1 }, 200, 200),
    { x: 100, y: 0, width: 200, height: 200 },
  );
  assert.deepEqual(
    resolveCoverSourceRect(200, 400, { x: 0, y: 0.25, width: 1, height: 0.5 }, 400, 200),
    { x: 0, y: 150, width: 200, height: 100 },
  );
});

test("image slots render with true cover instead of stretching a full-width source", async () => {
  const source = createCanvas(400, 200);
  const sourceContext = source.getContext("2d");
  for (const [index, colour] of ["#ff0000", "#00ff00", "#0000ff", "#ffff00"].entries()) {
    sourceContext.fillStyle = colour;
    sourceContext.fillRect(index * 100, 0, 100, 200);
  }
  const template = templateWithIcon("arrow");
  template.templateId = "renderer-cover-crop";
  template.imageInputs = [{ key: "hero", label: "Hero", acceptedTypes: ["image/png"] }];
  template.feedLayout.layers = [{
    type: "image_slot",
    layerId: "feed-hero",
    inputKey: "hero",
    geometry: { x: 0, y: 0, width: 200, height: 200 },
    mask: "none",
    minSourceWidth: 1,
    minSourceHeight: 1,
    defaultCrop: { x: 0, y: 0, width: 1, height: 1 },
    allowedPlacementOverrides: ["crop"],
  }];

  const output = await renderPlacement({
    template,
    imageValues: { hero: source.toBuffer("image/png") },
    textValues: {},
    colourMap: colours,
  }, "feed");
  const rendered = await loadImage(output.png);
  const sample = createCanvas(1080, 1350);
  const sampleContext = sample.getContext("2d");
  sampleContext.drawImage(rendered, 0, 0);
  const left = sampleContext.getImageData(20, 100, 1, 1).data;
  const right = sampleContext.getImageData(180, 100, 1, 1).data;

  assert.deepEqual(Array.from(left.slice(0, 3)), [0, 255, 0], "cover must trim the outer red stripe");
  assert.deepEqual(Array.from(right.slice(0, 3)), [0, 0, 255], "cover must trim the outer yellow stripe");
});

test("text tracking is authored in canvas pixels and cannot make valid labels disappear", async () => {
  const template = templateWithIcon("arrow");
  template.templateId = "renderer-pixel-tracking";
  template.textInputs = [{ key: "kicker", label: "Kicker", placeholder: "NEW TO MARKET", maxLength: 20 }];
  template.fonts = [{ file: "manrope-800.woff2" }];
  template.feedLayout.layers = [
    { type: "plate", layerId: "feed-bg-tracking", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1350 }, protected: true },
    {
      type: "text", layerId: "feed-kicker-tracking", inputKey: "kicker",
      font: { file: "manrope-800.woff2" }, fontSize: 40, lineHeight: 1.1,
      tracking: 2, alignment: "left", maxCharacters: 20, maxLines: 1,
      colourRole: "mainText", overflowBehaviour: "refuse",
      geometry: { x: 80, y: 100, width: 500, height: 70 },
    },
  ];

  const output = await renderPlacement({
    template,
    imageValues: {},
    textValues: { kicker: "NEW TO MARKET" },
    colourMap: colours,
  }, "feed");
  const rendered = await loadImage(output.png);
  const sample = createCanvas(1080, 1350);
  const context = sample.getContext("2d");
  context.drawImage(rendered, 0, 0);
  const pixels = context.getImageData(70, 90, 540, 100).data;
  let darkPixels = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index] < 100 && pixels[index + 1] < 100 && pixels[index + 2] < 100) darkPixels += 1;
  }
  assert.ok(darkPixels > 100, "a normal 2px tracking value must render visible label text");
});

test("scale-down preserves a complete word instead of accepting a vertical grapheme stack", async () => {
  const template = templateWithIcon("arrow");
  template.templateId = "renderer-whole-word-scale-down";
  template.textInputs = [{ key: "headline", label: "Headline", placeholder: "SALE", maxLength: 20 }];
  template.fonts = [{ file: "manrope-800.woff2" }];
  template.feedLayout.layers = [
    { type: "plate", layerId: "feed-bg-word", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1350 }, protected: true },
    {
      type: "text", layerId: "feed-word", inputKey: "headline",
      font: { file: "manrope-800.woff2" }, fontSize: 80, lineHeight: 1,
      tracking: 1, alignment: "left", maxCharacters: 20, maxLines: 1,
      colourRole: "mainText", overflowBehaviour: "scale_down",
      geometry: { x: 40, y: 40, width: 48, height: 36 },
    },
  ];

  const output = await renderPlacement({
    template,
    imageValues: {},
    textValues: { headline: "SALE" },
    colourMap: colours,
  }, "feed");
  const rendered = await loadImage(output.png);
  const sample = createCanvas(1080, 1350);
  const context = sample.getContext("2d");
  context.drawImage(rendered, 0, 0);
  const pixels = context.getImageData(35, 35, 60, 50).data;
  let minX = 60, maxX = -1, minY = 50, maxY = -1;
  for (let y = 0; y < 50; y += 1) for (let x = 0; x < 60; x += 1) {
    const index = (y * 60 + x) * 4;
    if (pixels[index] < 100 && pixels[index + 1] < 100 && pixels[index + 2] < 100) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  assert.ok(maxX - minX > maxY - minY, "SALE must render as one horizontal word, never one grapheme per line");
});

test("logos are contained and centred without aspect distortion", async () => {
  assert.deepEqual(
    resolveContainDestinationRect(400, 100, { x: 100, y: 100, width: 200, height: 200 }),
    { x: 100, y: 175, width: 200, height: 50 },
  );
  const source = createCanvas(400, 100);
  source.getContext("2d").fillStyle = "#00aa55";
  source.getContext("2d").fillRect(0, 0, 400, 100);
  const template = templateWithIcon("arrow");
  template.templateId = "renderer-logo-contain";
  template.imageInputs = [{ key: "logo", label: "Logo", acceptedTypes: ["image/png"] }];
  template.feedLayout.layers = [
    { type: "plate", layerId: "feed-bg-logo", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1350 }, protected: true },
    { type: "logo", layerId: "feed-logo", inputKey: "logo", geometry: { x: 100, y: 100, width: 200, height: 200 } },
  ];
  const output = await renderPlacement({ template, imageValues: { logo: source.toBuffer("image/png") }, textValues: {}, colourMap: colours }, "feed");
  const rendered = await loadImage(output.png);
  const sample = createCanvas(1080, 1350);
  const context = sample.getContext("2d");
  context.drawImage(rendered, 0, 0);
  assert.deepEqual(Array.from(context.getImageData(200, 120, 1, 1).data.slice(0, 3)), [255, 255, 255], "letterbox area remains visible");
  assert.deepEqual(Array.from(context.getImageData(200, 200, 1, 1).data.slice(0, 3)), [0, 170, 85], "logo remains centred in its slot");
});

test("a tall line vector renders as a vertical divider", async () => {
  const template = templateWithIcon("arrow");
  template.templateId = "renderer-vertical-line";
  template.feedLayout.layers = [
    { type: "plate", layerId: "feed-bg-line", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1350 }, protected: true },
    {
      type: "vector",
      layerId: "feed-column-divider",
      shape: "line",
      colourRole: "mainText",
      opacity: 1,
      geometry: { x: 538, y: 200, width: 4, height: 900 },
    },
  ];

  const output = await renderPlacement({
    template,
    imageValues: {},
    textValues: {},
    colourMap: colours,
  }, "feed");
  const rendered = await loadImage(output.png);
  const sample = createCanvas(1080, 1350);
  const context = sample.getContext("2d");
  context.drawImage(rendered, 0, 0);
  const pixels = context.getImageData(536, 190, 8, 920).data;
  let darkPixels = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index] < 100 && pixels[index + 1] < 100 && pixels[index + 2] < 100) darkPixels += 1;
  }

  assert.ok(darkPixels > 1_500, "the tall line must span its vertical geometry instead of collapsing into a short horizontal stroke");
});
