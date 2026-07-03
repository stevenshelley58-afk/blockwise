import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAdStudioExportPackage,
  extractBrandKitFromWebsite,
  generateAdStudioCampaignPack,
} from "../src/lib/adstudio/index.ts";
import {
  ADVERTISER_DOMAIN_PLACEHOLDER,
  resolveAdvertiserDomain,
} from "../src/lib/adstudio/advertiser-domain.ts";

const textDecoder = new TextDecoder();

function customerBrandKitWithBlockwiseFallbacks() {
  const brandKit = extractBrandKitFromWebsite({
    workspaceId: "workspace_customer_domain",
    websiteUrl: "https://agent.example",
    marketCountry: "AU",
    htmlByUrl: {
      "https://agent.example": "<html><head><title>Coastal Agent</title></head><body></body></html>",
    },
  });

  return {
    ...brandKit,
    source: { ...brandKit.source, url: "https://blockwise.sale" },
    compliance: { ...brandKit.compliance, privacyPolicyUrl: "https://blockwise.sale/privacy", termsUrl: null },
    contact: { ...brandKit.contact, socialLinks: [] },
    reviewStatus: "approved" as const,
  };
}

test("advertiser domain resolution never falls back to Blockwise for customer previews", () => {
  const brandKit = customerBrandKitWithBlockwiseFallbacks();

  assert.deepEqual(resolveAdvertiserDomain({ brandKit }), {
    host: ADVERTISER_DOMAIN_PLACEHOLDER,
    baseUrl: `https://${ADVERTISER_DOMAIN_PLACEHOLDER}`,
    isPlaceholder: true,
    setupNudge: "Add your website in Publish to show the real advertiser domain.",
  });

  const fromCampaignUrl = resolveAdvertiserDomain({
    brandKit,
    finalUrls: ["https://www.coastalagent.com.au/appraisal"],
  });
  assert.equal(fromCampaignUrl.host, "coastalagent.com.au");
  assert.equal(fromCampaignUrl.isPlaceholder, false);
});

test("exported customer copy packs never contain blockwise.sale when brand URLs are missing", async () => {
  const pack = generateAdStudioCampaignPack({
    workspaceId: "workspace_customer_domain",
    brandKit: customerBrandKitWithBlockwiseFallbacks(),
    goal: "seller_leads",
    suburb: "Scarborough",
    city: "Perth",
    state: "WA",
    offerId: "seller_prep_checklist",
    platforms: ["meta", "google_search", "google_pmax", "google_demand_gen"],
    variantCount: 1,
  });
  const exportPackage = await buildAdStudioExportPackage(pack);
  const exportedText = Object.entries(exportPackage.files)
    .filter(([path]) => path.endsWith(".json") || path.endsWith(".csv") || path.endsWith(".txt"))
    .map(([, bytes]) => textDecoder.decode(bytes))
    .join("\n");

  assert.doesNotMatch(JSON.stringify(pack.copyPacks), /blockwise\.sale/i);
  assert.doesNotMatch(exportedText, /blockwise\.sale/i);
  assert.match(JSON.stringify(pack.copyPacks), /yourdomain\.com\.au/);
});
