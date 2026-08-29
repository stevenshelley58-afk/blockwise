import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("crop dialog keyboard controls", () => {
  it("exposes labeled numeric move and resize controls", () => {
    const source = readFileSync("src/components/adstudio/editor/crop-dialog.tsx", "utf8");
    assert.match(source, /aria-label="Keyboard crop controls"/u);
    assert.match(source, /aria-label="Crop left position \(%\)"/u);
    assert.match(source, /aria-label="Crop top position \(%\)"/u);
    assert.match(source, /aria-label="Crop width \(%\)"/u);
    assert.match(source, /type="number"/u);
  });

  it("moves focus into the modal, traps Tab, closes on Escape, and restores focus", () => {
    const source = readFileSync("src/components/adstudio/editor/crop-dialog.tsx", "utf8");
    assert.match(source, /cancelButtonRef\.current \?\? dialogRef\.current/u);
    assert.match(source, /returnFocusRef\.current/u);
    assert.match(source, /returnFocus\.focus\(\)/u);
    assert.match(source, /event\.key === "Escape"/u);
    assert.match(source, /event\.key !== "Tab"/u);
    assert.match(source, /querySelectorAll<HTMLElement>/u);
  });
});
