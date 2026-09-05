import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAdDbSearchParams,
  searchAdDbAds,
} from "../src/lib/research/ad-db-client.ts";

const agentId = "a5000000-0000-4000-8000-000000000005";
const agencyId = "a4000000-0000-4000-8000-000000000004";

test("filter-only search accepts and forwards canonical identity and location filters", async () => {
  const parsed = parseAdDbSearchParams(
    new URLSearchParams({
      agentId,
      agencyId,
      agent: "Grace Agent",
      agency: "Harbour Agency",
      state: "WA",
      suburb: "Perth",
      postcode: "6000",
      locationRelation: "copy_mention",
    }),
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok || !parsed.input) return;
  assert.equal(parsed.input.query, undefined);

  let called = "";
  await searchAdDbAds(parsed.input, {
    env: {
      AD_DB_API_URL: "http://hermes.internal:9119",
      AD_DB_READ_TOKEN: "read-token",
    },
    fetcher: async (input) => {
      called = String(input);
      return Response.json({
        items: [],
        page: { nextCursor: null, limit: 50 },
      });
    },
  });
  const url = new URL(called);
  assert.equal(url.searchParams.has("q"), false);
  assert.equal(url.searchParams.get("agentId"), agentId);
  assert.equal(url.searchParams.get("agencyId"), agencyId);
  assert.equal(url.searchParams.get("agentName"), "Grace Agent");
  assert.equal(url.searchParams.get("agencyName"), "Harbour Agency");
  assert.equal(url.searchParams.get("state"), "WA");
  assert.equal(url.searchParams.get("suburb"), "Perth");
  assert.equal(url.searchParams.get("postcode"), "6000");
  assert.equal(url.searchParams.get("locationRelation"), "copy_mention");
});

test("clear Perth free query uses the existing structured location resolver without inventing a relation", () => {
  const parsed = parseAdDbSearchParams(new URLSearchParams({ q: "Perth" }));
  assert.deepEqual(parsed, {
    ok: true,
    input: { suburb: "Perth" },
  });
});

test("non-location free query remains text search", () => {
  const parsed = parseAdDbSearchParams(
    new URLSearchParams({ q: "seller campaign" }),
  );
  assert.deepEqual(parsed, { ok: true, input: { query: "seller campaign" } });
});

test("empty search is empty but valid filters permit no-query search", () => {
  assert.deepEqual(parseAdDbSearchParams(new URLSearchParams()), {
    ok: true,
    input: null,
  });
  assert.deepEqual(
    parseAdDbSearchParams(new URLSearchParams({ state: "WA" })),
    { ok: true, input: { state: "WA" } },
  );
});

test("canonical IDs, postcode, relation, and unsupported facets fail closed", () => {
  const cases: Array<Record<string, string>> = [
    { agentId: "not-a-uuid" },
    { agencyId: "not-a-uuid" },
    { postcode: "600" },
    { locationRelation: "nearby_market" },
    { status: "active" },
    { sort: "longest" },
  ];
  for (const params of cases) {
    const parsed = parseAdDbSearchParams(new URLSearchParams(params));
    assert.equal(parsed.ok, false, JSON.stringify(params));
  }
});
