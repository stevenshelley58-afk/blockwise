import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  matchAdRadarCardsForLocation,
  pickAdRadarCardsForLocation,
  resolveAdRadarLocationGuess,
  resolveAdRadarLocationSearch,
  shouldPrioritiseAdRadarLocationSearch,
} from "../src/lib/research/ad-radar-location.ts";
import type { CustomerMetaAdLibraryCard } from "../src/lib/research/customer-meta-card.ts";

type PostcodeSeedRow = { postcode: string; state: string; suburbs: string[] };

const postcodeSeedRows = JSON.parse(
  readFileSync(new URL("../hermes/data/au-postcodes.json", import.meta.url), "utf8"),
) as PostcodeSeedRow[];

test("Ad Radar resolves an Australian city and state from Vercel IP headers", () => {
  const guess = resolveAdRadarLocationGuess(
    headers({
      "x-vercel-ip-country": "AU",
      "x-vercel-ip-country-region": "WA",
      "x-vercel-ip-city": "Perth",
    }),
  );

  assert.equal(guess.source, "ip");
  assert.equal(guess.countryCode, "AU");
  assert.equal(guess.city, "Perth");
  assert.equal(guess.stateCode, "WA");
  assert.equal(guess.label, "Perth, WA");
  assert.deepEqual(guess.terms, ["Perth", "WA", "Western Australia", "6000", "6008"]);
});

test("Ad Radar decodes encoded Vercel city headers", () => {
  const guess = resolveAdRadarLocationGuess(
    headers({
      "x-vercel-ip-country": "AU",
      "x-vercel-ip-country-region": "New%20South%20Wales",
      "x-vercel-ip-city": "Surry%20Hills",
    }),
  );

  assert.equal(guess.source, "ip");
  assert.equal(guess.city, "Surry Hills");
  assert.equal(guess.stateCode, "NSW");
  assert.equal(guess.label, "Surry Hills, NSW");
});

test("Ad Radar falls back to current Perth coverage outside Australia", () => {
  const guess = resolveAdRadarLocationGuess(
    headers({
      "x-vercel-ip-country": "US",
      "x-vercel-ip-country-region": "CA",
      "x-vercel-ip-city": "San%20Francisco",
    }),
  );

  assert.equal(guess.source, "fallback");
  assert.equal(guess.countryCode, "US");
  assert.equal(guess.label, "Perth, WA");
});

test("Ad Radar ranks local cards before unrelated cards", () => {
  const guess = resolveAdRadarLocationGuess(
    headers({
      "x-vercel-ip-country": "AU",
      "x-vercel-ip-country-region": "WA",
      "x-vercel-ip-city": "Perth",
    }),
  );
  const result = pickAdRadarCardsForLocation(
    [
      card({ id: "sydney", state: "NSW", suburb: "Surry Hills", postcode: "2010", lastSeenAt: "2026-06-05T01:00:00Z" }),
      card({ id: "perth", state: "WA", suburb: "Perth", postcode: "6000", lastSeenAt: "2026-06-04T01:00:00Z" }),
      card({ id: "subiaco", state: "WA", suburb: "Subiaco", postcode: "6008", lastSeenAt: "2026-06-03T01:00:00Z" }),
    ],
    guess,
    "recent",
    new Date("2026-06-05T00:00:00Z").getTime(),
  );

  assert.equal(result.matchedLocation, true);
  assert.deepEqual(
    result.cards.map((item) => item.id),
    ["perth", "subiaco"],
  );
});

test("Ad Radar keeps a WA fallback when the guessed market has no coverage", () => {
  const guess = resolveAdRadarLocationGuess(
    headers({
      "x-vercel-ip-country": "AU",
      "x-vercel-ip-country-region": "NT",
      "x-vercel-ip-city": "Darwin",
    }),
  );
  const result = pickAdRadarCardsForLocation(
    [
      card({ id: "wa", state: "WA", suburb: "Subiaco", postcode: "6008", lastSeenAt: "2026-06-04T01:00:00Z" }),
      card({ id: "nsw", state: "NSW", suburb: "Surry Hills", postcode: "2010", lastSeenAt: "2026-06-05T01:00:00Z" }),
    ],
    guess,
    "recent",
  );

  assert.equal(result.matchedLocation, false);
  assert.deepEqual(
    result.cards.map((item) => item.id),
    ["wa"],
  );
});

