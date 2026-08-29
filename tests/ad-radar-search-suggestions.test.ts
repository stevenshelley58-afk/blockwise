import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { mergeAdRadarSearchSuggestions } from "../src/lib/research/ad-radar-search-suggestions.ts";

test("Ad Radar predictive search combines places and advertisers with clear types", () => {
  const suggestions = mergeAdRadarSearchSuggestions(
    [{
      placeId: "place-1",
      label: "Subiaco WA 6008, Australia",
      mainText: "Subiaco WA 6008",
      secondaryText: "Western Australia, Australia",
      searchTerm: "Subiaco WA 6008",
      source: "google",
    }],
    [{ pageId: "page-1", pageName: "Ray White Subiaco", pageImageUrl: null }],
  );

  assert.deepEqual(suggestions.map(({ kind, mainText, secondaryText }) => ({ kind, mainText, secondaryText })), [
    { kind: "location", mainText: "Subiaco WA 6008", secondaryText: "Western Australia, Australia" },
    { kind: "advertiser", mainText: "Ray White Subiaco", secondaryText: "Agency or agent" },
  ]);
});

test("Ad Radar search suggestion route is public, IP rate-limited, and combines both sources", () => {
  const routeSource = readFileSync(
    join(process.cwd(), "src/app/api/research/ad-radar/suggestions/route.ts"),
    "utf8",
  );

  assert.doesNotMatch(routeSource, /requireApiWorkspace/);
  assert.match(routeSource, /bucket: "ad-radar-suggestions"/);
  assert.match(routeSource, /loadAdvertiserSuggestions/);
  assert.match(routeSource, /suggestAdRadarLocations/);
  assert.match(routeSource, /mergeAdRadarSearchSuggestions/);
});

test("every shared Ad Radar field explains all supported predictive search types", () => {
  const formSource = readFileSync(
    join(process.cwd(), "src/components/research/ad-radar-location-form.tsx"),
    "utf8",
  );

  // The scope sentence is niche copy and now lives in the white-label config;
  // the form reads it from there.
  const adRadarCopy = readFileSync(
    join(process.cwd(), "src/config/niche/blockwise/ad-radar.ts"),
    "utf8",
  );

  assert.match(adRadarCopy, /Predictive search for postcode, suburb, agency or agent/);
  assert.match(formSource, /niche\.copy\.adRadar\.searchScope/);
  assert.match(formSource, /\/api\/research\/ad-radar\/suggestions/);
  assert.match(formSource, /aria-autocomplete="list"/);
});

test("customer-facing ad reports do not disclose the collection source", () => {
  const reportSource = readFileSync(
    join(process.cwd(), "src/app/suburb/[postcode]/report-client.tsx"),
    "utf8",
  );
  const resultsSource = readFileSync(
    join(process.cwd(), "src/components/research/ad-radar-search-panel.tsx"),
    "utf8",
  );
  const auditSource = readFileSync(
    join(process.cwd(), "src/app/audit/page.tsx"),
    "utf8",
  );

  assert.doesNotMatch(`${reportSource}\n${resultsSource}\n${auditSource}`, /Meta Ad Library|Meta pages/i);
});
