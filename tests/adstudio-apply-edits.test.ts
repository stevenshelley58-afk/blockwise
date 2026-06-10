import assert from "node:assert/strict";
import test from "node:test";

import {
  applyEditsToPack,
  goalFromLabel,
  normaliseDestinationUrl,
  offerIdFromLabel,
  parseMarket,
} from "../src/lib/adstudio/apply-edits-to-pack.ts";
import { generateAdStudioCampaignPack } from "../src/lib/adstudio/index.ts";
import type { AdStudioBrandKit } from "../src/lib/adstudio/types.ts";

function makeKit(): AdStudioBrandKit {
  return {
    brandKitId: "kit-1",
    workspaceId: "ws-1",
    reviewStatus: "approved",
    source: { url: "https://example.com" },
    identity: { businessName: "Acme", tradingName: "Acme Realty" },
    contact: { phone: "(08) 9999 0000" },
    colours: { primary: "#000000", secondary: "#111111", accent: "#222222", background: "#ffffff", text: "#000000" },
    typography: { headingFont: "Inter", bodyFont: "Inter" },
    tone: { voice: "Direct.", preferredPhrases: [], avoid: [] },
    visualStyle: { styleTags: [], imageTreatment: "natural" },
    logos: { primaryLogoUrl: null },
    assets: { listingImages: [], officeImages: [], headshots: [] },
    compliance: { disclaimers: [] },
  } as AdStudioBrandKit;
}

function makePack() {
  return generateAdStudioCampaignPack({
    workspaceId: "ws-1",
    brandKit: makeKit(),
    goal: "seller_leads",
    suburb: "Scarborough",
    city: "Perth",
    state: "WA",
    offerId: "seller_prep_checklist",
    platforms: ["meta"],
    variantCount: 3,
  });
}

test("applyEditsToPack updates the targeted variant's headline, offer, and cta", () => {
  const pack = makePack();
  const variantId = pack.variants[0]!.variantId;
  const next = applyEditsToPack({
    pack,
    variantId,
    copy: { primaryText: "PT", headline: "New headline", description: "New desc", cta: "Sign up" },
    offerLabel: "Free appraisal",
    primaryImage: "https://example.com/photo.jpg",
    campaignGoal: "Get appraisal leads",
    market: "Scarborough, WA",
    offers: pack.campaign.market.country ? [] : [], // offers are not required for the variant mutation
    destinationUrl: "https://example.com/landing",
  });

  const updated = next.variants.find((v) => v.variantId === variantId);
  assert.equal(updated?.headline, "New headline");
  assert.equal(updated?.offer, "Free appraisal");
  assert.equal(updated?.cta, "Sign up");

  // Other variants are unchanged.
  for (const other of next.variants.filter((v) => v.variantId !== variantId)) {
    assert.notEqual(other.headline, "New headline");
  }
});

test("applyEditsToPack does nothing when variantId is undefined", () => {
  const pack = makePack();
  const next = applyEditsToPack({
    pack,
    variantId: undefined,
    copy: { primaryText: "PT", headline: "X", description: "Y", cta: "Z" },
    offerLabel: "O",
    primaryImage: "i",
    campaignGoal: "G",
    market: "M",
    offers: [],
    destinationUrl: "",
  });
  assert.equal(next, pack);
});

test("applyEditsToPack rewrites copyPack fields for the targeted variant only", () => {
  const pack = makePack();
  const variantId = pack.variants[0]!.variantId;
  const next = applyEditsToPack({
    pack,
    variantId,
    copy: { primaryText: "Primary text", headline: "H1", description: "D1", cta: "Learn more" },
    offerLabel: pack.variants[0]!.offer,
    primaryImage: pack.creatives[0]?.canvas.objects.find((o) => o.role === "primary_image")?.content ?? "",
    campaignGoal: "Get appraisal leads",
    market: "Scarborough, WA",
    offers: [],
    destinationUrl: "https://example.com/landing",
  });

  const updatedCopy = next.copyPacks.find((cp) => cp.variantId === variantId);
  assert.equal(updatedCopy?.meta.headlines[0], "H1");
  assert.equal(updatedCopy?.meta.descriptions[0], "D1");
  assert.equal(updatedCopy?.meta.primaryText[0], "Primary text");
  assert.equal(updatedCopy?.landingPage.headline, "H1");

  // The Google copy-pack finalUrls should be set to the destination URL.
  assert.equal(updatedCopy?.googleSearch.finalUrl, "https://example.com/landing");
  assert.equal(updatedCopy?.googlePmax.finalUrl, "https://example.com/landing");
  assert.equal(updatedCopy?.googleDemandGen.finalUrl, "https://example.com/landing");
});

test("applyEditsToPack leaves Google finalUrls untouched when destination is empty", () => {
  const pack = makePack();
  const variantId = pack.variants[0]!.variantId;
  const originalUrl = pack.copyPacks[0]?.googleSearch.finalUrl;
  const next = applyEditsToPack({
    pack,
    variantId,
    copy: { primaryText: "", headline: "H", description: "D", cta: "C" },
    offerLabel: "O",
    primaryImage: "i",
    campaignGoal: "G",
    market: "M",
    offers: [],
    destinationUrl: "",
  });
  const updatedCopy = next.copyPacks.find((cp) => cp.variantId === variantId);
  // If the original had no URL, it stays empty; if it had one, it stays the same.
  assert.equal(updatedCopy?.googleSearch.finalUrl, originalUrl);
});

test("parseMarket splits 'suburb, state' and falls back to the pack's market", () => {
  const pack = makePack();
  const parsed = parseMarket("Fremantle, WA", pack);
  assert.equal(parsed.suburb, "Fremantle");
  assert.equal(parsed.state, "WA");

  const fallback = parseMarket("", pack);
  assert.equal(fallback.suburb, pack.campaign.market.suburb || "South Perth");
  assert.equal(fallback.state, pack.campaign.market.state || "WA");
});

test("normaliseDestinationUrl adds https when missing", () => {
  assert.equal(normaliseDestinationUrl("example.com/landing"), "https://example.com/landing");
  assert.equal(normaliseDestinationUrl("https://example.com/landing"), "https://example.com/landing");
  assert.equal(normaliseDestinationUrl(""), "");
});

test("goalFromLabel maps common labels to AdStudioGoal keys", () => {
  assert.equal(goalFromLabel("Get appraisal leads", "seller_leads"), "appraisal_bookings");
  assert.equal(goalFromLabel("Buyer demand check", "seller_leads"), "buyer_leads");
  assert.equal(goalFromLabel("Drive market report downloads", "seller_leads"), "market_update_leads");
  assert.equal(goalFromLabel("Promote open home", "seller_leads"), "open_home_followup");
  assert.equal(goalFromLabel("Promote recent sale", "seller_leads"), "listing_nurture");
  assert.equal(goalFromLabel("Generate vendor leads", "seller_leads"), "seller_leads");
  assert.equal(goalFromLabel("Something unknown", "seller_leads"), "seller_leads");
});

test("offerIdFromLabel resolves aliases and exact matches", () => {
  const offers = [
    { offerId: "home_value_update", name: "Home value update", defaultCta: "Get the value" },
  ] as never;
  assert.equal(offerIdFromLabel("Free appraisal", offers, "fallback"), "home_value_update");
  assert.equal(offerIdFromLabel("Unknown offer", offers, "fallback"), "fallback");
});
