import assert from "node:assert/strict";
import test from "node:test";

import {
  normaliseGooglePredictions,
  suggestAdRadarLocations,
} from "../src/lib/research/ad-radar-google-locations.ts";

test("Ad Radar normalises Google Places region predictions for suburb search", () => {
  const predictions = normaliseGooglePredictions({
    suggestions: [
      {
        placePrediction: {
          placeId: "place_1",
          text: { text: "Spearwood WA 6163, Australia" },
          structuredFormat: {
            mainText: { text: "Spearwood WA 6163" },
            secondaryText: { text: "Western Australia, Australia" },
          },
        },
      },
    ],
  });

  assert.deepEqual(predictions, [
    {
      placeId: "place_1",
      label: "Spearwood WA 6163, Australia",
      mainText: "Spearwood WA 6163",
      secondaryText: "Western Australia, Australia",
      searchTerm: "Spearwood WA 6163",
      source: "google",
    },
  ]);
});

test("Ad Radar autocomplete sends a tight Google Places request", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    return new Response(
      JSON.stringify({
        suggestions: [
          {
            placePrediction: {
              placeId: "place_2",
              text: { text: "Subiaco WA 6008, Australia" },
              structuredFormat: {
                mainText: { text: "Subiaco WA 6008" },
                secondaryText: { text: "Western Australia, Australia" },
              },
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const result = await suggestAdRadarLocations("sub", {
    apiKey: "AIza-test-key",
    fetchImpl: fetchImpl as typeof fetch,
    sessionToken: "session-1",
  });

  assert.equal(result.source, "google");
  assert.equal(result.predictions[0]?.searchTerm, "Subiaco WA 6008");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://places.googleapis.com/v1/places:autocomplete");
  assert.equal((requests[0].init.headers as Record<string, string>)["X-Goog-FieldMask"], [
    "suggestions.placePrediction.placeId",
    "suggestions.placePrediction.text.text",
    "suggestions.placePrediction.structuredFormat.mainText.text",
    "suggestions.placePrediction.structuredFormat.secondaryText.text",
  ].join(","));

  const body = JSON.parse(String(requests[0].init.body));
  assert.deepEqual(body.includedPrimaryTypes, ["(regions)"]);
  assert.deepEqual(body.includedRegionCodes, ["au"]);
  assert.equal(body.sessionToken, "session-1");
});

test("Ad Radar autocomplete falls back locally when no Google key is configured", async () => {
  const result = await suggestAdRadarLocations("spear", { apiKey: "" });

  assert.equal(result.source, "local");
  assert.equal(result.predictions[0]?.searchTerm, "Spearwood, WA");
});
