import assert from "node:assert/strict";
import test from "node:test";

import { computeDrainOverview, normaliseDrainAdPreview, type DrainStage } from "../../src/lib/research/drain-status.ts";

function stage(overrides: Partial<DrainStage>): DrainStage {
  return {
    key: "blockwise-page-resolver",
    label: "Page resolver",
    live: { pending: 0, claimed: 0, failed: 0, blocked: 0 },
    firstFill: { pending: 0, claimed: 0, failed: 0, blocked: 0, complete: 0 },
    completedLastHour: 0,
    firstFillCompletedLastHour: 0,
    ...overrides,
  };
}

test("computeDrainOverview reports original first-fill progress and ETA", () => {
  const overview = computeDrainOverview([
    stage({
      live: { pending: 15, claimed: 5, failed: 0, blocked: 0 },
      firstFill: { pending: 10, claimed: 5, failed: 0, blocked: 0, complete: 85 },
      firstFillCompletedLastHour: 30,
    }),
  ]);

  assert.equal(overview.firstFillOpen, 15);
  assert.equal(overview.liveOpen, 20);
  assert.equal(overview.firstFillPercent, 85);
  assert.equal(overview.etaMinutes, 30);
  assert.equal(overview.readyForMaintain, false);
  assert.equal(overview.status, "draining");
});

test("computeDrainOverview distinguishes first-fill done from live maintain work", () => {
  const overview = computeDrainOverview([
    stage({
      live: { pending: 7, claimed: 0, failed: 0, blocked: 0 },
      firstFill: { pending: 0, claimed: 0, failed: 0, blocked: 0, complete: 100 },
    }),
  ]);

  assert.equal(overview.firstFillReady, true);
  assert.equal(overview.readyForMaintain, false);
  assert.equal(overview.status, "first_fill_done");
});

test("computeDrainOverview marks maintain-ready when the live gate is zero", () => {
  const overview = computeDrainOverview([
    stage({ firstFill: { pending: 0, claimed: 0, failed: 0, blocked: 0, complete: 10 } }),
  ]);

  assert.equal(overview.readyForMaintain, true);
  assert.equal(overview.status, "ready");
});

test("normaliseDrainAdPreview preserves thumbnail-ready media and display fields", () => {
  const preview = normaliseDrainAdPreview({
    card_id: "card_1",
    library_id: "lib_1",
    page_id: "page_1",
    page_name: "Example Realty",
    page_url: "https://facebook.com/example",
    page_image_url: null,
    active_status: "active",
    ad_delivery_started_at: "2026-06-01T00:00:00Z",
    ad_delivery_stopped_at: null,
    publisher_platforms: ["facebook", "instagram"],
    postcode: "6000",
    suburb: "Perth",
    state: "WA",
    postcodes: ["6000"],
    headline: "Fresh listing",
    body: "A polished property ad body.",
    description: null,
    cta: "Learn More",
    cta_url: null,
    destination_url: "https://example.com/listing",
    primary_image_url: null,
    image_urls: null,
    image_storage_path: null,
    video_url: null,
    video_storage_path: null,
    video_thumbnail_url: null,
    media_assets: [
      {
        kind: "video",
        url: "https://cdn.example.com/ad.mp4",
        posterUrl: "https://cdn.example.com/ad.jpg",
      },
    ],
    last_seen_at: "2026-06-20T00:00:00Z",
  });

  assert.equal(preview.id, "card_1");
  assert.equal(preview.pageName, "Example Realty");
  assert.equal(preview.destinationDomain, "example.com");
  assert.deepEqual(preview.platforms, ["Facebook", "Instagram"]);
  assert.deepEqual(preview.media, [
    {
      kind: "video",
      url: "https://cdn.example.com/ad.mp4",
      posterUrl: "https://cdn.example.com/ad.jpg",
    },
  ]);
});
