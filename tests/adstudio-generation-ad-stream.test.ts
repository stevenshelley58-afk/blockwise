import assert from "node:assert/strict";
import test from "node:test";

import {
  appendGenerationAds,
  generationAdLocation,
  generationAdMediaUrl,
  generationAdRadarHref,
} from "../src/components/adstudio/generation-ad-stream-data.ts";
import type { AdStudioBrandKit } from "../src/lib/adstudio/types.ts";
import type { PublicAdRadarCard } from "../src/lib/research/public-ad-radar.ts";

test("generation ads prefer the Brand Pack address and fall back to its market region", () => {
  assert.equal(generationAdLocation(brandKit({ address: "12 West Coast Highway, Scarborough WA 6019" })), "12 West Coast Highway, Scarborough WA 6019");
  assert.equal(generationAdLocation(brandKit({ address: null, marketRegion: "WA" })), "WA");
});

test("generation ad batches stay deduplicated and bounded", () => {
  const merged = appendGenerationAds([ad("one"), ad("two")], [ad("two"), ad("three"), ad("four")], 3);
  assert.deepEqual(merged.map((item) => item.id), ["one", "two", "three"]);
});

test("generation ad batches drop ads without an image", () => {
  const merged = appendGenerationAds(
    [ad("one")],
    [ad("two", { media: [] }), ad("three", { media: [{ kind: "video", url: "https://cdn.example/video.mp4", posterUrl: null }] }), ad("four")],
  );
  assert.deepEqual(merged.map((item) => item.id), ["one", "four"]);
});

test("generation cards use images before video posters and link to the advertiser search", () => {
  const card = ad("creative", {
    pageName: "West & Co Property",
    media: [
      { kind: "video", url: "https://cdn.example/video.mp4", posterUrl: "https://cdn.example/poster.jpg" },
      { kind: "image", url: "https://cdn.example/image.jpg", posterUrl: null },
    ],
  });

  assert.equal(generationAdMediaUrl(card), "https://cdn.example/image.jpg");
  assert.equal(generationAdRadarHref(card, "Scarborough"), "/ad-radar?q=West%20%26%20Co%20Property");
});

function ad(id: string, patch: Partial<PublicAdRadarCard> = {}): PublicAdRadarCard {
  return {
    id,
    pageName: "Example Property",
    pageImageUrl: null,
    activeStatus: "active",
    startedAt: null,
    stoppedAt: null,
    lastSeenAt: null,
    durationLabel: null,
    platforms: ["Facebook"],
    postcode: null,
    suburb: null,
    state: "WA",
    headline: "Local property update",
    body: null,
    description: null,
    cta: null,
    destinationUrl: null,
    destinationDomain: null,
    adType: null,
    media: [{ kind: "image", url: "https://cdn.example/image.jpg", posterUrl: null }],
    ...patch,
  };
}

function brandKit(input: { address: string | null; marketRegion?: string | null }): AdStudioBrandKit {
  return {
    brandKitId: "brand-kit",
    workspaceId: "workspace",
    source: { type: "manual", url: "https://example.com", lastExtractedAt: "2026-07-22T00:00:00Z", pagesScanned: [] },
    identity: { businessName: "Example", tradingName: null, marketCountry: "AU", marketRegion: input.marketRegion ?? "WA", licenceText: null },
    logos: { primaryLogoUrl: null, darkLogoUrl: null, lightLogoUrl: null, faviconUrl: null },
    colours: { primary: "#111111", secondary: "#222222", accent: "#333333", background: "#ffffff", text: "#111111", confidence: { primary: 1, secondary: 1 } },
    typography: { headingFont: "Inter", bodyFont: "Inter", fallbackHeading: "sans-serif", fallbackBody: "sans-serif" },
    visualStyle: { styleTags: [], imageTreatment: "", layoutDensity: "medium", cornerRadius: "medium" },
    tone: { voice: "clear", avoid: [], preferredPhrases: [], sampleCopy: [] },
    assets: { headshots: [], officeImages: [], listingImages: [], socialProofImages: [] },
    contact: { phone: null, email: null, address: input.address, socialLinks: [] },
    compliance: { disclaimers: [], privacyPolicyUrl: null, termsUrl: null },
    reviewStatus: "approved",
    lockedFields: [],
  };
}

