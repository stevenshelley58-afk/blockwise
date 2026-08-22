// Editor state reducer + guided-mode guard rails (Track A, §7 / §12).
// Pure part only; the react hook is exercised through the workbench/e2e.

import assert from "node:assert/strict";
import test from "node:test";

import type { AdDocInstance, AdTemplateDocV2 } from "../../src/lib/adstudio/v2/template-doc";
import {
  applyEditorAction,
  guardAction,
  layerOverrides,
} from "../../src/lib/adstudio/v2/editor-state.ts";
import { makeEditorReducer } from "../../src/lib/adstudio/v2/editor-state.ts";

const template = {
  schema: "adstudio.template.v2",
  id: "meta-editor-fixture",
  editPolicy: { mode: "guided", advancedUnlockable: true, lockedLayerIds: ["logo-patch"] },
  inputs: {
    images: [{ key: "property", label: "Property", required: true, description: "Photo" }],
    text: [
      { key: "headline", label: "Headline", required: true, maxLength: 40, sample: "Book now" },
    ],
  },
  formats: {
    feed: {
      format: "4:5",
      width: 1080,
      height: 1350,
      plate: { src: "/adstudio-templates/meta-editor-fixture/plate-feed.png", sha256: "0".repeat(64) },
      layers: [
        { id: "slot-property", type: "image_slot", z: 1, inputKey: "property", fit: "cover",
          box: { x: 0.1, y: 0.1, width: 0.8, height: 0.5 }, mask: { kind: "rect" } },
        { id: "text-headline", type: "text", z: 2, inputKey: "headline",
          box: { x: 0.1, y: 0.7, width: 0.8, height: 0.1 },
          typo: { fontId: "alegreya", family: "Alegreya", fallbackFamily: "serif", weight: 700,
            italic: false, case: "none", sizeRatio: 0.5, lineHeight: 1.1, tracking: 0,
            align: "center", color: "#111111" },
          constraints: { maxLength: 40, maxLines: 2, autoFitMinRatio: 0.85 },
          measurement: { fitScore: 0.9, detectionScore: 0.9, source: "manual-verified", version: 1 } },
        { id: "logo-patch", type: "overlay_patch", z: 3,
          box: { x: 0.8, y: 0.02, width: 0.15, height: 0.06 },
          src: "/adstudio-templates/meta-editor-fixture/patch-logo-patch.png", sha256: "1".repeat(64) },
      ],
    },
  },
} as unknown as AdTemplateDocV2;

function freshInstance(): AdDocInstance {
  return {
    schema: "adstudio.instance.v2",
    templateId: "meta-editor-fixture",
    templateHash: "2".repeat(64),
    format: "4:5",
    values: { images: { property: { src: "x" } }, text: { headline: "Book now" } },
    overrides: [],
  };
}

test("text edits clamp to the declared maxLength and reject unknown keys", () => {
  const long = "y".repeat(60);
  const next = applyEditorAction(template, freshInstance(), { type: "set-text", key: "headline", value: long });
  assert.equal(next.values.text.headline.length, 40);
  assert.equal(guardAction(template, freshInstance(), { type: "set-text", key: "nope", value: "x" }, "guided").allowed, false);
});

test("guided mode only allows palette colour overrides; advanced unlocks move", () => {
  const instance = freshInstance();
  const move = { type: "override", layerId: "text-headline", op: "move", box: { x: 0.2, y: 0.7, width: 0.6, height: 0.1 }, mode: "guided" } as const;
  assert.equal(guardAction(template, instance, move, "guided").allowed, false);
  assert.equal(guardAction(template, instance, move, "advanced").allowed, true);

  const colour = { type: "override", layerId: "text-headline", op: "color", color: "#2244aa", mode: "guided", palette: ["#2244aa"] } as const;
  assert.equal(guardAction(template, instance, colour as never, "guided").allowed, true);
  const offPalette = { ...colour, color: "#ff00ff" };
  assert.equal(guardAction(template, instance, offPalette as never, "guided").allowed, false);
  assert.equal(guardAction(template, instance, offPalette as never, "advanced").allowed, true);
});

