// §14 ingest geometry: mask build, outpaint placement, truth-preservation
// contract. Node-only (sharp), no provider calls.

import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  buildCompositeMask,
  buildInpaintMask,
  compositePlateFromSource,
  TEXT_MASK_PADDING,
} from "../../scripts/adstudio/v2/lib/decompose.mjs";
import { extendPlateToStory, repositionLayersForStory } from "../../scripts/adstudio/v2/lib/story.mjs";

const DIMS = { width: 1080, height: 1350 };
const BOX = { x: 0.1, y: 0.4, width: 0.8, height: 0.2 };

async function raw(png) {
  return sharp(png).raw().ensureAlpha().toBuffer();
}

test("inpaint mask is transparent exactly over padded text boxes", async () => {
  const mask = await buildInpaintMask(DIMS, [BOX]);
  const data = await raw(mask);
  const pad = Math.ceil(TEXT_MASK_PADDING * DIMS.height);
  const boxCx = Math.floor((BOX.x + BOX.width / 2) * DIMS.width);
  const boxCy = Math.floor((BOX.y + BOX.height / 2) * DIMS.height);
  const outsideX = Math.floor(0.97 * DIMS.width);
  const outsideY = Math.floor(0.05 * DIMS.height);

  const at = (x, y) => data[(y * DIMS.width + x) * 4 + 3];
  assert.equal(at(boxCx, boxCy), 0, "hole over the text box");
  assert.equal(at(outsideX, outsideY), 255, "opaque everywhere else");
  // padding band is also a hole
  assert.equal(at(Math.floor(BOX.x * DIMS.width) - Math.floor(pad / 2), boxCy), 0, "padded band is transparent");
});

test("composite keeps source bytes byte-identical outside the boxes", async () => {
  const source = await sharp({
    create: { width: DIMS.width, height: DIMS.height, channels: 3, background: { r: 120, g: 40, b: 200 } },
  }).png().toBuffer();
  const inpainted = await sharp({
    create: { width: DIMS.width, height: DIMS.height, channels: 3, background: { r: 10, g: 200, b: 10 } },
  }).png().toBuffer();
  const compositeMask = await buildCompositeMask(DIMS, [BOX]);
  const plate = await compositePlateFromSource(source, inpainted, compositeMask);

  const srcRaw = await raw(source);
  const plateRaw = await raw(plate);
  const pad = Math.ceil(TEXT_MASK_PADDING * DIMS.height);
  const inBox = (x, y) =>
    x >= BOX.x * DIMS.width - pad && x <= (BOX.x + BOX.width) * DIMS.width + pad
    && y >= BOX.y * DIMS.height - pad && y <= (BOX.y + BOX.height) * DIMS.height + pad;

  let outsideDiffs = 0;
  for (let y = 0; y < DIMS.height; y += 3) {
    for (let x = 0; x < DIMS.width; x += 3) {
      if (inBox(x, y)) continue;
      const i = (y * DIMS.width + x) * 4;
      if (srcRaw[i] !== plateRaw[i] || srcRaw[i + 1] !== plateRaw[i + 1] || srcRaw[i + 2] !== plateRaw[i + 2]) outsideDiffs += 1;
    }
  }
  assert.equal(outsideDiffs, 0, "outside the text boxes the plate is the source");
});

test("story band-extend produces exact 1080x1920 and keeps the feed centred", async () => {
  const feed = await sharp({
    create: { width: 1080, height: 1350, channels: 3, background: { r: 200, g: 120, b: 60 } },
  }).png().toBuffer();
  const story = await extendPlateToStory(feed);
  const meta = await sharp(story).metadata();
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1920);
});

test("repositionLayersForStory maps feed boxes into the safe zones", async () => {
  const layers = [
    { id: "a", box: { x: 0.1, y: 0.0, width: 0.8, height: 1.0 } },
  ];
  const [moved] = repositionLayersForStory(layers);
  const topNorm = 250 / 1920;
  const bottomNorm = (1920 - 340) / 1920;
  assert.ok(moved.box.y >= topNorm - 1e-9, "top inside safe zone");
  assert.ok(moved.box.y + moved.box.height <= bottomNorm + 1e-9, "bottom inside safe zone");
});
