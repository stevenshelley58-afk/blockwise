import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  normalizePropertyAddressPredictions,
  suggestPropertyAddresses,
} from "../src/lib/property-check/address-autocomplete.ts";

test("Property Check normalises Australian Google address predictions", () => {
  const predictions = normalizePropertyAddressPredictions({
    suggestions: [
      {
        placePrediction: {
          placeId: "place_1",
          text: { text: "14 Montague Lane, Southern River WA 6110, Australia" },
          structuredFormat: {
            mainText: { text: "14 Montague Lane" },
            secondaryText: { text: "Southern River WA 6110, Australia" },
          },
        },
      },
    ],
  });

  assert.deepEqual(predictions, [
    {
      placeId: "place_1",
      label: "14 Montague Lane, Southern River WA 6110",
      mainText: "14 Montague Lane",
      secondaryText: "Southern River WA 6110",
    },
  ]);
});

test("Property Check autocomplete restricts Google Places to Australian addresses", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    return new Response(
      JSON.stringify({
        suggestions: [
          {
            placePrediction: {
              placeId: "place_2",
              text: { text: "12 Example Street, Subiaco WA 6008, Australia" },
              structuredFormat: {
                mainText: { text: "12 Example Street" },
                secondaryText: { text: "Subiaco WA 6008, Australia" },
              },
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const result = await suggestPropertyAddresses("12 ex", {
    apiKey: "AIza-real-key",
    fetchImpl: fetchImpl as typeof fetch,
    sessionToken: "session-1",
  });

  assert.equal(result.source, "google");
  assert.equal(result.predictions[0]?.label, "12 Example Street, Subiaco WA 6008");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://places.googleapis.com/v1/places:autocomplete");

  const body = JSON.parse(String(requests[0].init.body));
  assert.deepEqual(body.includedPrimaryTypes, ["street_address", "premise", "subpremise", "route"]);
  assert.deepEqual(body.includedRegionCodes, ["au"]);
  assert.equal(body.languageCode, "en-AU");
  assert.equal(body.sessionToken, "session-1");
});

test("Property Check keeps manual address entry available when Google Places is not configured", async () => {
  let called = false;
  const result = await suggestPropertyAddresses("12 Example Street", {
    apiKey: "",
    fetchImpl: async () => {
      called = true;
      return new Response("{}", { status: 200 });
    },
  });

  assert.equal(called, false);
  assert.deepEqual(result, { predictions: [], source: "none" });
});

test("Property Check address autocomplete is workspace guarded and rate limited", () => {
  const route = readFileSync("src/app/api/property-checks/addresses/autocomplete/route.ts", "utf8");

  assert.match(route, /requireApiWorkspace\(request, "property_check"\)/);
  assert.match(route, /checkRateLimit\(context\.supabase, context\.access\.workspaceId, context\.access\.userId/);
  assert.match(route, /bucket: "property-address-autocomplete"/);
});
