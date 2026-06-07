import assert from "node:assert/strict";
import test from "node:test";

import { loadPublicAdRadarCards, toPublicAdRadarCard } from "../src/lib/research/public-ad-radar.ts";
import type { CustomerMetaAdLibraryCard, CustomerMetaAdLibraryCardRow } from "../src/lib/research/customer-meta-card.ts";
import { resolveAdRadarLocationSearch } from "../src/lib/research/ad-radar-location.ts";

test("public Ad Radar card exposes display fields without internal identifiers", () => {
  const publicCard = toPublicAdRadarCard(
    card({
      id: "safe-card-id",
      libraryId: "123456789",
      pageId: "page-123",
      pageUrl: "https://facebook.com/example",
      pageName: "Northstar Realty",
      headline: "Book a local appraisal",
      body: "Thinking of selling in Mount Lawley?",
      destinationUrl: "https://northstar.example/sell",
    }),
    new Date("2026-06-06T00:00:00Z").getTime(),
  );

  assert.equal(publicCard.pageName, "Northstar Realty");
  assert.equal(publicCard.destinationDomain, "northstar.example");
  assert.equal(publicCard.durationLabel, "5 days running");
  assert.deepEqual(publicCard.postcodes, ["6050"]);
  assert.deepEqual(Object.keys(publicCard).filter((key) => /libraryId|pageId|pageUrl/i.test(key)), []);
});

test("public Ad Radar card keeps structured multiple postcode attribution", () => {
  const publicCard = toPublicAdRadarCard(
    card({
      id: "multi-postcode-card",
      postcode: null,
      postcodes: ["6007", "6008", "6007"],
      suburb: "Subiaco",
      headline: "Local property update",
    }),
  );

  assert.equal(publicCard.postcode, "6007");
  assert.deepEqual(publicCard.postcodes, ["6007", "6008"]);
});

test("public Ad Radar card prefers search-relevant postcodes over noisy structured values", () => {
  const locationGuess = resolveAdRadarLocationSearch("6008");
  assert.ok(locationGuess);

  const publicCard = toPublicAdRadarCard(
    card({
      id: "noisy-postcode-card",
      postcode: null,
      postcodes: ["2304", "0433", "6008"],
      suburb: null,
      headline: "JUST LISTED",
    }),
    new Date("2026-06-06T00:00:00Z").getTime(),
    locationGuess,
  );

  assert.equal(publicCard.postcode, "6008");
  assert.deepEqual(publicCard.postcodes, ["6008"]);
});

test("public Ad Radar card derives a postcode from local copy when structured attribution is absent", () => {
  const publicCard = toPublicAdRadarCard(
    card({
      id: "copy-postcode-card",
      postcode: null,
      postcodes: [],
      suburb: null,
      body: "Open home this weekend near Spearwood and the 6166 buyer corridor.",
    }),
  );

  assert.equal(publicCard.postcode, "6166");
  assert.deepEqual(publicCard.postcodes, ["6166"]);
});

test("public Ad Radar card uses the single searched postcode when older rows have no postcode attribution", () => {
  const locationGuess = resolveAdRadarLocationSearch("Spearwood");
  assert.ok(locationGuess);

  const publicCard = toPublicAdRadarCard(
    card({
      id: "area-term-card",
      postcode: null,
      postcodes: [],
      suburb: null,
      body: "Free rental report for Bibra Lake homeowners.",
    }),
    new Date("2026-06-06T00:00:00Z").getTime(),
    locationGuess,
  );

  assert.equal(publicCard.postcode, "6163");
  assert.deepEqual(publicCard.postcodes, ["6163"]);
});

