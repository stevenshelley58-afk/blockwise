import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  dedupeByArchiveId,
  extractAdNodes,
  findAdLibraryMain,
  parseGraphqlAds,
} from "../../hermes/tools/meta-library-capture/src/graphql.mjs";
import {
  isValidAdArchiveId,
  mapCollatedResultNode,
} from "../../hermes/tools/meta-library-capture/src/map-ad.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, "..", "fixtures", "meta-graphql-search-results.json"), "utf8"),
);

test("findAdLibraryMain locates ad_library_main in a real-shaped GraphQL payload", () => {
  const mains = findAdLibraryMain(fixture);
  assert.equal(mains.length, 1, "expected exactly one ad_library_main node");
  assert.ok(mains[0].search_results_connection, "ad_library_main should expose search_results_connection");
});

test("parseGraphqlAds returns exactly the 2 valid ads and skips bad/missing ids", () => {
  const ads = parseGraphqlAds(fixture);
  assert.equal(ads.length, 2, "only the two valid ad_archive_id nodes should map");

  const ids = ads.map((ad) => ad.adArchiveID);
  assert.deepEqual(ids, ["123456789", "987654321"]);

  for (const ad of ads) {
    assert.match(ad.adArchiveID, /^\d{8,}$/, "adArchiveID must match /^\\d{8,}$/");
    assert.ok(ad.inputUrl.includes(`id=${ad.adArchiveID}`), "inputUrl must point at the ad archive id");
    assert.ok(Array.isArray(ad.snapshot.images), "snapshot.images must be an array");
  }

  // The first ad's image mapping.
  assert.deepEqual(ads[0].snapshot.images, [{ originalImageUrl: "https://img/1.jpg" }]);
  assert.equal(ads[0].isActive, true);
  assert.equal(ads[0].status, "active");
  assert.ok(typeof ads[0].startDate === "string", "start_date epoch seconds must map to an ISO string");

  // The second ad: video + inactive + multi-platform.
  assert.equal(ads[1].isActive, false);
  assert.equal(ads[1].status, "inactive");
  assert.deepEqual(ads[1].publisherPlatform, ["facebook", "instagram"]);
  assert.deepEqual(ads[1].snapshot.videos, [
    { videoHdUrl: "https://vid/2.mp4", videoSdUrl: "https://vid/2-sd.mp4" },
  ]);
});

test("extractAdNodes yields raw nodes (including invalid-id nodes) before mapping", () => {
  const nodes = extractAdNodes(fixture);
  assert.equal(nodes.length, 4, "fixture has 4 collated_result nodes total (2 valid + 2 invalid/missing)");
  assert.equal(nodes.filter((n) => n.ad_archive_id === "bad-id").length, 1, "bad-id node is extracted but...");
});

test("mapCollatedResultNode skips nodes with invalid/missing ad_archive_id", () => {
  const nodes = extractAdNodes(fixture);
  const badId = nodes.find((n) => n.ad_archive_id === "bad-id");
  const missingId = nodes.find((n) => n.page_id === "444");
  assert.ok(badId, "bad-id node present in fixture");
  assert.ok(missingId, "missing-id node present in fixture");

  assert.equal(mapCollatedResultNode(badId), null, "non-numeric ad_archive_id must be skipped");
  assert.equal(mapCollatedResultNode(missingId), null, "missing ad_archive_id must be skipped");
  assert.equal(mapCollatedResultNode(null), null);
  assert.equal(mapCollatedResultNode("nope"), null);
});

test("isValidAdArchiveId accepts 8+ digit ids and rejects everything else", () => {
  assert.ok(isValidAdArchiveId("12345678"));
  assert.ok(isValidAdArchiveId("123456789"));
  assert.ok(isValidAdArchiveId(123456789));
  assert.equal(isValidAdArchiveId("1234567"), false, "7 digits too short");
  assert.equal(isValidAdArchiveId("bad-id"), false);
  assert.equal(isValidAdArchiveId(""), false);
  assert.equal(isValidAdArchiveId(null), false);
  assert.equal(isValidAdArchiveId(undefined), false);
});

test("dedupeByArchiveId collapses duplicates across the run", () => {
  const ads = parseGraphqlAds(fixture);
  // Simulate two intercepted responses carrying the same ads.
  const doubled = [...ads, ...ads];
  assert.equal(doubled.length, 4);
  const deduped = dedupeByArchiveId(doubled);
  assert.equal(deduped.length, 2, "duplicate ad_archive_id entries must collapse");
  assert.deepEqual(deduped.map((a) => a.adArchiveID), ["123456789", "987654321"]);
});
