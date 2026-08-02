import assert from "node:assert/strict";
import test from "node:test";

import {
  checkMetaConnectionHealth,
  fetchMetaAssetCatalog,
  pickDefaultMetaSetupFromAssets,
  resolveMetaPageAccessToken,
} from "../src/lib/providers/meta-assets.ts";

test("fetchMetaAssetCatalog returns selectable ad accounts, pages, instagram actors, pixels, and lead forms", async () => {
  const requested: string[] = [];
  const fetchImpl = async (url: string | URL | Request) => {
    const value = String(url);
    requested.push(value);

    if (value.includes("/me/adaccounts")) {
      return json({
        data: [
          {
            id: "act_123",
            name: "Northstar Realty",
            currency: "AUD",
            timezone_name: "Australia/Perth",
            account_status: 1,
          },
        ],
      });
    }

    if (value.includes("/me/accounts")) {
      return json({
        data: [
          {
            id: "page_123",
            name: "Northstar Realty Page",
            access_token: "page_token_should_not_escape",
            instagram_business_account: { id: "ig_123", username: "northstarrealty" },
          },
        ],
      });
    }

    if (value.includes("/act_123/adspixels")) {
      return json({ data: [{ id: "pixel_123", name: "Northstar Pixel" }] });
    }

    if (value.includes("/page_123/leadgen_forms")) {
      return json({ data: [{ id: "form_123", name: "Seller appraisal", status: "ACTIVE" }] });
    }

    throw new Error(`Unexpected URL ${value}`);
  };

  const catalog = await fetchMetaAssetCatalog({ accessToken: "token", selectedAdAccountId: "act_123", fetchImpl });

  assert.equal(catalog.adAccounts[0]?.id, "act_123");
  assert.equal(catalog.pages[0]?.id, "page_123");
  assert.equal(catalog.instagramActors[0]?.id, "ig_123");
  assert.equal(catalog.pixels[0]?.id, "pixel_123");
  assert.equal(catalog.leadForms[0]?.id, "form_123");
  assert.equal(JSON.stringify(catalog).includes("page_token_should_not_escape"), false);
  assert.equal(requested.some((url) => url.includes("access_token=token")), true);
});

test("pickDefaultMetaSetupFromAssets fills setup from selected assets without inventing a privacy URL", () => {
  const setup = pickDefaultMetaSetupFromAssets({
    adAccounts: [{ id: "act_123", name: "Northstar", currency: "AUD", timezone: "Australia/Perth", status: "active" }],
    pages: [{ id: "page_123", name: "Northstar Page" }],
    instagramActors: [{ id: "ig_123", username: "northstarrealty", pageId: "page_123" }],
    pixels: [{ id: "pixel_123", name: "Pixel" }],
    leadForms: [{ id: "form_123", name: "Seller form", pageId: "page_123", status: "ACTIVE" }],
  });

  assert.equal(setup.metaAdAccountId, "act_123");
  assert.equal(setup.pageId, "page_123");
  assert.equal(setup.instagramActorId, "ig_123");
  assert.equal(setup.pixelId, "pixel_123");
  assert.equal(setup.currency, "AUD");
  assert.equal(setup.timezone, "Australia/Perth");
  assert.equal(setup.privacyPolicyUrl, "");
});

test("checkMetaConnectionHealth marks expired or rejected Meta tokens as needing reconnect", async () => {
  const expired = await checkMetaConnectionHealth({
    accessToken: "token",
    tokenExpiresAt: "2026-05-27T00:00:00.000Z",
    now: "2026-05-28T00:00:00.000Z",
    fetchImpl: async () => json({ id: "user_123" }),
  });
  const rejected = await checkMetaConnectionHealth({
    accessToken: "token",
    now: "2026-05-28T00:00:00.000Z",
    fetchImpl: async () => json({ error: { message: "Invalid OAuth token" } }, 401),
  });

  assert.equal(expired.status, "needs_reconnect");
  assert.equal(rejected.status, "needs_reconnect");
});

test("resolveMetaPageAccessToken finds the selected Page without persisting or putting credentials in the URL", async () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const token = await resolveMetaPageAccessToken({
    accessToken: "user_token",
    pageId: "page_200",
    fetchImpl: async (input, init) => {
      const url = String(input);
      requests.push({
        url,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      if (!url.includes("after=cursor_1")) {
        return json({
          data: [{ id: "page_100", access_token: "other_page_token" }],
          paging: { cursors: { after: "cursor_1" } },
        });
      }
      return json({ data: [{ id: "page_200", access_token: "selected_page_token" }] });
    },
  });

  assert.equal(token, "selected_page_token");
  assert.equal(requests.length, 2);
  assert.equal(requests.every((request) => request.authorization === "Bearer user_token"), true);
  assert.equal(requests.some((request) => request.url.includes("user_token")), false);
  assert.equal(requests.some((request) => request.url.includes("selected_page_token")), false);
});

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
