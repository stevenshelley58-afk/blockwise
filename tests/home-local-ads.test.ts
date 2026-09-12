import assert from "node:assert/strict";
import test from "node:test";

import {
  HOME_LOCAL_AD_CANDIDATES,
  HOME_LOCAL_AD_LIMIT,
  homeAdImageUrl,
  homeLocalAdCandidates,
  toHomeLocalAds,
} from "../src/lib/home/home-local-ads.ts";
import type { PublicAdRadarCard } from "../src/lib/research/public-ad-radar.ts";

/** A card's still. Distinct per id, so a test can kill one and leave the rest. */
const image = (id: string) => [
  { kind: "image" as const, url: `https://cdn.example/${id}.jpg`, posterUrl: null },
];
const VIDEO = [{ kind: "video" as const, url: "https://cdn.example/ad.mp4", posterUrl: null }];

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

/**
 * The composition the loader performs once its thumbnail checks come back: the
 * candidates it asked about, then the rows Home renders from the stills that
 * answered. `verified` defaults to "everything answered".
 */
function rows(cards: PublicAdRadarCard[], verified: (url: string) => boolean = () => true) {
  const candidates = homeLocalAdCandidates(cards);
  return toHomeLocalAds(candidates.filter((candidate) => verified(candidate.imageUrl)));
}

test("the thumbnail is a still image, never a video file", () => {
  // An mp4 handed to an <img> is an unrenderable URL, which is what put broken
  // frames in the row before.
  assert.equal(homeAdImageUrl(card({ id: "video-only", media: VIDEO })), null);

  assert.equal(
    homeAdImageUrl(
      card({
        id: "with-image",
        media: [...VIDEO, { kind: "image", url: "https://cdn.example/ad.jpg", posterUrl: null }],
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

test("an ad with no still to draw is never offered a row", () => {
  // The empty tile these render is what Home looked like before: rows that read
  // as broken ads rather than as a local market.
  const ads = rows([
    card({ id: "no-media", pageName: "Bare Realty", media: [] }),
    card({ id: "video-only", pageName: "Video Realty", media: VIDEO }),
    card({ id: "with-image", pageName: "Pictured Realty", media: image("pictured") }),
  ]);

  assert.deepEqual(
    ads.map((ad) => ad.id),
    ["with-image"],
  );
  assert.equal(ads[0]?.imageUrl, "https://cdn.example/pictured.jpg");
});

test("a card with a headline is shown ahead of one without", () => {
  const ads = rows([
    card({ id: "bare", pageName: "Bare Realty", headline: null, media: image("bare") }),
    card({ id: "titled", pageName: "Titled Realty", media: image("titled") }),
  ]);

  assert.deepEqual(
    ads.map((ad) => ad.id),
    ["titled", "bare"],
  );
});

test("the radar's own order is kept between cards that present equally well", () => {
  const ads = rows([
    card({ id: "newest", pageName: "First Realty", media: image("newest") }),
    card({ id: "older", pageName: "Second Realty", media: image("older") }),
  ]);

  assert.deepEqual(
    ads.map((ad) => ad.id),
    ["newest", "older"],
  );
});

test("one advertiser does not fill the list before another is shown", () => {
  const ads = rows([
    card({ id: "a1", pageName: "Repeat Realty", media: image("a1") }),
    card({ id: "a2", pageName: "Repeat Realty", media: image("a2") }),
    card({ id: "a3", pageName: "Repeat Realty", media: image("a3") }),
    card({ id: "b1", pageName: "Other Realty", media: image("b1") }),
  ]);

  assert.deepEqual(
    ads.map((ad) => ad.id),
    ["a1", "b1", "a2", "a3"],
  );
});

test("Home shows at most four rows and never invents one", () => {
  const many = Array.from({ length: 9 }, (_, index) =>
    card({ id: `ad-${index}`, pageName: `Agency ${index}`, media: image(`ad-${index}`) }),
  );
  assert.equal(rows(many).length, 4);

  const two = rows([
    card({ id: "one", pageName: "One Realty", media: image("one") }),
    card({ id: "two", pageName: "Two Realty", media: image("two") }),
  ]);
  assert.equal(two.length, 2);
});

test("Home checks spares, so one dead thumbnail does not shorten the row", () => {
  const cards = Array.from({ length: 9 }, (_, index) =>
    card({ id: `ad-${index}`, pageName: `Agency ${index}`, media: image(`ad-${index}`) }),
  );
  const candidates = homeLocalAdCandidates(cards);
  assert.equal(candidates.length, HOME_LOCAL_AD_CANDIDATES);

  // The first two stills are dead objects; the four behind them fill the row.
  const dead = new Set(candidates.slice(0, 2).map((candidate) => candidate.imageUrl));
  const ads = rows(cards, (url) => !dead.has(url));

  assert.equal(ads.length, HOME_LOCAL_AD_LIMIT);
  assert.deepEqual(
    ads.map((ad) => ad.id),
    candidates.slice(2, 6).map((candidate) => candidate.card.id),
  );

  // And when nothing answers, Home shows nothing rather than an empty tile.
  assert.deepEqual(rows(cards, () => false), []);
});
