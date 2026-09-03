import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/components/adstudio/editor/layer-geometry.ts", "utf8");

describe("Ad Studio editor geometry contract", () => {
  it("keeps the absolute neutral just-listed feed bounds top-left anchored", async () => {
    // The explicit extension keeps this test executable by Node's built-in
    // TypeScript stripping; the repo's compiler still type-checks the source.
    // @ts-expect-error TS5097: intentional source import for a Node test
    const { resolveGeometry, fabricRectGeometry } = await import("../../src/components/adstudio/editor/layer-geometry.ts");
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
  });

  it("resolves normalized pack rectangles with the same dimensions as the server renderer", async () => {
    // @ts-expect-error TS5097: intentional source import for a Node test
    const { resolveGeometry } = await import("../../src/components/adstudio/editor/layer-geometry.ts");
    const geometry = { x: 0.1, y: 0.2, width: 0.5, height: 0.4 };
    assert.deepEqual(resolveGeometry(geometry, { width: 1080, height: 1920 }), {
      x: 108,
      y: 384,
      width: 540,
      height: 768,
    });
  });
});
