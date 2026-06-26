import assert from "node:assert/strict";
import test from "node:test";

import {
  fallbackPhotoAssetsForTemplate,
  preparePhotoAssetsForTemplate,
  type AdStudioBrandKit,
  type ImageProviderAdapter,
} from "../src/lib/adstudio/index.ts";
import { resolveAdStudioTemplate } from "../src/lib/adstudio/templates.ts";

const brandKit: AdStudioBrandKit = {
  brandKitId: "brand_1",
  workspaceId: "workspace_1",
  source: {
    type: "manual",
    url: "https://example.com",
    lastExtractedAt: "2026-06-20T00:00:00.000Z",
    pagesScanned: [],
  },
  identity: {
    businessName: "Blockwise Realty",
    tradingName: "Blockwise",
    marketCountry: "AU",
    marketRegion: "WA",
    licenceText: null,
  },
  logos: {
    primaryLogoUrl: null,
    darkLogoUrl: null,
    lightLogoUrl: null,
    faviconUrl: null,
  },
  colours: {
    primary: "#14314f",
    secondary: "#f6f1e8",
    accent: "#e7b24b",
    background: "#ffffff",
    text: "#111827",
    confidence: { primary: 1, secondary: 1 },
  },
  typography: {
    headingFont: "Inter",
    bodyFont: "Inter",
    fallbackHeading: "sans-serif",
    fallbackBody: "sans-serif",
  },
  visualStyle: {
    styleTags: ["clean"],
    imageTreatment: "Bright natural real-estate light.",
    layoutDensity: "medium",
    cornerRadius: "small",
  },
  tone: {
    voice: "Practical and local",
    avoid: [],
    preferredPhrases: [],
    sampleCopy: [],
  },
  assets: {
    headshots: [],
    officeImages: [],
    listingImages: [],
    socialProofImages: [],
  },
  contact: {
    phone: null,
    email: null,
    address: null,
    socialLinks: [],
  },
  compliance: {
    disclaimers: [],
    privacyPolicyUrl: null,
    termsUrl: null,
  },
  reviewStatus: "approved",
  lockedFields: [],
};

function createSupabaseStub() {
  const table = {
    select() {
      return table;
    },
    eq() {
      return table;
    },
    maybeSingle: async () => ({ data: null, error: null }),
    upsert: async () => ({ error: null }),
  };

  return {
    from: () => table,
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
      }),
    },
  };
}

test("template photo prep can return immediate fallback assets without provider work", () => {
  const template = resolveAdStudioTemplate("meta_040");

  const assets = fallbackPhotoAssetsForTemplate({
    workspaceId: "workspace_1",
    userId: "user_1",
    brandKit,
    template,
    formats: ["9:16", "4:5", "1:1"],
    sourceImageRef: "/api/adstudio/media?path=workspace_1%2Flisting.png",
    sourceImageForModel: "https://cdn.example.com/listing.png",
    campaign: {
      goal: "seller_leads",
      offerId: "recent_sales_report",
      market: { suburb: "Scarborough", city: "Perth", state: "WA" },
    },
    brief: "good family home",
  });

  for (const format of ["9:16", "4:5", "1:1"] as const) {
    const asset = assets[format]?.primary_photo;
    assert.equal(asset?.assetUrl, "https://cdn.example.com/listing.png");
    assert.equal(asset?.method, "fallback_smart_crop");
    assert.equal(asset?.format, format);
  }
});

test("template photo prep falls back quickly when provider work exceeds the request budget", async () => {
  const template = resolveAdStudioTemplate("meta_040");
  const seenSignals: AbortSignal[] = [];
  const slowProvider: ImageProviderAdapter = {
    providerName: "slow-test-provider",
    providerType: "image_generation",
    capabilities: { imageToImage: true, multiReference: true },
    async generate(input) {
      assert.ok(input.signal, "photo prep requests must carry an abort signal");
      seenSignals.push(input.signal);
      return new Promise<never>((_, reject) => {
        input.signal?.addEventListener(
          "abort",
          () => reject(input.signal?.reason instanceof Error ? input.signal.reason : new Error("aborted")),
          { once: true },
        );
      });
    },
  };

  const startedAt = Date.now();
  const assets = await preparePhotoAssetsForTemplate({
    workspaceId: "workspace_1",
    userId: "user_1",
    brandKit,
    template,
    formats: ["9:16", "4:5", "1:1"],
    sourceImageRef: "/api/adstudio/media?path=workspace_1%2Flisting.png",
    sourceImageForModel: "https://cdn.example.com/listing.png",
    campaign: {
      goal: "seller_leads",
      offerId: "recent_sales_report",
      market: { suburb: "Scarborough", city: "Perth", state: "WA" },
    },
    brief: "good family home",
    supabase: createSupabaseStub(),
    providers: [slowProvider],
    timeoutMs: 5,
  });

  assert.ok(Date.now() - startedAt < 10_000, "fallback should not wait for Vercel's function timeout");
  assert.equal(seenSignals.length, 4);
  assert.ok(seenSignals.every((signal) => signal.aborted), "slow provider calls must be aborted");
  for (const format of ["9:16", "4:5", "1:1"] as const) {
    const asset = assets[format]?.primary_photo;
    assert.equal(asset?.assetUrl, "https://cdn.example.com/listing.png");
    assert.equal(asset?.method, "fallback_smart_crop");
    assert.equal(asset?.format, format);
  }
});
