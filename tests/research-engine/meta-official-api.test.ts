import assert from "node:assert/strict";
import test from "node:test";

import { validateOfficialMetaAdLibraryCoverage } from "../../src/lib/research/meta-official-api.ts";

test("official Meta API validation marks AU housing real-estate samples useful", async () => {
  const validation = await validateOfficialMetaAdLibraryCoverage(
    {
      accessToken: "token",
      country: "AU",
      adType: "HOUSING_ADS",
      searchTerms: ["real estate appraisal"],
      limit: 5,
    },
    async (url) => {
      const requestUrl = new URL(typeof url === "string" || url instanceof URL ? url : url.url);
      assert.equal(requestUrl.searchParams.get("ad_type"), "HOUSING_ADS");
      assert.equal(requestUrl.searchParams.get("ad_reached_countries"), "[\"AU\"]");
      assert.equal(requestUrl.searchParams.get("search_terms"), "real estate appraisal");
      assert.equal(requestUrl.searchParams.has("access_token"), true);

      return jsonResponse({
        data: [
          {
            id: "123456789012345",
            page_id: "98765",
            page_name: "Northside Real Estate",
            ad_delivery_start_time: "2026-06-01",
            ad_creative_bodies: ["Book a free property appraisal this week."],
            ad_creative_link_titles: ["What is your home worth?"],
            ad_snapshot_url: "https://www.facebook.com/ads/library/?id=123456789012345",
            publisher_platforms: ["FACEBOOK", "INSTAGRAM"],
          },
        ],
      });
    },
  );

  assert.equal(validation.status, "success");
  assert.equal(validation.usefulForAuRealEstate, true);
  assert.equal(validation.summary.adsReturned, 1);
  assert.equal(validation.sample[0]?.adArchiveID, "123456789012345");
  assert.equal(validation.sample[0]?.snapshot?.body, "Book a free property appraisal this week.");
});

test("official Meta API validation fails closed on empty or failed coverage", async () => {
  const validation = await validateOfficialMetaAdLibraryCoverage(
    {
      accessToken: "token",
      country: "AU",
      adType: "HOUSING_ADS",
      pageIds: ["111"],
      searchTerms: [],
    },
    async () => jsonResponse({ error: { message: "Unsupported request" } }, 400),
  );

  assert.equal(validation.status, "failed");
  assert.equal(validation.usefulForAuRealEstate, false);
  assert.match(validation.error ?? "", /Unsupported request/);
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