test("locked layers reject every override in every mode", () => {
  const instance = freshInstance();
  const move = { type: "override", layerId: "logo-patch", op: "move", box: { x: 0, y: 0, width: 0.1, height: 0.1 }, mode: "studio" } as const;
  assert.equal(guardAction(template, instance, move, "studio").allowed, false);
});

test("advanced and studio mode only permit movement overrides on unlocked text layers", () => {
  const instance = freshInstance();
  const move = (layerId: string) => ({
    type: "override" as const,
    layerId,
    op: "move" as const,
    box: { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
  });

  assert.equal(guardAction(template, instance, move("slot-property"), "advanced").allowed, false);
  assert.equal(guardAction(template, instance, move("logo-patch"), "studio").allowed, false);
  assert.equal(guardAction(template, instance, move("text-headline"), "advanced").allowed, true);
});

test("photo repositioning uses the supported focal-point action in every customer mode", () => {
  const instance = freshInstance();
  instance.values.images.property = { src: "x", focal: { x: 0.5, y: 0.5 }, zoom: 1.4 };
  const action = { type: "image-focal", key: "property", focal: { x: 0.2, y: 0.8 } } as const;

  assert.equal(guardAction(template, instance, action, "guided").allowed, true);
  const next = applyEditorAction(template, instance, action);
  assert.deepEqual(next.values.images.property, {
    src: "x",
    focal: { x: 0.2, y: 0.8 },
    zoom: 1.4,
  });
});

test("overrides of the same layer+op replace, different ops stack", () => {
  const reducer = makeEditorReducer(template, []);
  let state: import("../../src/lib/adstudio/v2/editor-state.ts").EditorDocState = {
    instance: freshInstance(), past: [], future: [], lastGesture: null, denied: null,
  };
  state = reducer(state, { kind: "edit", mode: "advanced", gestureId: "g1", action: { type: "override", layerId: "text-headline", op: "move", box: { x: 0.2, y: 0.7, width: 0.6, height: 0.1 } } });
  state = reducer(state, { kind: "edit", mode: "advanced", gestureId: "g2", action: { type: "override", layerId: "text-headline", op: "move", box: { x: 0.3, y: 0.7, width: 0.5, height: 0.1 } } });
  state = reducer(state, { kind: "edit", mode: "advanced", gestureId: "g3", action: { type: "override", layerId: "text-headline", op: "align", align: "left" } });
  assert.equal(state.instance.overrides.length, 2);
  assert.deepEqual(layerOverrides(state.instance, "text-headline"), {
    box: { x: 0.3, y: 0.7, width: 0.5, height: 0.1 },
    align: "left",
  });
});

test("undo/redo: gesture coalescing, deny does not push history, ends no-op", () => {
  const reducer = makeEditorReducer(template, []);
  let state: import("../../src/lib/adstudio/v2/editor-state.ts").EditorDocState = {
    instance: freshInstance(), past: [], future: [], lastGesture: null, denied: null,
  };

  // typing one gesture = one undo step
  state = reducer(state, { kind: "edit", mode: "guided", gestureId: "t1", action: { type: "set-text", key: "headline", value: "A" } });
  state = reducer(state, { kind: "edit", mode: "guided", gestureId: "t1", action: { type: "set-text", key: "headline", value: "AB" } });
  assert.equal(state.past.length, 1);

  // denied action records the reason but never pushes history
  state = reducer(state, { kind: "edit", mode: "guided", gestureId: "t2", action: { type: "override", layerId: "text-headline", op: "move", box: { x: 0, y: 0, width: 0.1, height: 0.1 } } });
  assert.ok(state.denied);
  assert.equal(state.past.length, 1);

  state = reducer(state, { kind: "undo" });
  assert.equal(state.instance.values.text.headline, "Book now");
  state = reducer(state, { kind: "undo" }); // no-op at stack end
  assert.equal(state.instance.values.text.headline, "Book now");
  state = reducer(state, { kind: "redo" });
  assert.equal(state.instance.values.text.headline, "AB");
});