test("Ad Radar parses Google-style suburb labels into local search terms", () => {
  const guess = resolveAdRadarLocationSearch("Spearwood WA 6163, Australia");

  assert.ok(guess);
  assert.equal(guess.source, "query");
  assert.equal(guess.city, "Spearwood");
  assert.equal(guess.stateCode, "WA");
  assert.equal(guess.label, "Spearwood, WA");
  assert.ok(guess.terms.includes("Spearwood"));
  assert.ok(guess.terms.includes("WA"));
  assert.ok(guess.terms.includes("6163"));
  assert.equal(guess.terms.includes("6166"), false);
});

test("Ad Radar keeps postcode-only search labels specific", () => {
  const guess = resolveAdRadarLocationSearch("6166");

  assert.ok(guess);
  assert.equal(guess.source, "query");
  assert.equal(guess.city, null);
  assert.equal(guess.stateCode, "WA");
  assert.equal(guess.label, "6166, WA");
  assert.ok(guess.terms.includes("6166"));
  assert.ok(guess.terms.includes("Coogee"));
  assert.ok(guess.terms.includes("Lake Coogee"));
  assert.ok(guess.terms.includes("Henderson"));
  assert.equal(guess.terms.includes("6163"), false);
});

test("Ad Radar can keep postcode searches to the exact area when surrounding suburbs are disabled", () => {
  const guess = resolveAdRadarLocationSearch("6166", { includeSurroundingSuburbs: false });

  assert.ok(guess);
  assert.equal(guess.label, "6166, WA");
  assert.ok(guess.terms.includes("6166"));
  assert.equal(guess.terms.includes("Coogee"), false);
  assert.equal(guess.terms.includes("Lake Coogee"), false);
});

test("Ad Radar resolves suburb-only searches from national postcode data", () => {
  const guess = resolveAdRadarLocationSearch("Mount Lawley");

  assert.ok(guess);
  assert.equal(guess.source, "query");
  assert.equal(guess.city, "Mount Lawley");
  assert.equal(guess.stateCode, "WA");
  assert.equal(guess.label, "Mount Lawley, WA");
  assert.ok(guess.terms.includes("6050"));
});

test("Ad Radar prioritises location scoring only for specific location searches", () => {
  const postcodeGuess = resolveAdRadarLocationSearch("6166");
  const suburbGuess = resolveAdRadarLocationSearch("Mount Lawley WA");
  const copyGuess = resolveAdRadarLocationSearch("appraisal");

  assert.equal(shouldPrioritiseAdRadarLocationSearch("6166", postcodeGuess), true);
  assert.equal(shouldPrioritiseAdRadarLocationSearch("Mount Lawley WA", suburbGuess), true);
  assert.equal(shouldPrioritiseAdRadarLocationSearch("appraisal", copyGuess), false);
});

test("Ad Radar expands postcode 6163 to its local suburbs without nearby postcode leakage", () => {
  const guess = resolveAdRadarLocationSearch("6163");

  assert.ok(guess);
  assert.equal(guess.label, "6163, WA");
  assert.ok(guess.terms.includes("Spearwood"));
  assert.ok(guess.terms.includes("Hamilton Hill"));
  assert.ok(guess.terms.includes("North Coogee"));
  assert.ok(guess.terms.includes("6163"));
  assert.equal(guess.terms.includes("6166"), false);
});

test("Ad Radar postcode data does not include corrupted cross-state suburb joins", () => {
  const subiaco = resolveAdRadarLocationSearch("6008");
  const lancelin = resolveAdRadarLocationSearch("6044");
  const forrestfield = resolveAdRadarLocationSearch("6058");

  assert.ok(subiaco);
  assert.ok(subiaco.terms.includes("Daglish"));
  assert.equal(subiaco.terms.includes("Cunjurong Point Daglish"), false);

  assert.ok(lancelin);
  assert.ok(lancelin.terms.includes("Lancelin"));
  assert.ok(lancelin.terms.includes("Nilgen"));
  assert.equal(lancelin.terms.includes("Lake Hume Village Lancelin"), false);
  assert.equal(lancelin.terms.includes("New Lambton Heights Nilgen"), false);

  assert.ok(forrestfield);
  assert.ok(forrestfield.terms.includes("Forrestfield"));
  assert.equal(forrestfield.terms.includes("Flinders University Forrestfield"), false);
});

