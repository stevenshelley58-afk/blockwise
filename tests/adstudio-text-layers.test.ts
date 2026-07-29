import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  boxIntersectsTextRegions,
  extendTextLayersValidity,
  parseTextLayerStyles,
  TEXT_LAYERS_VALID_FOR_LIMIT,
} from "../src/lib/adstudio/text-layers.ts";
import { paddedPixelRect } from "../src/lib/adstudio/region-edit.ts";
import { paddedPatchRect } from "../src/components/adstudio/canvas/text-patch.ts";
import type { AdStudioCloneRegion, AdStudioTextLayers } from "../src/lib/adstudio/types.ts";

const editor = readFileSync("src/components/adstudio/canvas/in-place-ad-editor.tsx", "utf8");
const layersRoute = readFileSync("src/app/api/adstudio/creatives/[id]/layers/route.ts", "utf8");

const regions: AdStudioCloneRegion[] = [
  { key: "headline", kind: "text", box: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 } },
  { key: "price", kind: "text", box: { x: 0.6, y: 0.8, width: 0.3, height: 0.08 } },
  { key: "hero_photo", kind: "image", box: { x: 0, y: 0.25, width: 1, height: 0.5 } },
];

function layersFixture(validFor: string[]): AdStudioTextLayers {
  return { status: "ready", builtAt: "2026-01-01T00:00:00.000Z", plate: "/api/adstudio/media?path=p", styles: {}, validFor };
}

test("model-edit boxes only invalidate layers when they can touch a text region", () => {
  // The hero photo overlaps neither text box even with tolerance? It spans the
  // full width from y=0.25 to 0.75 — clear of both text rows.
  assert.equal(boxIntersectsTextRegions({ x: 0, y: 0.25, width: 1, height: 0.5 }, regions), false);
  // A box crossing the headline row invalidates.
  assert.equal(boxIntersectsTextRegions({ x: 0.2, y: 0.05, width: 0.2, height: 0.1 }, regions), true);
  // Tolerance: a box stopping just above the price row still counts as touching.
  assert.equal(boxIntersectsTextRegions({ x: 0.6, y: 0.7, width: 0.2, height: 0.09 }, regions), true);
  // No box means a full-image edit: always invalidate.
  assert.equal(boxIntersectsTextRegions(undefined, regions), true);
  // Image regions never gate validity.
  assert.equal(boxIntersectsTextRegions({ x: 0, y: 0.3, width: 0.1, height: 0.1 }, [regions[2]!]), false);
});

test("plate validity list dedupes, appends newest last, and stays bounded", () => {
  const extended = extendTextLayersValidity(layersFixture(["a", "b"]), "b");
  assert.deepEqual(extended.validFor, ["a", "b"]);
  const appended = extendTextLayersValidity(layersFixture(["a"]), "c");
  assert.deepEqual(appended.validFor, ["a", "c"]);
  const many = Array.from({ length: TEXT_LAYERS_VALID_FOR_LIMIT + 4 }, (_, index) => `r${index}`);
  const bounded = extendTextLayersValidity(layersFixture(many), "new");
  assert.equal(bounded.validFor.length, TEXT_LAYERS_VALID_FOR_LIMIT);
  assert.equal(bounded.validFor.at(-1), "new");
});

test("detected styles are clamped to safe values and unknown keys are dropped", () => {
  const styles = parseTextLayerStyles({
    styles: [
      { key: "headline", family: "serif", weight: 800, italic: true, uppercase: true, color: "#123abc", align: "left", letterSpacing: "wide" },
      { key: "headline_ghost", family: "serif", weight: 700, color: "#fff", align: "center" },
      { key: "price", family: "comic", weight: 350, color: "not-a-colour", align: "diagonal", letterSpacing: "tight" },
    ],
  }, ["headline", "price"]);
  assert.deepEqual(Object.keys(styles).sort(), ["headline", "price"]);
  assert.deepEqual(styles.headline, {
    family: "serif", weight: 800, italic: true, uppercase: true, color: "#123abc", align: "left", letterSpacing: "wide",
  });
  // Out-of-range values fall back to safe defaults rather than failing.
  assert.deepEqual(styles.price, {
    family: "sans", weight: 700, italic: false, uppercase: false, color: "#ffffff", align: "center", letterSpacing: "normal",
  });
  assert.deepEqual(parseTextLayerStyles(null, ["headline"]), {});
});

test("client patch rect and server composite rect are the same pixels", () => {
  const samples = [
    { box: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 }, width: 1024, height: 1280 },
    { box: { x: 0, y: 0, width: 0.3, height: 0.05 }, width: 864, height: 1536 },
    { box: { x: 0.7, y: 0.9, width: 0.3, height: 0.1 }, width: 1200, height: 628 },
    { box: { x: 0.33, y: 0.47, width: 0.011, height: 0.013 }, width: 1024, height: 1024 },
  ];
  for (const sample of samples) {
    assert.deepEqual(
      paddedPatchRect(sample.box, sample.width, sample.height),
      paddedPixelRect(sample.box, sample.width, sample.height),
    );
  }
});

test("editor builds layers in the background and applies text edits optimistically", () => {
  // Decomposition kicks off silently from the editor; failures never block.
  assert.match(editor, /requestCreativeLayers\(creative\.creativeId\)/);
  // The patch doubles as the optimistic overlay: final pixels, instantly.
  assert.match(editor, /renderTextPatch\(/);
  assert.match(editor, /setOptimisticPatch\(\{ key: selectedRegion\.key/);
  assert.match(editor, /studio-inplace-optimistic/);
  // Inlined finished pixels paint without a media-proxy round trip.
  assert.match(editor, /freshPreview/);
  // A stale instant path falls back to the model path in the same gesture.
  assert.match(editor, /layers_stale/);
});

test("the decompose route protects the design and the budget", () => {
  // Only padded text-region rectangles may come from the inpaint model —
  // every other plate pixel is byte-for-byte the original render.
  assert.match(layersRoute, /derivePlateFromInpaint/);
  // The inpaint and the style read run together, not in sequence.
  assert.match(layersRoute, /Promise\.all/);
  // Rebuilds are rate limited and never clobber a render that moved on.
  assert.match(layersRoute, /ai-layer-decompose/);
  assert.match(layersRoute, /eq\("active_revision_id", row\.active_revision_id\)/);
});
