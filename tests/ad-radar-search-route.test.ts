import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const routeSource = readFileSync(
  join(process.cwd(), "src/app/api/research/ads/search/route.ts"),
  "utf8",
);

test("ad search route overfetches, dedupes by card id, then returns at most 50 cards", () => {
  assert.match(routeSource, /const SEARCH_ROW_LIMIT = 200;/);
  assert.match(routeSource, /const SEARCH_RESULT_LIMIT = 50;/);
  assert.match(routeSource, /\.limit\(SEARCH_ROW_LIMIT\)/);
  assert.match(routeSource, /const cardId = row\.card_id\?\.trim\(\);/);

  const dedupeIndex = routeSource.indexOf("dedupeRowsByCardId((data ?? [])");
  const sliceIndex = routeSource.indexOf(".slice(0, SEARCH_RESULT_LIMIT)");
  const normaliseIndex = routeSource.indexOf(".map(normaliseCustomerMetaAdLibraryCard)");

  assert.ok(dedupeIndex >= 0, "search rows must be deduped before response mapping");
  assert.ok(sliceIndex > dedupeIndex, "search rows must be capped after dedupe");
  assert.ok(normaliseIndex > sliceIndex, "search rows must be normalised after dedupe and cap");
});
