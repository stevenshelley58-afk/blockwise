import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { mapAdDbRowToCustomerMetaCard } from "../src/lib/research/ad-db-card-mapper.ts";
import {
  AdDbConfigurationError,
  fetchAdDbMedia,
  searchAdDbAds,
} from "../src/lib/research/ad-db-client.ts";
import type { AdDbRow } from "../src/lib/research/ad-db.ts";

const ENV = {
  AD_DB_API_URL: "http://hermes.internal:9119",
  AD_DB_READ_TOKEN: "scoped-read-token",
};

test("Ad DB client uses the scoped GET-only header and canonical search parameters", async () => {
  let calledUrl = "";
  let calledInit: RequestInit | undefined;
  const result = await searchAdDbAds(
    {
      query: "local homes",
      agentName: "Grace",
      agencyName: "Harbour",
      limit: 60,
    },
    {
      env: ENV,
      fetcher: async (input, init) => {
        calledUrl = String(input);
        calledInit = init;
        return Response.json({
          items: [row()],
          page: { nextCursor: null, limit: 60 },
        });
      },
    },
  );

  const url = new URL(calledUrl);
  assert.equal(url.pathname, "/v1/ad-db/ads");
  assert.equal(url.searchParams.get("q"), "local homes");
  assert.equal(url.searchParams.get("agentName"), "Grace");
  assert.equal(url.searchParams.get("agencyName"), "Harbour");
  assert.equal(url.searchParams.get("limit"), "60");
  const headers = new Headers(calledInit?.headers);
  assert.equal(headers.get("x-hermes-ad-db-read-token"), "scoped-read-token");
  assert.equal(headers.has("authorization"), false);
  assert.equal(calledInit?.method, "GET");
  assert.equal(result.items.length, 1);
});

test("Ad DB client never follows redirects with the scoped token", async () => {
  let calls = 0;
  await assert.rejects(
    searchAdDbAds(
      { query: "homes" },
      {
        env: ENV,
        fetcher: async (_input, init) => {
          calls += 1;
          assert.equal(init?.redirect, "manual");
          return new Response(null, {
            status: 307,
            headers: { location: "https://attacker.example/collect" },
          });
        },
      },
    ),
    /Ad DB API request failed/u,
  );
  assert.equal(calls, 1);
});

test("Ad DB client fails closed when dedicated configuration is absent", async () => {
  await assert.rejects(
    searchAdDbAds({ query: "homes" }, { env: {} }),
    AdDbConfigurationError,
  );
});

test("media client forwards Range using the scoped read token", async () => {
  let calledUrl = "";
  let calledInit: RequestInit | undefined;
  const response = await fetchAdDbMedia(
    "a7000000-0000-4000-8000-000000000007",
    "a8000000-0000-4000-8000-000000000008",
    { method: "GET", range: "bytes=0-99", ifRange: '"archive-etag"' },
    {
      env: ENV,
      fetcher: async (input, init) => {
        calledUrl = String(input);
        calledInit = init;
        return new Response(new Uint8Array([1, 2]), { status: 206 });
      },
    },
  );

  assert.match(
    calledUrl,
    /\/v1\/ad-db\/ads\/a7000000-0000-4000-8000-000000000007\/media\/a8000000-0000-4000-8000-000000000008$/u,
  );
  const headers = new Headers(calledInit?.headers);
  assert.equal(headers.get("range"), "bytes=0-99");
  assert.equal(headers.get("if-range"), '"archive-etag"');
  assert.equal(headers.get("x-hermes-ad-db-read-token"), "scoped-read-token");
  assert.equal(response.status, 206);
});

test("canonical rows map to customer cards with only same-origin archived media", () => {
  const card = mapAdDbRowToCustomerMetaCard(row());
  assert.equal(card.agentName, "Grace Agent");
  assert.equal(card.agencyName, "Harbour Agency");
  assert.equal(card.areaMatchType, "copy_mention");
  assert.deepEqual(card.adAreaPostcodes, ["6163", "6164"]);
  assert.deepEqual(card.serviceAreaPostcodes, ["6000"]);
  assert.deepEqual(card.media, [
    {
      id: "a8000000-0000-4000-8000-000000000008",
      kind: "image",
      url: "/api/research/ads/a7000000-0000-4000-8000-000000000007/media/a8000000-0000-4000-8000-000000000008",
      posterUrl: null,
    },
  ]);
  assert.equal(JSON.stringify(card).includes("storageBucket"), false);
  assert.equal(JSON.stringify(card).includes("archiveUrl"), false);
});

test("same-origin media route preserves workspace auth, feature gate, and safe header allowlist", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "src/app/api/research/ads/[adId]/media/[mediaId]/route.ts",
    ),
    "utf8",
  );
  assert.match(source, /featureDisabledResponse\("adRadar"\)/);
  assert.match(source, /requireApiWorkspace\(request, "monitor"\)/);
  assert.match(source, /fetchAdDbMedia\(/);
  assert.match(source, /"content-range"/);
  assert.match(source, /"X-Content-Type-Options": "nosniff"/);
  assert.doesNotMatch(source, /source_url|sourceUrl|storageBucket/);
});

function row(): AdDbRow {
  return {
    id: "a7000000-0000-4000-8000-000000000007",
    library_id: "123456",
    advertiser_page_id: "a6000000-0000-4000-8000-000000000006",
    advertiser_page_meta_id: "998877",
    page_name: "Harbour Page",
    active_status: "active",
    first_seen_at: "2026-09-01T00:00:00Z",
    last_seen_at: "2026-09-05T00:00:00Z",
    last_checked_at: "2026-09-05T00:00:00Z",
    ad_delivery_started_at: "2026-08-01T00:00:00Z",
    ad_delivery_stopped_at: null,
    ad_creation_date: "2026-08-01",
    ad_creative_id: null,
    format: "image",
    headline: "A local home",
    body: "Now selling",
    cta: "Learn more",
    ad_type: "listing",
    primary_intent: "seller",
    classification: { description: "Local campaign" },
    display_state: "displayable",
    ownership: {
      agent: { id: "agent-1", name: "Grace Agent", relationship: "owner" },
      agency: {
        id: "agency-1",
        name: "Harbour Agency",
        relationship: "member_agency",
      },
    },
    locations: [
      {
        id: "location-2",
        postcode: "6164",
        suburb: "South",
        state: "WA",
        relation: "meta_targeting",
      },
      {
        id: "location-1",
        postcode: "6163",
        suburb: "North",
        state: "WA",
        relation: "copy_mention",
      },
      {
        id: "location-3",
        postcode: "6000",
        suburb: "Perth",
        state: "WA",
        relation: "service_area",
      },
    ],
    media: [
      {
        id: "a8000000-0000-4000-8000-000000000008",
        kind: "image",
        storageBucket: "ad-db-archive",
        objectKey: `sha256/${"a".repeat(64)}`,
        sha256: "a".repeat(64),
        byteSize: 50_000,
        mimeType: "image/png",
        width: 1080,
        height: 1080,
      },
      {
        id: "unsafe-source-fallback",
        kind: "image",
        storageBucket: "",
        objectKey: "https://cdn.example/source.jpg",
        sha256: "invalid",
        byteSize: 0,
        mimeType: "",
        width: null,
        height: null,
      },
    ],
  };
}
