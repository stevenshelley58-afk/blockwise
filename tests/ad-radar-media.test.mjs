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

// Regression: the deployed extractor received nested card arrays and returned
// zero media for both casing variants, losing every carousel card while the
// flat top-level image control still resolved. The 172 active carousels with
// no archived media all still carry their card URLs in the saved raw record.
test("nested carousel card arrays are flattened for both casing variants", () => {
  const camelCase = {
    images: [{ originalImageUrl: "https://cdn.test/top-level.jpg" }],
    cards: [[{ imageUrl: "https://cdn.test/camel-card-1.jpg" }, { imageUrl: "https://cdn.test/camel-card-2.jpg" }]],
  };
  const snakeCase = {
    cards: [[{ image_url: "https://cdn.test/snake-card-1.jpg" }, { image_url: "https://cdn.test/snake-card-2.jpg" }]],
  };

  assert.deepEqual(cardMediaValues(camelCase.cards, "image"), [
    "https://cdn.test/camel-card-1.jpg",
    "https://cdn.test/camel-card-2.jpg",
  ]);
  assert.deepEqual(cardMediaValues(snakeCase.cards, "image"), [
    "https://cdn.test/snake-card-1.jpg",
    "https://cdn.test/snake-card-2.jpg",
  ]);
  // The flat top-level control must keep resolving while carousels are fixed.
  assert.deepEqual(cardMediaValues(camelCase.images, "image"), ["https://cdn.test/top-level.jpg"]);
});

test("deeply nested card objects keep every variant and stay deduplicated", () => {
  const nested = [
    { image_url: "https://cdn.test/card-a.jpg", cards: [{ imageUrl: "https://cdn.test/card-b.jpg" }] },
    [{ cards: [[{ original_image_url: "https://cdn.test/card-c.jpg" }]] }],
    { imageUrl: "https://cdn.test/card-a.jpg" },
  ];
  assert.deepEqual(cardMediaValues(nested, "image"), [
    "https://cdn.test/card-a.jpg",
    "https://cdn.test/card-b.jpg",
    "https://cdn.test/card-c.jpg",
  ]);
});

test("non-card values and unsupported kinds fail closed", () => {
  assert.deepEqual(cardMediaValues([null, "url", 7, true], "image"), []);
  assert.deepEqual(cardMediaValues(undefined, "image"), []);
  assert.throws(() => cardMediaValues([], "audio"), /unsupported media kind/u);
});
