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
      left: 110,
      top: 90,
      originX: "left",
      originY: "top",
      radius: 90,
    });
    assert.deepEqual(fabricCircleGeometry({ x: 80, y: 90, width: 180, height: 180 }), {
      left: 80,
      top: 90,
      originX: "left",
      originY: "top",
      radius: 90,
    });
  });

  it("resolves normalized pack rectangles with the same dimensions as the server renderer", async () => {
    const { resolveGeometry, effectiveTextFontSize, fabricPathPosition } = await import("../../src/components/adstudio/editor/layer-geometry.ts");
    const { resolveRenderGeometry, effectiveTextFontSize: serverTextFontSize } = await import("../../packages/ad-template-renderer/src/renderer.ts");
    const geometry = { x: 0.1, y: 0.2, width: 0.5, height: 0.4 };
    const resolved = resolveGeometry(geometry, { width: 1080, height: 1920 });
    assert.deepEqual(resolved, {
      x: 108,
      y: 384,
      width: 540,
      height: 768,
    });
    assert.deepEqual(resolveRenderGeometry(geometry, { width: 1080, height: 1920 }), resolved);
    const textLayer = { fontSize: 96, sizeRatio: 0.05 };
    assert.ok(Math.abs(effectiveTextFontSize(textLayer, resolved) - 38.4) < 1e-9);
    assert.ok(Math.abs(serverTextFontSize(textLayer, resolved) - effectiveTextFontSize(textLayer, resolved)) < 1e-9);
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
    const { Path } = await import("fabric/node");
    const { fabricPathPosition } = await import("../../src/components/adstudio/editor/layer-geometry.ts");
    const geometry = { x: 100, y: 200, width: 300, height: 100 };

    const line = new Path("M 0 50 L 300 50", { stroke: "#000", strokeWidth: 2 });
    line.set(fabricPathPosition(line, geometry));
    assert.deepEqual(line.getBoundingRect(), { left: 100, top: 250, width: 302, height: 2 });

    const check = new Path("M 36 52 L 120 80 L 264 20", { stroke: "#000", strokeWidth: 2 });
    check.set(fabricPathPosition(check, geometry));
    assert.deepEqual(check.getBoundingRect(), { left: 136, top: 220, width: 230, height: 62 });
  });

  it("uses the server's circle fallback for unknown icons and keeps it centred", async () => {
    const { fabricIconCircleGeometry, fabricIconPathData, resolveIconShape } = await import("../../src/components/adstudio/editor/layer-geometry.ts");
    const geometry = { x: 108, y: 384, width: 540, height: 768 };
    assert.equal(resolveIconShape("unrecognised-icon"), "circle");
    assert.equal(fabricIconPathData("unrecognised-icon", geometry.width, geometry.height), null);
    const circle = fabricIconCircleGeometry(geometry);
    assert.equal(circle.originX, "center");
    assert.equal(circle.originY, "center");
    assert.ok(Math.abs(circle.left - 378) < 1e-9);
    assert.ok(Math.abs(circle.top - 768) < 1e-9);
    assert.ok(Math.abs(circle.radius - 183.6) < 1e-9);
    assert.equal(fabricIconPathData("check", 100, 100), "M 18 50 L 42 76 L 84 24");
  });

  it("keeps rounded image mask corners at the canonical 16px radius", async () => {
    const { imageMaskRadius } = await import("../../src/components/adstudio/editor/layer-geometry.ts");
    const { imageMaskRadius: serverImageMaskRadius } = await import("../../packages/ad-template-renderer/src/renderer.ts");
    assert.equal(imageMaskRadius({ width: 100, height: 80 }), 16);
    assert.equal(serverImageMaskRadius({ width: 100, height: 80 }), 16);
    // A small authored box must not inherit a radius larger than either half
    // dimension; both renderers clamp the same way before drawing/clipping.
    assert.equal(imageMaskRadius({ width: 5, height: 3 }), 1.5);
    assert.equal(serverImageMaskRadius({ width: 5, height: 3 }), 1.5);
  });
});