test("Ad Radar postcode seed rejects embedded state/postcode fragments", () => {
  const corruptedSuburbs = postcodeSeedRows
    .flatMap((row) => row.suburbs.map((suburb) => ({ row, suburb })))
    .filter(({ suburb }) => /\b(?:ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\s+\d{4}\b/u.test(suburb));

  assert.deepEqual(corruptedSuburbs, []);
});

test("Ad Radar matches a selected Google location label to scraped cards", () => {
  const guess = resolveAdRadarLocationSearch("Mount Lawley WA 6050, Australia");
  assert.ok(guess);

  const result = pickAdRadarCardsForLocation(
    [
      card({ id: "cbd", state: "WA", suburb: "Perth", postcode: "6000", lastSeenAt: "2026-06-05T01:00:00Z" }),
      card({ id: "mount-lawley", state: "WA", suburb: "Mount Lawley", postcode: "6050", lastSeenAt: "2026-06-04T01:00:00Z" }),
    ],
    guess,
    "recent",
  );

  assert.equal(result.matchedLocation, true);
  assert.deepEqual(
    result.cards.map((item) => item.id),
    ["mount-lawley"],
  );
});

test("public Ad Radar location matching includes postcode terms inside ad copy", () => {
  const guess = resolveAdRadarLocationSearch("6166");
  assert.ok(guess);

  const result = matchAdRadarCardsForLocation(
    [
      card({
        id: "postcode-copy",
        state: "WA",
        suburb: null,
        postcode: null,
        body: "Open home this weekend near Spearwood and the 6166 buyer corridor.",
        lastSeenAt: "2026-06-05T01:00:00Z",
      }),
      card({
        id: "mount-lawley",
        state: "WA",
        suburb: "Mount Lawley",
        postcode: "6050",
        body: "Perfectly positioned between the peaceful Swan River foreshore.",
        lastSeenAt: "2026-06-04T01:00:00Z",
      }),
    ],
    guess,
    "recent",
  );

  assert.deepEqual(
    result.map((item) => item.id),
    ["postcode-copy"],
  );
});

test("public Ad Radar location matching includes configured postcode-area suburb terms", () => {
  const postcodeGuess = resolveAdRadarLocationSearch("6163");
  const suburbGuess = resolveAdRadarLocationSearch("Spearwood");
  assert.ok(postcodeGuess);
  assert.ok(suburbGuess);

  const cards = [
    card({
      id: "bibra-lake-rental-report",
      state: "WA",
      suburb: null,
      postcode: null,
      body: "Free Digital Rental Report for Success, Atwell and Bibra Lake homeowners.",
      lastSeenAt: "2026-06-05T01:00:00Z",
    }),
    card({
      id: "nearby-6166",
      state: "WA",
      suburb: null,
      postcode: null,
      body: "7 Mykonos Road, Coogee WA 6166 is for sale.",
      lastSeenAt: "2026-06-04T01:00:00Z",
    }),
  ];

  assert.deepEqual(
    matchAdRadarCardsForLocation(cards, postcodeGuess, "recent").map((item) => item.id),
    ["bibra-lake-rental-report"],
  );
  assert.deepEqual(
    matchAdRadarCardsForLocation(cards, suburbGuess, "recent").map((item) => item.id),
    ["bibra-lake-rental-report"],
  );
});

test("public Ad Radar location matching ranks exact searched suburb before related postcode-area suburbs", () => {
  const guess = resolveAdRadarLocationSearch("Spearwood");
  assert.ok(guess);

  const result = matchAdRadarCardsForLocation(
    [
      card({
        id: "related-bibra-lake",
        state: "WA",
        suburb: "Bibra Lake",
        postcode: "6163",
        body: "Free Digital Rental Report for Success, Atwell and Bibra Lake homeowners.",
        lastSeenAt: "2026-06-05T01:00:00Z",
      }),
      card({
        id: "exact-spearwood",
        state: "WA",
        suburb: "Spearwood",
        postcode: "6163",
        body: "Coastal market update for local sellers.",
        lastSeenAt: "2026-06-04T01:00:00Z",
      }),
    ],
    guess,
    "recent",
  );

  assert.deepEqual(
    result.map((item) => item.id),
    ["exact-spearwood", "related-bibra-lake"],
  );
});

test("public Ad Radar location matching does not substitute nearby postcode ads for Spearwood", () => {
  const guess = resolveAdRadarLocationSearch("Spearwood");
  assert.ok(guess);

  const result = matchAdRadarCardsForLocation(
    [
      card({
        id: "nearby-6166",
        state: "WA",
        suburb: null,
        postcode: null,
        body: "7 Mykonos Road, Coogee WA 6166 is for sale.",
        lastSeenAt: "2026-06-05T01:00:00Z",
      }),
      card({
        id: "mount-lawley",
        state: "WA",
        suburb: "Mount Lawley",
        postcode: "6050",
        body: "Perfectly positioned between the peaceful Swan River foreshore.",
        lastSeenAt: "2026-06-04T01:00:00Z",
      }),
    ],
    guess,
    "recent",
  );

  assert.deepEqual(result, []);
});

test("public Ad Radar location matching does not fall back to unrelated WA cards", () => {
  const guess = resolveAdRadarLocationSearch("Spearwood WA 6163, Australia");
  assert.ok(guess);

  const result = matchAdRadarCardsForLocation(
    [
      card({
        id: "mount-lawley",
        state: "WA",
        suburb: "Mount Lawley",
        postcode: "6050",
        body: "Perfectly positioned between the peaceful Swan River foreshore and the vibrant Beaufort Street cafe precinct.",
        lastSeenAt: "2026-06-05T01:00:00Z",
      }),
      card({ id: "subiaco", state: "WA", suburb: "Subiaco", postcode: "6008", body: "A walkable apartment near Rokeby Road.", lastSeenAt: "2026-06-04T01:00:00Z" }),
    ],
    guess,
    "recent",
  );

  assert.deepEqual(result, []);
});

test("public Ad Radar location matching does not treat broad service-area postcodes as exact matches", () => {
  const guess = resolveAdRadarLocationSearch("6163");
  assert.ok(guess);

  const result = matchAdRadarCardsForLocation(
    [
      card({
        id: "broad-service-area",
        state: "WA",
        suburb: "Beeliar",
        postcode: "6164",
        postcodes: ["6163", "6164"],
        body: "45 Acre Girraween Paradise 5 mins to Coolalinga",
        lastSeenAt: "2026-06-05T01:00:00Z",
      }),
      card({
        id: "exact-copy-area",
        state: "WA",
        suburb: "Spearwood",
        postcode: "6163",
        postcodes: ["6163"],
        body: "Local appraisal campaign for Spearwood homeowners.",
        lastSeenAt: "2026-06-04T01:00:00Z",
      }),
    ],
    guess,
    "recent",
  );

  assert.deepEqual(
    result.map((item) => item.id),
    ["exact-copy-area"],
  );
});

function headers(values: Record<string, string>) {
  return {
    get(name: string) {
      return values[name.toLowerCase()] ?? null;
    },
  };
}

function card(input: Partial<CustomerMetaAdLibraryCard> & { id: string }): CustomerMetaAdLibraryCard {
  return {
    id: input.id,
    libraryId: null,
    agentId: input.agentId ?? null,
    agentName: input.agentName ?? null,
    agencyId: input.agencyId ?? null,
    agencyName: input.agencyName ?? null,
    attributionLinks: input.attributionLinks ?? [],
    pageId: null,
    pageName: input.pageName ?? "Agency",
    pageUrl: null,
    pageImageUrl: null,
    activeStatus: "active",
    startedAt: input.startedAt ?? null,
    stoppedAt: input.stoppedAt ?? null,
    lastSeenAt: input.lastSeenAt ?? null,
    platforms: [],
    postcode: input.postcode ?? null,
    suburb: input.suburb ?? null,
    state: input.state ?? null,
    postcodes: input.postcodes ?? (input.postcode ? [input.postcode] : []),
    areaMatchPostcode: input.areaMatchPostcode ?? input.postcode ?? null,
    areaMatchSuburb: input.areaMatchSuburb ?? input.suburb ?? null,
    areaMatchState: input.areaMatchState ?? input.state ?? null,
    areaMatchType: input.areaMatchType ?? null,
    areaMatchConfidence: input.areaMatchConfidence ?? null,
    adAreaPostcodes: input.adAreaPostcodes ?? input.postcodes ?? (input.postcode ? [input.postcode] : []),
    adAreaSuburbs: input.adAreaSuburbs ?? (input.suburb ? [input.suburb] : []),
    serviceAreaPostcodes: input.serviceAreaPostcodes ?? [],
    serviceAreaSuburbs: input.serviceAreaSuburbs ?? [],
    headline: input.headline ?? null,
    body: input.body ?? null,
    description: input.description ?? null,
    cta: null,
    destinationUrl: null,
    media: [],
  };
}
