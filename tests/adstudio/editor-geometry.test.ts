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
    const { resolveGeometry, fabricPathPosition } = await import("../../src/components/adstudio/editor/layer-geometry.ts");
    const geometry = { x: 0.1, y: 0.2, width: 0.5, height: 0.4 };
    assert.deepEqual(resolveGeometry(geometry, { width: 1080, height: 1920 }), {
      x: 108,
      y: 384,
      width: 540,
      height: 768,
    });
    // Local line commands are normalized around their path bounds; preserve
    // the line's intended half-height offset when returning to canvas space.
    assert.deepEqual(fabricPathPosition({ width: 540, height: 0, pathOffset: { x: 270, y: 384 } }, { x: 108, y: 384, width: 540, height: 768 }), {
      left: 108,
      top: 768,
      originX: "left",
      originY: "top",
    });
    // A check icon's local command bounds begin inside its authored box.
    assert.deepEqual(fabricPathPosition({ width: 410.4, height: 460.8, pathOffset: { x: 270, y: 384 } }, { x: 108, y: 384, width: 540, height: 768 }), {
      left: 172.8,
      top: 537.6,
      originX: "left",
      originY: "top",
    });
  });

  it("anchors Fabric line and icon paths using their normalized command bounds", async () => {
    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    (globalThis as { window?: unknown }).window = dom.window;
    (globalThis as { document?: unknown }).document = dom.window.document;
    const { Path } = await import("fabric");
    const { fabricPathPosition } = await import("../../src/components/adstudio/editor/layer-geometry.ts");
    const geometry = { x: 100, y: 200, width: 300, height: 100 };

    const line = new Path("M 0 50 L 300 50", { stroke: "#000", strokeWidth: 2 });
    line.set(fabricPathPosition(line, geometry));
    assert.deepEqual(line.getBoundingRect(), { left: 100, top: 250, width: 302, height: 2 });

    const check = new Path("M 36 52 L 120 80 L 264 20", { stroke: "#000", strokeWidth: 2 });
    check.set(fabricPathPosition(check, geometry));
    assert.deepEqual(check.getBoundingRect(), { left: 136, top: 220, width: 230, height: 62 });
  });
});
