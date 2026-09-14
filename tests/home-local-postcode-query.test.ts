import assert from "node:assert/strict";
import test from "node:test";

import { loadPublicAdRadarCardsForPostcodes } from "../src/lib/research/public-ad-radar.ts";

function row(id: string, postcode: string | null, adAreaPostcodes: string[], serviceAreaPostcodes: string[] = []) {
  return {
    card_id: id,
    library_id: id,
    page_id: id,
    page_name: `Agency ${id}`,
    page_url: null,
    page_image_url: null,
    active_status: "active",
    ad_delivery_started_at: "2026-09-01T00:00:00.000Z",
    ad_delivery_stopped_at: null,
    publisher_platforms: [],
    postcode,
    suburb: null,
    state: "WA",
    postcodes: adAreaPostcodes,
    headline: "Local campaign",
    body: null,
    description: null,
    cta: null,
    cta_url: null,
    destination_url: null,
    primary_image_url: null,
    image_urls: [],
    image_storage_path: null,
    video_url: null,
    video_storage_path: null,
    video_thumbnail_url: null,
    media_assets: [],
    last_seen_at: id === "nearby" ? "2026-09-14T02:00:00.000Z" : "2026-09-14T01:00:00.000Z",
    area_match_postcode: postcode,
    area_match_suburb: null,
    area_match_state: "WA",
    area_match_type: postcode ? "postcode" : null,
    area_match_confidence: 1,
    ad_area_postcodes: adAreaPostcodes,
    ad_area_suburbs: [],
    service_area_postcodes: serviceAreaPostcodes,
    service_area_suburbs: [],
    ad_type: "image",
  };
}

test("Home postcode loading uses structured ad-area evidence and ranks the selected postcode first", async () => {
  const directRows = [row("exact", "6019", ["6019"]), row("nearby", "6020", ["6020"])];
  const overlapRows = [row("service-only", null, [], ["6019"]), ...directRows];
  const filters: string[] = [];
  const supabase = {
    from() {
      let result = directRows;
      const query = {
        select() { return query; },
        eq() { return query; },
        order() { return query; },
        range() { return query; },
        in(column: string) { filters.push(`in:${column}`); result = directRows; return query; },
        overlaps(column: string) { filters.push(`overlaps:${column}`); result = overlapRows; return query; },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve(resolve({ data: result, error: null })); },
      };
      return query;
    },
  };

  const cards = await loadPublicAdRadarCardsForPostcodes(supabase as never, { postcodes: ["6019", "6020"] });
  assert.deepEqual(filters.sort(), ["in:postcode", "overlaps:ad_area_postcodes"]);
  assert.deepEqual(cards.map((card) => card.id), ["exact", "nearby"]);
  assert.equal(cards.some((card) => card.id === "service-only"), false);
});
