import assert from "node:assert/strict";
import test from "node:test";
import { measuredLineSizeRatio } from "../scripts/build/font-corpus/adstudio-type-specs.mjs";
import { matchRegionsToLines } from "../scripts/build/font-corpus/detect-regions.mjs";
import { extractTargetProfile } from "../scripts/build/font-corpus/extract-target-profile.mjs";
import { sizeRatioForRegionBox } from "../scripts/build/font-corpus/match-font.mjs";
import { registerFont, renderAndMeasure } from "../scripts/build/font-corpus/render-and-measure.mjs";

test("region detection keeps an exact one-line OCR match tight", () => {
  const lines = [
    // A punctuation-only artefact above the real contact line must not make
    // the contact region include the much larger gap between them.
    { text: "—", left: 70, top: 900, width: 18, height: 6, avgConf: 92 },
    { text: "@homeguide.example", left: 88, top: 1060, width: 340, height: 32, avgConf: 96 },
  ];

  const [region] = matchRegionsToLines(
    [{ key: "contact_handle", sample: "@homeguide.example" }],
    lines,
    1024,
    1280,
  );

  assert.equal(region.score, 1);
  assert.equal(region.lineCount, 1);
  assert.deepEqual(region.box, {
    x: 88 / 1024,
    y: 1060 / 1280,
    width: 340 / 1024,
    height: 32 / 1280,
  });
});

test("region detection still joins genuine wrapped copy", () => {
  const lines = [
    { text: "SMART", left: 90, top: 600, width: 310, height: 94, avgConf: 95 },
    { text: "FIRST STEPS", left: 90, top: 710, width: 520, height: 94, avgConf: 96 },
  ];

  const [region] = matchRegionsToLines(
    [{ key: "headline_main", sample: "SMART FIRST STEPS" }],
    lines,
    1024,
    1280,
  );

  assert.equal(region.score, 1);
  assert.equal(region.lineCount, 2);
  assert.deepEqual(region.box, {
    x: 90 / 1024,
    y: 600 / 1280,
    width: 520 / 1024,
    height: 204 / 1280,
  });
});

test("region detection skips unrelated OCR noise between wrapped headline lines", () => {
  const [match] = matchRegionsToLines(
    [{ key: "headline", sample: "SMART FIRST STEPS" }],
    [
      { text: "SMART", left: 90, top: 460, width: 350, height: 130 },
      { text: "io", left: 700, top: 600, width: 30, height: 20 },
      { text: "FIRST STEPS", left: 90, top: 620, width: 440, height: 110 },
    ],
    1024,
    1280,
  );

  assert.equal(match.score, 1);
  assert.equal(match.lineCount, 2);
  assert.deepEqual(match.box, {
    x: 90 / 1024,
    y: 460 / 1280,
    width: 440 / 1024,
    height: 270 / 1280,
  });
});

test("region detection quarantines an OCR-confused numeric glyph", () => {
  const [match] = matchRegionsToLines(
    [{ key: "headline_number", sample: "5" }],
    [
      { text: "4", left: 690, top: 865, width: 36, height: 5 },
      { text: "4", left: 170, top: 210, width: 170, height: 215 },
    ],
    1024,
    1280,
  );

  assert.equal(match.score, 0);
  assert.equal(match.lowConfidence, true);
  assert.equal(match.box, null);
});

test("target profile measures text separately from meta-feed-018 paper texture", async () => {
  const region = {
    key: "headline_sub",
    sample: "Before Buying a Home",
    lineCount: 1,
    box: {
      x: 0.0859375,
      y: 0.7375,
      width: 0.4326171875,
      height: 0.030078125,
    },
  };

  const profile = await extractTargetProfile(
    "meta-feed-018",
    region,
    "public/adstudio-samples/meta/meta-feed-018-sample.png",
    1024,
    1280,
  );

  // The profile retains the text box (38 px), not the padded 60 px analysis
  // crop. Its background estimate is the light paper surface rather than the
  // dark glyphs or the adjacent image, which keeps source/candidate density
  // measurements comparable.
  assert.equal(profile.measurementHeightPx, 38);
  assert.equal(profile.glyphHeightPx, 38);
  assert.equal(profile.backgroundColorHex, "#f0ede6");
  assert.ok(profile.backgroundNoiseP995 < 15);
  assert.ok(profile.inkDensity > 0.2 && profile.inkDensity < 0.3);
});

test("target-profile cache is invalidated when OCR tightens the same region box", async () => {
  const base = {
    key: "headline_sub",
    sample: "Before Buying a Home",
    lineCount: 1,
  };
  await extractTargetProfile("cache-region-regression", {
    ...base,
    box: { x: 0.0859375, y: 0.7375, width: 0.4326171875, height: 0.030078125 },
  }, "public/adstudio-samples/meta/meta-feed-018-sample.png", 1024, 1280);
  const tightened = await extractTargetProfile("cache-region-regression", {
    ...base,
    box: { x: 0.0859375, y: 0.7375, width: 0.4, height: 0.025 },
  }, "public/adstudio-samples/meta/meta-feed-018-sample.png", 1024, 1280);
  assert.deepEqual(tightened.regionBox, { x: 0.0859375, y: 0.7375, width: 0.4, height: 0.025 });
  assert.equal(tightened.measurementWidthPx, 409);
  assert.equal(tightened.measurementHeightPx, 32);
});

test("multi-line size ratio uses the complete editable box", () => {
  assert.equal(sizeRatioForRegionBox(120, 80, 1), 1.5);
  assert.equal(sizeRatioForRegionBox(120, 80, 2), 0.75);
  assert.equal(measuredLineSizeRatio(0.75, 2), 1.5);
});

test("Stage B renders meta-feed-018 main as its declared two lines", () => {
  registerFont("public/fonts/adstudio/barlow-condensed-800.woff2", "meta-feed-018-stage-b");
  const single = renderAndMeasure("SMART FIRST STEPS", "meta-feed-018-stage-b", 800, 156.5);
  const wrapped = renderAndMeasure("SMART FIRST STEPS", "meta-feed-018-stage-b", 800, 156.5, {
    lineCount: 2,
    targetTextWidthPx: 445.5,
    lineHeight: 1.1,
  });
  assert.deepEqual(wrapped.lines, ["SMART", "FIRST STEPS"]);
  assert.equal(wrapped.lines.length, 2);
  assert.ok(wrapped.textWidthPx < single.textWidthPx);
});