test("public Ad Radar card does not display broad service-area postcodes over direct postcode", () => {
  const locationGuess = resolveAdRadarLocationSearch("6163");
  assert.ok(locationGuess);

  const publicCard = toPublicAdRadarCard(
    card({
      id: "broad-service-area-card",
      postcode: "6164",
      postcodes: ["6163", "6164"],
      suburb: "Beeliar",
      body: "45 Acre Girraween Paradise 5 mins to Coolalinga",
    }),
    new Date("2026-06-06T00:00:00Z").getTime(),
    locationGuess,
  );

  assert.equal(publicCard.postcode, "6164");
  assert.deepEqual(publicCard.postcodes, ["6164"]);
});

test("public Ad Radar loader keeps exact location score ahead of newer broad matches", async () => {
  const response = await loadPublicAdRadarCards(
    fakeSupabaseRows([
      row({
        card_id: "newer-broad",
        page_name: "Omeo Property Group",
        postcode: "6163",
        suburb: "North Coogee",
        body: "Rental demand is changing rapidly across Coogee and surrounding suburbs.",
        last_seen_at: "2026-06-05T00:00:00Z",
      }),
      row({
        card_id: "older-exact",
        page_name: "Local Spearwood Realty",
        postcode: "6163",
        suburb: "Spearwood",
        body: "Local appraisal campaign for Spearwood homeowners.",
        last_seen_at: "2026-06-01T00:00:00Z",
      }),
    ]),
    { location: "Spearwood", limit: 2 },
  );

  assert.deepEqual(
    response.ads.map((ad) => ad.id),
    ["older-exact", "newer-broad"],
  );
});

test("public Ad Radar loader uses longest-running coverage when location is empty", async () => {
  const fake = fakeInspectableSupabaseRows([
    row({
      card_id: "newer-active",
      page_name: "Newer Active Realty",
      active_status: "Active",
      ad_delivery_started_at: "2026-05-01T00:00:00Z",
      last_seen_at: "2026-06-05T00:00:00Z",
    }),
    row({
      card_id: "old-active",
      page_name: "Old Active Realty",
      active_status: "ACTIVE",
      ad_delivery_started_at: "2026-01-01T00:00:00Z",
      last_seen_at: "2026-06-05T00:00:00Z",
    }),
    row({
      card_id: "newest-active",
      page_name: "Newest Active Realty",
      active_status: "active",
      ad_delivery_started_at: "2026-06-01T00:00:00Z",
      last_seen_at: "2026-06-05T00:00:00Z",
    }),
  ]);

  const response = await loadPublicAdRadarCards(fake.client, { location: "", limit: 2, sort: "longest" });

  assert.deepEqual(
    response.ads.map((ad) => ad.id),
    ["old-active", "newer-active"],
  );
  assert.equal(response.location.query, "");
  assert.equal(response.location.label, "Australia");
  assert.equal(response.location.matched, false);
  assert.equal(response.nextCursor, null);

  const firstQuery = fake.queries[0];
  assert.ok(firstQuery);
  assert.deepEqual(firstQuery.callArgs("not"), [["ad_delivery_started_at", "is", null]]);
  assert.deepEqual(firstQuery.callArgs("order"), [["ad_delivery_started_at", { ascending: true }]]);
  assert.deepEqual(firstQuery.callArgs("limit"), [[150]]);
  assert.deepEqual(firstQuery.callArgs("ilike"), [["active_status", "active"]]);
});

function card(input: Partial<CustomerMetaAdLibraryCard> & { id: string }): CustomerMetaAdLibraryCard {
  return {
    id: input.id,
    libraryId: input.libraryId ?? null,
    pageId: input.pageId ?? null,
    pageName: input.pageName ?? "Agency",
    pageUrl: input.pageUrl ?? null,
    pageImageUrl: input.pageImageUrl ?? null,
    activeStatus: input.activeStatus ?? "active",
    startedAt: input.startedAt ?? "2026-06-01T00:00:00Z",
    stoppedAt: input.stoppedAt ?? null,
    lastSeenAt: input.lastSeenAt ?? "2026-06-05T00:00:00Z",
    platforms: input.platforms ?? ["Facebook", "Instagram"],
    postcode: "postcode" in input ? input.postcode ?? null : "6050",
    suburb: "suburb" in input ? input.suburb ?? null : "Mount Lawley",
    state: "state" in input ? input.state ?? null : "WA",
    postcodes: input.postcodes ?? ["6050"],
    headline: input.headline ?? null,
    body: input.body ?? null,
    description: input.description ?? null,
    cta: input.cta ?? "Learn more",
    destinationUrl: input.destinationUrl ?? null,
    media: input.media ?? [],
  };
}

