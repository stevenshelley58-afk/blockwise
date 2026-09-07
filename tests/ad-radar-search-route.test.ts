import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

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
