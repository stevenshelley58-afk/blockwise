import assert from "node:assert/strict";
import test from "node:test";

import {
  mapMeasuredLineBox,
  scaledTextWidth,
  splitTextIntoMeasuredLines,
} from "../src/components/adstudio/canvas/text-patch.ts";

test("maps an offline measured line proportionally into its current text region", () => {
  assert.deepEqual(
    mapMeasuredLineBox(
      { x: 0.2, y: 0.3, width: 0.2, height: 0.1 },
      { x: 0.1, y: 0.2, width: 0.4, height: 0.4 },
      { x: 0.5, y: 0.4, width: 0.2, height: 0.2 },
    ),
    { x: 0.55, y: 0.45, width: 0.1, height: 0.05 },
  );
});

test("splits replacement copy deterministically across measured rows", () => {
  assert.deepEqual(
    splitTextIntoMeasuredLines(
      "SMART FIRST STEPS",
      [{ text: "SMART" }, { text: "FIRST STEPS" }],
    ),
    ["SMART", "FIRST STEPS"],
  );
  assert.deepEqual(
    splitTextIntoMeasuredLines(
      "FIVE SMART BUYING STEPS",
      [{ text: "SMART" }, { text: "FIRST STEPS" }],
    ),
    ["FIVE", "SMART BUYING STEPS"],
  );
  assert.deepEqual(splitTextIntoMeasuredLines("One line", 1), ["One line"]);
});

test("measured line width honors its offline horizontal glyph scale", () => {
  assert.equal(scaledTextWidth(438.3, 0.828), 362.9124);
  assert.equal(scaledTextWidth(120), 120);
});
