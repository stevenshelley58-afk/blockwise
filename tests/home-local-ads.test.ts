import assert from "node:assert/strict";
import test from "node:test";

import { homeAdImageUrl, selectHomeLocalAds } from "../src/lib/home/home-local-ads.ts";
import type { PublicAdRadarCard } from "../src/lib/research/public-ad-radar.ts";

function card(overrides: Partial<PublicAdRadarCard> & { id: string }): PublicAdRadarCard {
  return {
    pageName: "Northstar Realty",
    pageImageUrl: null,
    activeStatus: "active",
    startedAt: null,
    stoppedAt: null,
    lastSeenAt: null,
    durationLabel: null,
    platforms: [],
    postcode: "6019",
    suburb: "Scarborough",
    state: "WA",
    headline: "Book a local appraisal",
    body: null,
    description: null,
    cta: null,
    destinationUrl: null,
    destinationDomain: null,
    adType: null,
    media: [],
    ...overrides,
  };
}

test("the thumbnail is a still image, never a video file", () => {
  // An mp4 handed to an <img> is an unrenderable URL, which is what put broken
  // frames in the row before.
  assert.equal(
    homeAdImageUrl(
      card({
        id: "video-only",
        media: [{ kind: "video", url: "https://cdn.example/ad.mp4", posterUrl: null }],
      }),
    ),
    null,
  );

  assert.equal(
    homeAdImageUrl(
      card({
        id: "with-image",
        media: [
          { kind: "video", url: "https://cdn.example/ad.mp4", posterUrl: null },
          { kind: "image", url: "https://cdn.example/ad.jpg", posterUrl: null },
        ],
      }),
    ),
    "https://cdn.example/ad.jpg",
  );

  // A video with a captured poster still has something to draw.
  assert.equal(
    homeAdImageUrl(
      card({
        id: "poster",
        media: [{ kind: "video", url: "https://cdn.example/ad.mp4", posterUrl: "https://cdn.example/poster.jpg" }],
      }),
    ),
    "https://cdn.example/poster.jpg",
  );
});

test("a card with a picture and a headline is shown ahead of one without", () => {
  const ads = selectHomeLocalAds([
    card({ id: "bare", pageName: "Bare Realty", headline: null }),
    card({
      id: "pictured",
      pageName: "Pictured Realty",
      media: [{ kind: "image", url: "https://cdn.example/ad.jpg", posterUrl: null }],
    }),
  ]);

  assert.deepEqual(
    ads.map((ad) => ad.id),
    ["pictured", "bare"],
  );
  assert.equal(ads[0]?.imageUrl, "https://cdn.example/ad.jpg");
  assert.equal(ads[1]?.imageUrl, null);
});

test("the radar's own order is kept between cards that present equally well", () => {
  const ads = selectHomeLocalAds([
    card({ id: "newest", pageName: "First Realty" }),
    card({ id: "older", pageName: "Second Realty" }),
  ]);

  assert.deepEqual(
    ads.map((ad) => ad.id),
    ["newest", "older"],
  );
});

test("one advertiser does not fill the list before another is shown", () => {
  const ads = selectHomeLocalAds([
    card({ id: "a1", pageName: "Repeat Realty" }),
    card({ id: "a2", pageName: "Repeat Realty" }),
    card({ id: "a3", pageName: "Repeat Realty" }),
    card({ id: "b1", pageName: "Other Realty" }),
  ]);

  assert.deepEqual(
    ads.map((ad) => ad.id),
    ["a1", "b1", "a2", "a3"],
  );
});

test("Home shows at most four rows and never invents one", () => {
  const many = Array.from({ length: 9 }, (_, index) =>
    card({ id: `ad-${index}`, pageName: `Agency ${index}` }),
  );
  assert.equal(selectHomeLocalAds(many).length, 4);

  const two = selectHomeLocalAds([
    card({ id: "one", pageName: "One Realty" }),
    card({ id: "two", pageName: "Two Realty" }),
  ]);
  assert.equal(two.length, 2);
});
