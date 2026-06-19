import assert from "node:assert/strict";
import test from "node:test";

import {
  CENTER_FOCAL,
  computeFocalPointFromLuma,
  focalCoverPlacement,
} from "../src/lib/adstudio/smart-crop.ts";

// Build a width*height luminance buffer where a high-contrast checker block is
// painted into one region and the rest is flat - the focal point should land
// inside that block.
function lumaWithBusyBlock(
  width: number,
  height: number,
  block: { x0: number; y0: number; x1: number; y1: number },
): Float32Array {
  const luma = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inBlock = x >= block.x0 && x < block.x1 && y >= block.y0 && y < block.y1;
      // Checkerboard inside the block creates strong local gradients; flat 128 elsewhere.
      luma[y * width + x] = inBlock ? ((x + y) % 2 === 0 ? 255 : 0) : 128;
    }
  }
  return luma;
}

test("computeFocalPointFromLuma centres on a flat image", () => {
  const luma = new Float32Array(40 * 40).fill(140);
  const focal = computeFocalPointFromLuma(luma, 40, 40);
  assert.deepEqual(focal, CENTER_FOCAL);
});

test("computeFocalPointFromLuma pulls toward the busy region", () => {
  // Busy block sits in the lower-right quadrant.
  const width = 60;
  const height = 60;
  const luma = lumaWithBusyBlock(width, height, { x0: 38, y0: 38, x1: 56, y1: 56 });
  const focal = computeFocalPointFromLuma(luma, width, height);

  assert.ok(focal.x > 0.5, `expected focal.x > 0.5, got ${focal.x}`);
  assert.ok(focal.y > 0.5, `expected focal.y > 0.5, got ${focal.y}`);
  // Safe band keeps it off the extreme edge.
  assert.ok(focal.x <= 0.85 && focal.y <= 0.85);
});

test("computeFocalPointFromLuma keeps a left-weighted subject left of centre", () => {
  const width = 60;
  const height = 60;
  const luma = lumaWithBusyBlock(width, height, { x0: 4, y0: 22, x1: 22, y1: 40 });
  const focal = computeFocalPointFromLuma(luma, width, height);

  assert.ok(focal.x < 0.5, `expected focal.x < 0.5, got ${focal.x}`);
  assert.ok(focal.x >= 0.15, "focal should stay inside the safe band");
});

test("computeFocalPointFromLuma guards against undersized buffers", () => {
  assert.deepEqual(computeFocalPointFromLuma(new Float32Array(4), 2, 2), CENTER_FOCAL);
  assert.deepEqual(computeFocalPointFromLuma(new Float32Array(5), 10, 10), CENTER_FOCAL);
});

test("focalCoverPlacement centres a wide source in a tall frame", () => {
  const frame = { left: 0, top: 0, width: 100, height: 200 };
  const placement = focalCoverPlacement({ frame, sourceWidth: 400, sourceHeight: 200 });

  // Cover scale is driven by the taller axis: 200 / 200 = 1.
  assert.equal(placement.scale, 1);
  assert.equal(placement.scaledWidth, 400);
  assert.equal(placement.scaledHeight, 200);
  // Centre crop: 50 - 0.5*400 = -150.
  assert.equal(placement.left, -150);
  assert.equal(placement.top, 0);
});

test("focalCoverPlacement keeps the frame fully covered when the focal is at an edge", () => {
  const frame = { left: 0, top: 0, width: 100, height: 200 };
  const placement = focalCoverPlacement({
    frame,
    sourceWidth: 400,
    sourceHeight: 200,
    focal: { x: 0.95, y: 0.5 },
  });

  // Desired left would be 50 - 0.95*400 = -330, but clamped so the right edge
  // never pulls inside the frame: min left = frame.width - scaledWidth = -300.
  assert.equal(placement.left, -300);
  // No gaps: image still spans the whole frame.
  assert.ok(placement.left <= 0);
  assert.ok(placement.left + placement.scaledWidth >= frame.width);
});

test("focalCoverPlacement shifts toward a non-centre focal within bounds", () => {
  const frame = { left: 0, top: 0, width: 100, height: 100 };
  const centre = focalCoverPlacement({ frame, sourceWidth: 300, sourceHeight: 100 });
  const shifted = focalCoverPlacement({
    frame,
    sourceWidth: 300,
    sourceHeight: 100,
    focal: { x: 0.3, y: 0.5 },
  });

  // A left-of-centre focal moves the image right (toward a less negative left).
  assert.ok(shifted.left > centre.left, `${shifted.left} should exceed ${centre.left}`);
  assert.ok(shifted.left <= 0);
});

test("focalCoverPlacement falls back to frame size for degenerate source dims", () => {
  const frame = { left: 10, top: 20, width: 100, height: 100 };
  const placement = focalCoverPlacement({ frame, sourceWidth: 0, sourceHeight: 0 });
  assert.equal(placement.scale, 1);
  assert.equal(placement.left, 10);
  assert.equal(placement.top, 20);
});
