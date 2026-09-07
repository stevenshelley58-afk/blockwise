import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { mapAdDbRowToCustomerMetaCard } from "../src/lib/research/ad-db-card-mapper.ts";
import type { AdDbRow } from "../src/lib/research/ad-db.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("customer Ad Radar reads canonical Hermes data and never falls back to the duplicate card view", async () => {
  const paths = [
    "src/lib/research/customer-ad-library-pages.ts",
    "src/app/api/research/swipe-file/route.ts",
    "src/app/api/research/advertisers/autocomplete/route.ts",
    "src/app/(customer)/ad-radar/ads/[id]/page.tsx",
    "src/app/(customer)/ad-radar/advertisers/[id]/page.tsx",
    "src/app/(customer)/ad-radar/swipe-file/page.tsx",
  ];
  const sources = await Promise.all(paths.map(read));
  const customerSources = sources.join("\n");

  assert.match(customerSources, /fetchAdDbAd/);
  assert.match(customerSources, /searchAdDbAds/);
  assert.match(customerSources, /loadCanonicalAdvertiserSuggestions/);
  assert.doesNotMatch(customerSources, /CUSTOMER_RESEARCH_AD_HISTORY_VIEW|RESEARCH_AD_SELECT/);
  assert.doesNotMatch(customerSources, /customer_ad_radar_cards|customer_ad_radar_creative_versions/);
  assert.doesNotMatch(customerSources, /source_ad_creative_id/);
});


test("customer card mapping drops private ownership and remote media fields", () => {
  const card = mapAdDbRowToCustomerMetaCard({
    id: "ad-1",
    advertiser_page_id: "page-1",
    page_name: "Example page",
    active_status: "active",
    ownership: {
      agent: { id: "agent-1", name: "Example agent", email: "private@example.test", phone: "+61000000000" },
      private_contact: "do-not-expose",
    },
    media: [{
      id: "asset-1",
      storageBucket: "research-ad-creatives",
      objectKey: "sha256/" + "a".repeat(64),
      sha256: "a".repeat(64),
      byteSize: 4,
      mimeType: "image/jpeg",
      kind: "image",
    }],
  } as unknown as AdDbRow);

  const serialised = JSON.stringify(card);
  assert.equal(card.agentName, "Example agent");
  assert.equal(serialised.includes("private@example.test"), false);
  assert.equal(serialised.includes("do-not-expose"), false);
  assert.equal(serialised.includes("research-ad-creatives"), false);
});

test("customer Ad Radar media remains same-origin and archive-verified", async () => {
  const [mapper, mediaRoute] = await Promise.all([
    read("src/lib/research/ad-db-card-mapper.ts"),
    read("src/app/api/research/ads/[adId]/media/[mediaId]/route.ts"),
  ]);
  assert.match(mapper, /objectKey.*sha256/);
  assert.match(mapper, /\/api\/research\/ads/);
  assert.doesNotMatch(mapper, /sourceUrl|source_url|NEXT_PUBLIC_RESEARCH_STORAGE_URL/);
  assert.match(mediaRoute, /requireApiWorkspace\(request, "monitor"\)/);
  assert.match(mediaRoute, /fetchAdDbMedia/);
});
