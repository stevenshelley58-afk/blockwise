import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("Ad Studio appearance controls", () => {
  it("offers template, Brand Pack, and custom palettes with validated manual roles", () => {
    const source = readFileSync("src/components/adstudio/editor/colour-toggle.tsx", "utf8");

    assert.match(source, /value: "template"/);
    assert.match(source, /value: "brand_pack"/);
    assert.match(source, /value: "manual"/);
    assert.match(source, /type="color"/);
    assert.match(source, /aria-invalid=\{!valid\}/);
    assert.match(source, /onColourChange\(role, normalised\)/);
    assert.match(source, /onResetColour\(role\)/);
    assert.match(source, /colourContrastWarnings/);
    assert.match(source, /aim for at least 4\.5:1/);
  });

  it("persists every palette mode and makes individual role edits undoable", () => {
    const source = readFileSync("src/components/adstudio/editor/use-editor-state.ts", "utf8");
    const roleAction = source.match(/const updateColour = useCallback[\s\S]*?\}, \[pushUndo\]\);/)?.[0] ?? "";
    const resetAction = source.match(/const resetColour = useCallback[\s\S]*?\}, \[pushUndo\]\);/)?.[0] ?? "";

    assert.match(source, /colourMode: ColourMode/);
    assert.match(source, /colourMode: state\.colourMode/);
    assert.match(source, /resolvedColourMap: \{ \.\.\.state\.resolvedColourMap \}/);
    assert.match(roleAction, /pushUndo\(prev\)/);
    assert.match(roleAction, /colourMode: "manual"/);
    assert.match(roleAction, /\[role\]: colour/);
    assert.match(resetAction, /pushUndo\(prev\)/);
    assert.match(resetAction, /prev\.pack\.semanticColours\[role\]/);
  });
});
