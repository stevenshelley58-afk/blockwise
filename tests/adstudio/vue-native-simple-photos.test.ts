import assert from "node:assert/strict";
import test from "node:test";
import { applyTextValuesToScenes, nativeImageSlots, replaceNativeImageInScenes, type FabricObject, type FabricScene } from "../../src/components/adstudio/vue-editor/fabric-scene.ts";

const scene = (height: number, objects: FabricObject[]): FabricScene => ({ version: "5.3.0", width: 1080, height, objects });
const photo = (extra: FabricObject = {}): FabricObject => ({
  type: "image", id: "photo", inputKey: "photo", src: "/api/adstudio/media/original",
  left: 120, top: 170, width: 400, height: 600, scaleX: 1.5, scaleY: 1.5,
  angle: 17, skewX: 4, flipX: true, opacity: .8,
  metadata: { blockwiseType: "image_slot", inputKey: "photo" }, ...extra,
});

test("simple photos list only surviving bound slots, including groups and empty placeholders", () => {
  const input = { feed: scene(1350, [photo(), { type: "textbox", inputKey: "text", text: "Not a photo" }, { type: "image", src: "/plate" }]),
    story: scene(1920, [{ type: "group", objects: [photo(), { type: "rect", width: 50, height: 50, metadata: { inputKey: "logo", blockwiseType: "logo" } }] }]) };
  assert.deepEqual(nativeImageSlots(input), [
    { key: "photo", src: "/api/adstudio/media/original", placements: ["feed", "story"] },
    { key: "logo", src: null, placements: ["story"] },
  ]);
});

test("photo replacement center-crops without distortion, preserving each format's affine layout", () => {
  const feed = photo(), story = photo({ width: 700, height: 300, scaleX: 2, scaleY: 2, angle: -12 });
  const input = { feed: scene(1350, [feed]), story: scene(1920, [story]) };
  const before = structuredClone(input);
  const next = replaceNativeImageInScenes(input, "photo", "/api/adstudio/media/new", { width: 1600, height: 900 });
  for (const placement of ["feed", "story"] as const) {
    const old = input[placement].objects[0], current = next[placement].objects[0];
    for (const key of ["left", "top", "angle", "skewX", "flipX", "opacity", "id", "inputKey"]) assert.equal(current[key], old[key]);
    assert.ok(Math.abs(current.width * current.scaleX - old.width * old.scaleX) < .0001);
    assert.ok(Math.abs(current.height * current.scaleY - old.height * old.scaleY) < .0001);
    assert.equal(current.scaleX / current.scaleY, old.scaleX / old.scaleY);
    assert.ok(current.cropX >= 0 && current.cropX + current.width <= 1600.001);
    assert.ok(current.cropY >= 0 && current.cropY + current.height <= 900.001);
    assert.equal(current.src, "/api/adstudio/media/new");
  }
  assert.deepEqual(input, before);
});

test("relative and absolute masks, grouping, and freeform content survive photo replacement", () => {
  const clip = { type: "rect", width: 360, height: 500, left: 20, top: -15, scaleX: .8, scaleY: 1.2, angle: 3, rx: 30 };
  const fixed = { ...clip, absolutePositioned: true };
  const freeform = { type: "textbox", id: "custom", text: "Keep this", angle: 34 };
  const input = { feed: scene(1350, [{ type: "group", left: 40, scaleX: 2, objects: [photo({ clipPath: clip }), freeform] }]),
    story: scene(1920, [photo({ clipPath: fixed })]) };
  const next = replaceNativeImageInScenes(input, "photo", "/api/adstudio/media/new", { width: 1600, height: 900 });
  const group = next.feed.objects[0], changed = group.objects![0], ratio = changed.width / 400;
  assert.equal(group.left, 40); assert.equal(group.scaleX, 2);
  assert.deepEqual(group.objects![1], freeform);
  assert.equal(changed.clipPath.left, clip.left * ratio);
  assert.equal(changed.clipPath.top, clip.top * ratio);
  assert.equal(changed.clipPath.scaleX, clip.scaleX * ratio);
  assert.equal(changed.clipPath.angle, clip.angle);
  assert.deepEqual(next.story.objects[0].clipPath, fixed);
});

test("a removed slot is not recreated and unrelated objects stay unchanged", () => {
  const text = { type: "i-text", inputKey: "photo", text: "Do not replace text" };
  const input = { feed: scene(1350, [text]), story: scene(1920, [photo(), { type: "image", id: "custom", src: "/custom" }]) };
  const next = replaceNativeImageInScenes(input, "photo", "/api/adstudio/media/new", { width: 1200, height: 1200 });
  assert.deepEqual(next.feed, input.feed);
  assert.deepEqual(next.story.objects[1], input.story.objects[1]);
  assert.deepEqual(replaceNativeImageInScenes(input, "deleted", "/safe", { width: 100, height: 100 }), input);
});

test("empty rounded placeholders become masked images without bringing back placeholder fill", () => {
  const blank = { type: "rect", inputKey: "logo", metadata: { blockwiseType: "logo" }, width: 200, height: 100, rx: 10, ry: 10, fill: "#f1f2f4", stroke: "#d3d7df", strokeWidth: 2 };
  const input = { feed: scene(1350, [blank]), story: scene(1920, []) };
  const next = replaceNativeImageInScenes(input, "logo", "/safe", { width: 800, height: 800 }).feed.objects[0];
  assert.equal(next.type, "image"); assert.equal(next.width * next.scaleX, 200);
  assert.equal(next.height * next.scaleY, 100);
  assert.equal(next.clipPath.rx * next.scaleX, 10);
  assert.equal(next.fill, undefined); assert.equal(next.strokeWidth, 0);
});

test("simple image replacement rejects outside origins and invalid dimensions", () => {
  const input = { feed: scene(1350, [photo()]), story: scene(1920, []) };
  for (const src of ["https://outside.test/a", "//outside.test/a", "/\\outside.test/a", "data:image/png,x", "/bad\npath"]) {
    assert.throws(() => replaceNativeImageInScenes(input, "photo", src, { width: 100, height: 100 }), /same-origin/);
  }
  for (const width of [0, -1, Infinity, NaN]) assert.throws(() => replaceNativeImageInScenes(input, "photo", "/safe", { width, height: 100 }), /dimensions/);
});

test("bound i-text can still be edited with Words after native design changes", () => {
  const input = { feed: scene(1350, [{ type: "i-text", inputKey: "headline", text: "Before", angle: 7 }]), story: scene(1920, []) };
  assert.deepEqual(applyTextValuesToScenes(input, { headline: "After" }).feed.objects[0], { type: "i-text", inputKey: "headline", text: "After", angle: 7 });
});
