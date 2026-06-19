import assert from "node:assert/strict";
import test from "node:test";

import {
  computeOutpaintLayout,
  formatImageSize,
  outpaintTargetForAspect,
} from "../src/lib/adstudio/outpaint-layout.ts";

test("outpaintTargetForAspect maps Ad Studio ratios to gpt-image-2-valid sizes", () => {
  assert.deepEqual(outpaintTargetForAspect("9:16"), { width: 1024, height: 1792 });
  assert.deepEqual(outpaintTargetForAspect("1.91:1"), { width: 1792, height: 1024 });
  assert.deepEqual(outpaintTargetForAspect("4:5"), { width: 1024, height: 1280 });
  assert.deepEqual(outpaintTargetForAspect("1:1"), { width: 1024, height: 1024 });
  // unknown ratios fall back to square
  assert.deepEqual(outpaintTargetForAspect("3:2"), { width: 1024, height: 1024 });
});

test("formatImageSize matches the OpenAI size string", () => {
  assert.equal(formatImageSize({ width: 1024, height: 1792 }), "1024x1792");
  // every preset edge is a multiple of 16 (a gpt-image-2 constraint)
  for (const ratio of ["9:16", "1.91:1", "4:5", "1:1"]) {
    const target = outpaintTargetForAspect(ratio);
    assert.equal(target.width % 16, 0);
    assert.equal(target.height % 16, 0);
  }
});

test("computeOutpaintLayout skips extend when the source already fits the frame", () => {
  const layout = computeOutpaintLayout({
    sourceWidth: 800,
    sourceHeight: 800,
    target: outpaintTargetForAspect("1:1"),
  });

  assert.equal(layout.requiresOutpaint, false);
  assert.deepEqual(layout.maskRects, []);
  assert.equal(layout.fillRatio, 0);
  assert.deepEqual(layout.placement, { x: 0, y: 0, width: 1024, height: 1024 });
});

test("computeOutpaintLayout letterboxes a wide source into a 9:16 frame (top + bottom margins)", () => {
  const layout = computeOutpaintLayout({
    sourceWidth: 1600,
    sourceHeight: 900,
    target: outpaintTargetForAspect("9:16"),
  });

  assert.equal(layout.requiresOutpaint, true);
  assert.deepEqual(layout.placement, { x: 0, y: 608, width: 1024, height: 576 });
  assert.deepEqual(layout.maskRects, [
    { x: 0, y: 0, width: 1024, height: 608 },
    { x: 0, y: 1184, width: 1024, height: 608 },
  ]);
  assert.ok(layout.fillRatio > 0.6 && layout.fillRatio < 0.7);
});

test("computeOutpaintLayout pillarboxes a tall source into a landscape frame (left + right margins)", () => {
  const layout = computeOutpaintLayout({
    sourceWidth: 1000,
    sourceHeight: 1500,
    target: outpaintTargetForAspect("1.91:1"),
  });

  assert.equal(layout.requiresOutpaint, true);
  assert.deepEqual(layout.placement, { x: 555, y: 0, width: 682, height: 1024 });
  assert.deepEqual(layout.maskRects, [
    { x: 0, y: 0, width: 555, height: 1024 },
    { x: 1237, y: 0, width: 555, height: 1024 },
  ]);
});

test("computeOutpaintLayout biases placement toward the focal point", () => {
  const topFocused = computeOutpaintLayout({
    sourceWidth: 1600,
    sourceHeight: 900,
    target: outpaintTargetForAspect("9:16"),
    focalPoint: { x: 0.5, y: 0 },
  });

  // Focal at the top pins the photo to y=0, pushing all fill to the bottom.
  assert.equal(topFocused.placement.y, 0);
  assert.deepEqual(topFocused.maskRects, [{ x: 0, y: 576, width: 1024, height: 1216 }]);
});

test("computeOutpaintLayout rejects non-positive dimensions", () => {
  assert.throws(
    () => computeOutpaintLayout({ sourceWidth: 0, sourceHeight: 100, target: { width: 100, height: 100 } }),
    /positive source dimensions/,
  );
  assert.throws(
    () => computeOutpaintLayout({ sourceWidth: 100, sourceHeight: 100, target: { width: 0, height: 100 } }),
    /positive target dimensions/,
  );
});
