import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Ad Studio editor geometry contract", () => {
  it("keeps the absolute neutral just-listed feed bounds top-left anchored", async () => {
    // The explicit extension keeps this test executable by Node's built-in
    // TypeScript stripping; the repo's compiler still type-checks the source.
    const { resolveGeometry, fabricRectGeometry, fabricCircleGeometry } = await import("../../src/components/adstudio/editor/layer-geometry.ts");
    const geometry = { x: 0, y: 0, width: 1080, height: 1350 };
    assert.deepEqual(resolveGeometry(geometry, { width: 1080, height: 1350 }), geometry);
    assert.deepEqual(fabricRectGeometry(geometry), {
      left: 0,
      top: 0,
      originX: "left",
      originY: "top",
      width: 1080,
      height: 1350,
    });
    assert.deepEqual(fabricCircleGeometry({ x: 80, y: 90, width: 240, height: 180 }), {
      left: 80,
      top: 90,
      originX: "left",
      originY: "top",
      radius: 90,
    });
  });

  it("resolves normalized pack rectangles with the same dimensions as the server renderer", async () => {
    const { resolveGeometry, fabricPathGeometry } = await import("../../src/components/adstudio/editor/layer-geometry.ts");
    const geometry = { x: 0.1, y: 0.2, width: 0.5, height: 0.4 };
    assert.deepEqual(resolveGeometry(geometry, { width: 1080, height: 1920 }), {
      x: 108,
      y: 384,
      width: 540,
      height: 768,
    });
    // This is the shared position contract for vector paths, polygons, and icons.
    assert.deepEqual(fabricPathGeometry({ x: 108, y: 384, width: 540, height: 768 }), {
      left: 108,
      top: 384,
      originX: "left",
      originY: "top",
    });
  });
});
