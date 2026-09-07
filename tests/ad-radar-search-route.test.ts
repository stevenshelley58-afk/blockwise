import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { searchCustomerMetaAdLibraryCards } from "../src/lib/research/ad-radar-card-search.ts";
import {
  CUSTOMER_META_AD_LIBRARY_CARD_SELECT,
  type CustomerMetaAdLibraryCardRow,
} from "../src/lib/research/customer-meta-card.ts";

const routeSource = readFileSync(
  join(process.cwd(), "src/app/api/research/ads/search/route.ts"),
  "utf8",
);

test("ad search route delegates canonical filter parsing, fetch, and mapping", () => {
  assert.match(routeSource, /parseAdDbSearchParams\(request\.nextUrl\.searchParams\)/);
  assert.match(routeSource, /searchAdDbAds\(\{ \.\.\.parsed\.input, limit: 50 \}\)/);
  assert.match(routeSource, /result\.items\.map\(mapAdDbRowToCustomerMetaCard\)/);
  assert.doesNotMatch(routeSource, /searchCustomerMetaAdLibraryCards\(/);
});

test("ad search route allows filter-only requests and returns parser failures as 400", () => {
  assert.match(routeSource, /if \(!parsed\.ok\)[\s\S]*status: 400/);
  assert.match(routeSource, /if \(!parsed\.input\).*cards: \[\]/);
});

test("ad card search caps returned cards after row overfetch and dedupe", async () => {
  const rows = Array.from({ length: 60 }, (_, index) => row({
    card_id: `library-${index}`,
    library_id: `18805102093009${String(index).padStart(2, "0")}`,
    last_seen_at: `2026-06-${String(Math.max(1, 28 - index)).padStart(2, "0")}T00:00:00Z`,
  }));
  const fake = new FakeSearchClient(rows);

  const cards = await searchCustomerMetaAdLibraryCards(fake.client, {
    query: "1880510209300916",
    sort: "recent",
  });

  assert.equal(cards.length, 50);
  assert.ok(fake.queries.some((query) => query.callArgs("limit").some((args) => args[0] === 200)));
});

test("ad card search uses ranked full-text search when the schema contract is available", async () => {
  const rankedRow = row({ card_id: "ranked-ray-white", page_name: "Ray White Dethridge Groves" });
  const fake = new FakeSearchClient([], { data: [rankedRow], error: null });

  const cards = await searchCustomerMetaAdLibraryCards(fake.client, {
    query: "Ray White",
    sort: "recent",
  });

  assert.deepEqual(cards.map((card) => card.id), ["ranked-ray-white"]);
  assert.deepEqual(fake.rpcCalls, [{
    name: "search_customer_meta_ad_library_cards",
    args: { p_query: "Ray White", p_limit: 200, p_sort: "recent" },
  }]);
  assert.equal(fake.queries.length, 0);
});

test("ad card search pushes facet filters to the database and narrows results", async () => {
  const fake = new FakeSearchClient([
    row({ card_id: "active-listing-video", postcode: "6163", suburb: "Spearwood", active_status: "active", ad_type: "listing", format: "video", agency_name: "Ray White" }),
    row({ card_id: "inactive-listing", postcode: "6163", suburb: "Spearwood", active_status: "inactive", ad_type: "listing", format: "image", agency_name: "Ray White" }),
    row({ card_id: "active-appraisal", postcode: "6163", suburb: "Spearwood", active_status: "active", ad_type: "appraisal", format: "video", agency_name: "Harcourts" }),
  ]);

  const cards = await searchCustomerMetaAdLibraryCards(fake.client, {
    query: "6163",
    sort: "recent",
    filters: { status: "active", adType: "listing", format: "video" },
  });

  assert.deepEqual(cards.map((card) => card.id), ["active-listing-video"]);
  assert.ok(
    fake.queries.some((query) => query.callArgs("eq").some((args) => args[0] === "active_status" && args[1] === "active")),
    "status filter should be pushed to the database",
  );
  assert.ok(
    fake.queries.some((query) => query.callArgs("eq").some((args) => args[0] === "ad_type" && args[1] === "listing")),
    "ad type filter should be pushed to the database",
  );
  assert.ok(
    fake.queries.some((query) => query.callArgs("eq").some((args) => args[0] === "format" && args[1] === "video")),
    "format filter should be pushed to the database",
  );
});

test("ad card fallback search uses strict DB-backed agency attribution fields", async () => {
  const fake = new FakeSearchClient([
    row({
      card_id: "agency-attributed-card",
      agency_id: "agency-1",
      agency_name: "Harbour Lane Property",
      page_name: "Local advertiser page",
      attribution_links: [{ source: "advertiser_page", subject: "agency" }],
    }),
  ]);

  const cards = await searchCustomerMetaAdLibraryCards(fake.client, {
    query: "Harbour Lane",
    sort: "recent",
  });

  assert.deepEqual(cards.map((card) => card.id), ["agency-attributed-card"]);
  assert.equal(cards[0]?.agencyId, "agency-1");
  assert.equal(cards[0]?.agencyName, "Harbour Lane Property");
  assert.deepEqual(cards[0]?.attributionLinks, [{ source: "advertiser_page", subject: "agency" }]);
  assert.ok(CUSTOMER_META_AD_LIBRARY_CARD_SELECT.includes("agency_name"));
  assert.ok(CUSTOMER_META_AD_LIBRARY_CARD_SELECT.includes("attribution_links"));
  assert.ok(
    fake.queries.some((query) => query.callArgs("or").some((args) => String(args[0]).includes("agency_name.ilike.%Harbour Lane%"))),
    "fallback advertiser search should use agency_name from the safe card view",
  );
});

test("ad card fallback search uses strict DB-backed agent attribution fields", async () => {
  const fake = new FakeSearchClient([
    row({
      card_id: "agent-attributed-card",
      agent_id: "agent-1",
      agent_name: "Grace Okafor",
      body: "Local market update.",
      attribution_links: [{ source: "advertiser_page", subject: "agent" }],
    }),
  ]);

  const cards = await searchCustomerMetaAdLibraryCards(fake.client, {
    query: "Grace Okafor",
    sort: "recent",
  });

  assert.deepEqual(cards.map((card) => card.id), ["agent-attributed-card"]);
  assert.equal(cards[0]?.agentId, "agent-1");
  assert.equal(cards[0]?.agentName, "Grace Okafor");
  assert.deepEqual(cards[0]?.attributionLinks, [{ source: "advertiser_page", subject: "agent" }]);
  assert.ok(CUSTOMER_META_AD_LIBRARY_CARD_SELECT.includes("agent_name"));
  assert.ok(
    fake.queries.some((query) => query.callArgs("or").some((args) => String(args[0]).includes("agent_name.ilike.%Grace Okafor%"))),
    "fallback advertiser search should use agent_name from the safe card view, not request-time broad attribution",
  );
});

test("ad card search keeps postcode searches exact unless surrounding suburbs are included", async () => {
  const fake = new FakeSearchClient([
    row({
      card_id: "direct-6166",
      postcode: "6166",
      suburb: "Coogee",
      body: "Fresh appraisal campaign.",
      last_seen_at: "2026-06-05T00:00:00Z",
    }),
    row({
      card_id: "supporting-6166",
      postcode: null,
      ad_area_postcodes: ["6166"],
      body: "Seller lead campaign for the local coastal corridor.",
      last_seen_at: "2026-06-04T00:00:00Z",
    }),
    row({
      card_id: "copy-coogee",
      postcode: null,
      postcodes: [],
      body: "Winter property update for Coogee owners.",
      last_seen_at: "2026-06-03T00:00:00Z",
    }),
  ]);

  const cards = await searchCustomerMetaAdLibraryCards(fake.client, {
    query: "6166",
    sort: "recent",
  });

  assert.deepEqual(cards.map((card) => card.id), ["direct-6166", "supporting-6166"]);
  assert.equal(
    fake.queries.some((query) => query.callArgs("ilike").some((args) => args[0] === "suburb" && args[1] === "Coogee")),
    false,
    "default postcode searches should not fan out into postcode-area suburb rows",
  );
  assert.equal(
    fake.queries.some((query) => query.callArgs("ilike").some((args) => args[0] === "body" && args[1] === "%Coogee%")),
    false,
    "default postcode searches should not fan out into surrounding-suburb copy terms",
  );
});

test("ad card search expands postcode searches when surrounding suburbs are included", async () => {
  const fake = new FakeSearchClient([
    row({
      card_id: "direct-6166",
      postcode: "6166",
      suburb: "Coogee",
      body: "Fresh appraisal campaign.",
      last_seen_at: "2026-06-05T00:00:00Z",
    }),
    row({
      card_id: "supporting-6166",
      postcode: null,
      ad_area_postcodes: ["6166"],
      body: "Seller lead campaign for the local coastal corridor.",
      last_seen_at: "2026-06-04T00:00:00Z",
    }),
    row({
      card_id: "copy-coogee",
      postcode: null,
      postcodes: [],
      body: "Winter property update for Coogee owners.",
      last_seen_at: "2026-06-03T00:00:00Z",
    }),
    row({
      card_id: "broad-service-area",
      postcode: "6210",
      suburb: "Mandurah",
      ad_area_postcodes: ["6210"],
      service_area_postcodes: ["6166", "6210"],
      body: "Luxury homes in Mandurah.",
      last_seen_at: "2026-06-06T00:00:00Z",
    }),
  ]);

  const cards = await searchCustomerMetaAdLibraryCards(fake.client, {
    query: "6166",
    sort: "recent",
    includeSurroundingSuburbs: true,
    resultLimit: 3,
  });

  assert.deepEqual(cards.map((card) => card.id), ["direct-6166", "supporting-6166", "copy-coogee"]);
  assert.equal(fake.rpcCalls.length, 0);
  assert.equal(fake.queries.some((query) => query.callArgs("or").length > 0), false);
  assert.ok(
    fake.queries.some((query) => query.callArgs("in").some((args) => args[0] === "postcode" && sameArray(args[1], ["6166"]))),
    "postcode searches should query direct area-match postcode rows",
  );
  assert.ok(
    fake.queries.some((query) => query.callArgs("overlaps").some((args) => args[0] === "ad_area_postcodes" && sameArray(args[1], ["6166"]))),
    "postcode searches should query explicit ad-area postcode evidence",
  );
  assert.ok(
    fake.queries.some((query) => query.callArgs("ilike").some((args) => args[0] === "suburb" && args[1] === "Coogee")),
    "postcode searches should expand to national postcode suburbs",
  );
  assert.ok(
    fake.queries.some((query) => query.callArgs("ilike").some((args) => args[0] === "body" && args[1] === "%Coogee%")),
    "postcode searches should inspect local ad copy when exact rows do not fill the result window",
  );
});

test("ad card search keeps long numeric Library ID searches on fallback filters", async () => {
  const fake = new FakeSearchClient([
    row({ card_id: "library-match", library_id: "1880510209300916" }),
  ]);

  await searchCustomerMetaAdLibraryCards(fake.client, {
    query: "1880510209300916",
    sort: "recent",
  });

  assert.equal(fake.rpcCalls.length, 0);
  assert.equal(fake.queries.some((query) => query.callArgs("in").length > 0), false);
  assert.equal(fake.queries.some((query) => query.callArgs("overlaps").length > 0), false);
  assert.ok(
    fake.queries.some((query) => query.callArgs("or").some((args) => String(args[0]).includes("library_id.ilike.1880510209300916%"))),
    "long numeric searches should still support Library ID prefix lookup",
  );
});

function row(input: Partial<CustomerMetaAdLibraryCardRow> & { card_id: string }): CustomerMetaAdLibraryCardRow {
  return {
    card_id: input.card_id,
    library_id: input.library_id ?? input.card_id,
    agent_id: input.agent_id ?? null,
    agent_name: input.agent_name ?? null,
    agency_id: input.agency_id ?? null,
    agency_name: input.agency_name ?? null,
    attribution_links: input.attribution_links ?? [],
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
    area_match_postcode: input.area_match_postcode ?? input.postcode ?? null,
    area_match_suburb: input.area_match_suburb ?? input.suburb ?? null,
    area_match_state: input.area_match_state ?? input.state ?? "WA",
    area_match_type: input.area_match_type ?? null,
    area_match_confidence: input.area_match_confidence ?? null,
    ad_area_postcodes: input.ad_area_postcodes ?? (input.postcode ? [input.postcode] : []),
    ad_area_suburbs: input.ad_area_suburbs ?? (input.suburb ? [input.suburb] : []),
    service_area_postcodes: input.service_area_postcodes ?? [],
    service_area_suburbs: input.service_area_suburbs ?? [],
    ad_type: input.ad_type ?? null,
    format: input.format ?? null,
    hooks: input.hooks ?? null,
  };
}

class FakeSearchClient {
  readonly queries: FakeQuery[] = [];
  readonly rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  private readonly rows: CustomerMetaAdLibraryCardRow[];
  private readonly rpcResult?: { data: CustomerMetaAdLibraryCardRow[] | null; error: { code?: string; message: string } | null };
  readonly client = {
    schema: () => this.client,
    from: () => {
      const query = new FakeQuery(this.rows);
      this.queries.push(query);
      return query;
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      this.rpcCalls.push({ name, args });
      return Promise.resolve(this.rpcResult ?? {
        data: null,
        error: { code: "PGRST202", message: "function search_customer_meta_ad_library_cards is missing" },
      });
    },
  };

  constructor(
    rows: CustomerMetaAdLibraryCardRow[],
    rpcResult?: { data: CustomerMetaAdLibraryCardRow[] | null; error: { code?: string; message: string } | null },
  ) {
    this.rows = rows;
    this.rpcResult = rpcResult;
  }
}

class FakeQuery {
  private readonly calls: Array<{ method: string; args: unknown[] }> = [];
  private readonly rows: CustomerMetaAdLibraryCardRow[];

  constructor(rows: CustomerMetaAdLibraryCardRow[]) {
    this.rows = rows;
  }

  select(...args: unknown[]) { return this.record("select", args); }
  order(...args: unknown[]) { return this.record("order", args); }
  limit(...args: unknown[]) { return this.record("limit", args); }
  or(...args: unknown[]) { return this.record("or", args); }
  ilike(...args: unknown[]) { return this.record("ilike", args); }
  eq(...args: unknown[]) { return this.record("eq", args); }
  in(...args: unknown[]) { return this.record("in", args); }
  overlaps(...args: unknown[]) { return this.record("overlaps", args); }

  callArgs(method: string): unknown[][] {
    return this.calls.filter((call) => call.method === method).map((call) => call.args);
  }

  private record(method: string, args: unknown[]) {
    this.calls.push({ method, args });
    return this;
  }

  then(resolve: (value: { data: CustomerMetaAdLibraryCardRow[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
    return Promise.resolve({ data: this.filteredRows(), error: null }).then(resolve, reject);
  }

  private filteredRows(): CustomerMetaAdLibraryCardRow[] {
    let rows = [...this.rows];

    for (const call of this.calls) {
      if (call.method === "in" && call.args[0] === "postcode" && Array.isArray(call.args[1])) {
        const values = new Set(call.args[1].map(String));
        rows = rows.filter((row) => Boolean(row.postcode && values.has(row.postcode)));
      }

      if (call.method === "overlaps" && typeof call.args[0] === "string" && Array.isArray(call.args[1])) {
        const column = call.args[0] as keyof CustomerMetaAdLibraryCardRow;
        const values = new Set(call.args[1].map(String));
        rows = rows.filter((row) => {
          const value = row[column];
          return Array.isArray(value) && value.some((postcode) => values.has(String(postcode)));
        });
      }

      if (call.method === "ilike" && typeof call.args[0] === "string" && typeof call.args[1] === "string") {
        const column = call.args[0] as keyof CustomerMetaAdLibraryCardRow;
        const regex = new RegExp(`^${escapeRegExp(call.args[1]).replace(/%/g, ".*")}$`, "i");
        rows = rows.filter((row) => {
          const value = row[column];
          return typeof value === "string" && regex.test(value);
        });
      }

      if (call.method === "eq" && typeof call.args[0] === "string") {
        const column = call.args[0] as keyof CustomerMetaAdLibraryCardRow;
        rows = rows.filter((row) => row[column] === call.args[1]);
      }
    }

    return rows;
  }
}

function sameArray(value: unknown, expected: string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
