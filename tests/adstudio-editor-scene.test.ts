import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEditorSeedLayout,
  extractSceneRegions,
  extractSceneText,
} from "../src/components/adstudio/canvas/editor-scene.ts";
import type { AdStudioCloneQa } from "../src/lib/adstudio/types.ts";
import { buildCloneTestPack } from "./adstudio-clone-fixture.ts";

function packWithQa() {
  const pack = buildCloneTestPack();
  const qa: AdStudioCloneQa = {
    passed: true,
    attempts: 1,
    checkedAt: "2026-07-01T00:00:00.000Z",
    copyChecks: [
      { key: "headline_main", expected: "Thinking of selling?", rendered: "Thinking of selling?", exact: true },
      { key: "contact_handle", expected: "@northstar", rendered: "@northstar", exact: true },
    ],
    defects: [],
    regions: [
      { key: "headline_main", kind: "text", box: { x: 0.1, y: 0.08, width: 0.8, height: 0.12 } },
      { key: "contact_handle", kind: "text", box: { x: 0.3, y: 0.9, width: 0.4, height: 0.05 } },
      { key: "property_photo", kind: "image", box: { x: 0, y: 0.25, width: 1, height: 0.55 } },
    ],
  };
  const creative = pack.creatives.find((candidate) => candidate.format === "4:5")!;
  creative.canvas.cloneQa = qa;
  creative.canvas.cloneEdit = { version: 1, cleanPlate: "/api/adstudio/media?path=plate.png" };
  return { pack, creative };
}

test("seed layout places one text layer per verified text region", () => {
  const { pack, creative } = packWithQa();
  const seed = buildEditorSeedLayout({ creative, brandKit: pack.brandKit });
  assert.ok(seed);
  assert.equal(seed.width, creative.canvas.width);
  assert.equal(seed.cleanPlate, "/api/adstudio/media?path=plate.png");
  assert.equal(seed.texts.length, 2);

  const headline = seed.texts.find((layer) => layer.fieldKey === "headline_main");
  assert.ok(headline);
  assert.equal(headline.text, "Thinking of selling?");
  assert.equal(headline.x, Math.round(0.1 * creative.canvas.width));
  assert.ok(headline.fontSize >= 14 && headline.fontSize <= 160);
});

test("seed layout is null without a plate or without text", () => {
  const { pack, creative } = packWithQa();
  const noPlate = { ...creative, canvas: { ...creative.canvas, cloneEdit: undefined } };
  assert.equal(buildEditorSeedLayout({ creative: noPlate, brandKit: pack.brandKit }), null);

  const noText = {
    ...creative,
    canvas: {
      ...creative.canvas,
      cloneQa: { ...creative.canvas.cloneQa!, regions: [], copyChecks: [] },
    },
  };
  assert.equal(buildEditorSeedLayout({ creative: noText, brandKit: pack.brandKit }), null);
});

test("scene extraction reads text and normalized regions from tagged layers only", () => {
  const scene = {
    width: 1080,
    height: 1350,
    pages: [{
      children: [
        { type: "image", x: 0, y: 0, width: 1080, height: 1350 },
        {
          type: "text",
          x: 108,
          y: 135,
          width: 864,
          height: 162,
          text: " New price this week ",
          custom: { fieldKey: "headline_main" },
        },
        { type: "text", x: 10, y: 10, width: 100, height: 40, text: "decorative, untagged" },
      ],
    }],
  };

  assert.deepEqual(extractSceneText(scene), { headline_main: "New price this week" });
  const regions = extractSceneRegions(scene, { width: 1080, height: 1350 });
  assert.equal(regions.length, 1);
  assert.equal(regions[0]?.key, "headline_main");
  assert.ok(Math.abs(regions[0]!.box.x - 0.1) < 0.001);
  assert.ok(Math.abs(regions[0]!.box.width - 0.8) < 0.001);
});

test("scene extraction tolerates malformed scenes", () => {
  assert.deepEqual(extractSceneText(null), {});
  assert.deepEqual(extractSceneText({ pages: "nope" }), {});
  assert.deepEqual(extractSceneRegions({}, { width: 0, height: 0 }), []);
});
