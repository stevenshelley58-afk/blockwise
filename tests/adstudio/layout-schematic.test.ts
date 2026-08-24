import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizedImagePlacement, wrapSchematicText } from "../../src/lib/adstudio/layout-schematic-preview.ts";
import type { Rect } from "../../packages/ad-template-pack-contract/src/types.ts";

describe("layout schematic customer preview", () => {
  it("maps a normalized crop into the slot without changing its display size", () => {
    const slot: Rect = { x: 100, y: 200, width: 400, height: 300 };
    const placement = normalizedImagePlacement(slot, { x: 0.25, y: 0.1, width: 0.5, height: 0.75 });

    assert.deepEqual(placement, { x: -100, y: 160, width: 800, height: 400 });
    assert.equal(placement.x + 0.25 * placement.width, slot.x);
    assert.equal(placement.y + 0.1 * placement.height, slot.y);
  });

  it("clamps malformed crops to finite positive geometry", () => {
    const placement = normalizedImagePlacement(
      { x: 0, y: 0, width: 100, height: 200 },
      { x: 4, y: -2, width: 0, height: Number.NaN },
    );

    assert.ok(Object.values(placement).every(Number.isFinite));
    assert.ok(placement.width > 0);
    assert.ok(placement.height > 0);
  });

  it("wraps current values to the declared line budget and marks truncation", () => {
    assert.deepEqual(
      wrapSchematicText("A bright home near the river", 200, 2, 180, 24),
      ["A bright", "home near…"],
    );
  });

  it("uses customer values and image sources in the SVG instead of input-key labels", () => {
    const source = readFileSync("src/components/adstudio/editor/layout-schematic.tsx", "utf8");
    assert.match(source, /imageValues\?\.\[layer\.inputKey\]/u);
    assert.match(source, /textValues\?\.\[layer\.inputKey\]/u);
    assert.match(source, /preserveAspectRatio="none"/u);
    assert.doesNotMatch(source, />\{layer\.inputKey\}<\/text>/u);
  });
});
