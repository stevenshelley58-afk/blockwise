import assert from "node:assert/strict";
import test from "node:test";

import { buildLayoutBrief } from "../src/lib/adstudio/layout-brief.ts";

function creative(objects: Array<{ role: string; x: number; y: number; width: number; height: number }>) {
  return {
    format: "1:1" as const,
    canvas: {
      width: 1080,
      height: 1080,
      objects: objects.map((o) => ({ ...o, objectId: o.role, type: "text" as const, locked: false })),
    },
  };
}

test("buildLayoutBrief names a copy-safe zone and forbids rendered text", () => {
  const brief = buildLayoutBrief(
    creative([
      { role: "headline", x: 86, y: 560, width: 800, height: 140 },
      { role: "cta_button", x: 86, y: 788, width: 360, height: 78 },
    ]),
  );
  assert.match(brief, /copy-safe/i);
  assert.match(brief, /lower third/i);
  assert.match(brief, /do not render any text/i);
  assert.match(brief, /1:1/);
});

test("buildLayoutBrief places the subject opposite a side-weighted copy block", () => {
  const brief = buildLayoutBrief(
    creative([
      { role: "headline", x: 560, y: 470, width: 360, height: 120 },
      { role: "subheadline", x: 560, y: 600, width: 340, height: 80 },
    ]),
  );
  assert.match(brief, /right side/i);
  assert.match(brief, /left side/i);
});

test("buildLayoutBrief falls back gracefully when there are no copy objects", () => {
  const brief = buildLayoutBrief(creative([]));
  assert.match(brief, /lower portion/i);
  assert.match(brief, /Photoreal/i);
});