function row(input: Partial<CustomerMetaAdLibraryCardRow> & { card_id: string }): CustomerMetaAdLibraryCardRow {
  return {
    card_id: input.card_id,
    library_id: input.library_id ?? input.card_id,
    page_id: input.page_id ?? null,
    page_name: input.page_name ?? "Agency",
    page_url: input.page_url ?? null,
    page_image_url: input.page_image_url ?? null,
    active_status: input.active_status ?? "active",
    ad_delivery_started_at: input.ad_delivery_started_at ?? null,
    ad_delivery_stopped_at: input.ad_delivery_stopped_at ?? null,
    publisher_platforms: input.publisher_platforms ?? ["facebook"],
    postcode: input.postcode ?? null,
    suburb: input.suburb ?? null,
    state: input.state ?? "WA",
    postcodes: input.postcodes ?? (input.postcode ? [input.postcode] : []),
    headline: input.headline ?? null,
    body: input.body ?? null,
    description: input.description ?? null,
    cta: input.cta ?? null,
    cta_url: input.cta_url ?? null,
    destination_url: input.destination_url ?? null,
    primary_image_url: input.primary_image_url ?? null,
    image_urls: input.image_urls ?? [],
    image_storage_path: input.image_storage_path ?? null,
    video_url: input.video_url ?? null,
    video_storage_path: input.video_storage_path ?? null,
    video_thumbnail_url: input.video_thumbnail_url ?? null,
    media_assets: input.media_assets ?? [],
    last_seen_at: input.last_seen_at ?? null,
  };
}

function fakeSupabaseRows(rows: CustomerMetaAdLibraryCardRow[]) {
  return {
    schema() {
      return this;
    },
    from() {
      return new FakeQuery(rows);
    },
  } as never;
}

function fakeInspectableSupabaseRows(rows: CustomerMetaAdLibraryCardRow[]) {
  const queries: FakeQuery[] = [];
  const client = {
    schema() {
      return this;
    },
    from() {
      const query = new FakeQuery(rows);
      queries.push(query);
      return query;
    },
  } as never;

  return { client, queries };
}

class FakeQuery {
  private readonly rows: CustomerMetaAdLibraryCardRow[];
  private readonly calls: Array<{ method: string; args: unknown[] }> = [];

  constructor(rows: CustomerMetaAdLibraryCardRow[]) {
    this.rows = rows;
  }

  select(...args: unknown[]) { return this.record("select", args); }
  order(...args: unknown[]) { return this.record("order", args); }
  range(...args: unknown[]) { return this.record("range", args); }
  ilike(...args: unknown[]) { return this.record("ilike", args); }
  in(...args: unknown[]) { return this.record("in", args); }
  contains(...args: unknown[]) { return this.record("contains", args); }
  eq(...args: unknown[]) { return this.record("eq", args); }
  not(...args: unknown[]) { return this.record("not", args); }
  limit(...args: unknown[]) { return this.record("limit", args); }

  callArgs(method: string): unknown[][] {
    return this.calls.filter((call) => call.method === method).map((call) => call.args);
  }

  private record(method: string, args: unknown[]) {
    this.calls.push({ method, args });
    return this;
  }

  then(resolve: (value: { data: CustomerMetaAdLibraryCardRow[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
    return Promise.resolve({ data: this.rows, error: null }).then(resolve, reject);
  }
}
