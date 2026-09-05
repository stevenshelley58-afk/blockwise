import assert from "node:assert/strict";
import test from "node:test";

import { prepareTextLayout, wrapText, type TextMeasurer } from "./text-layout.ts";

const measure: TextMeasurer = (text, fontSize) => ({
  width: Array.from(text).length * fontSize * 0.5,
  ascent: fontSize * 0.8,
  descent: fontSize * 0.2,
});

test("wrapText preserves authored paragraphs and splits overlong grapheme runs", () => {
  assert.deepEqual(wrapText("alpha beta\n\nabcdefgh", 25, 10, 0, measure), [
    "alpha",
    "beta",
    "",
    "abcde",
    "fgh",
  ]);
});

test("prepareTextLayout uses deterministic half-pixel scale-down steps", () => {
  const prepared = prepareTextLayout({
    text: "AAAA BBBB",
    width: 50,
    height: 20,
    baseFontSize: 20,
    readabilityFloor: 10,
    maxLines: 1,
    lineHeight: 1,
    trackingPixels: 0,
    overflowBehaviour: "scale_down",
    measure,
  });
  assert.equal(prepared.kind, "paint");
  if (prepared.kind !== "paint") return;
  assert.equal(prepared.fontSize, 11);
  assert.deepEqual(prepared.lines, ["AAAA BBBB"]);
  assert.equal(prepared.ascent, 8.8);
});

test("prepareTextLayout refuses scale-down below the readability floor", () => {
  assert.deepEqual(prepareTextLayout({
    text: "too wide",
    width: 10,
    height: 20,
    baseFontSize: 20,
    readabilityFloor: 12,
    maxLines: 1,
    lineHeight: 1,
    trackingPixels: 0,
    overflowBehaviour: "scale_down",
    measure,
  }), { kind: "unfit" });
});

test("truncate appends a width-bounded ellipsis", () => {
  const prepared = prepareTextLayout({
    text: "one two three",
    width: 30,
    height: 10,
    baseFontSize: 10,
    readabilityFloor: 8,
    maxLines: 1,
    lineHeight: 1,
    trackingPixels: 0,
    overflowBehaviour: "truncate",
    measure,
  });
  assert.equal(prepared.kind, "paint");
  if (prepared.kind === "paint") assert.deepEqual(prepared.lines, ["one…"]);
});
