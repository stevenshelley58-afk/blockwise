import assert from "node:assert/strict";
import test from "node:test";
import { cardMediaValues } from "../hermes/tools/research-runtime/bin/ad-radar-media.mjs";

const cards = [
  {
    imageUrl: "https://cdn.test/image-1.jpg",
    videoHdUrl: "https://cdn.test/video-1.mp4",
    thumbnailUrl: "https://cdn.test/video-1.jpg",
  },
  {
    image_url: "https://cdn.test/image-2.jpg",
    video_sd_url: "https://cdn.test/video-2.mp4",
    video_preview_image_url: "https://cdn.test/video-2.jpg",
  },
];

test("carousel extraction keeps image, video, and thumbnail lanes separate", () => {
  assert.deepEqual(cardMediaValues(cards, "image"), [
    "https://cdn.test/image-1.jpg",
    "https://cdn.test/image-2.jpg",
  ]);
  assert.deepEqual(cardMediaValues(cards, "video"), [
    "https://cdn.test/video-1.mp4",
    "https://cdn.test/video-2.mp4",
  ]);
  assert.deepEqual(cardMediaValues(cards, "thumbnail"), [
    "https://cdn.test/video-1.jpg",
    "https://cdn.test/video-2.jpg",
  ]);
});

test("non-card values and unsupported kinds fail closed", () => {
  assert.deepEqual(cardMediaValues([null, "url", ["nested"]], "image"), []);
  assert.throws(() => cardMediaValues([], "audio"), /unsupported media kind/u);
});
