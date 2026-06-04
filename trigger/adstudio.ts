import { task } from "@trigger.dev/sdk/v3";

type WorkspacePayload = {
  workspaceId: string;
};

type BrandExtractPayload = WorkspacePayload & {
  websiteUrl: string;
};

type CampaignGeneratePayload = WorkspacePayload & {
  brandKitId: string;
  goal: "seller_leads" | "appraisal_bookings" | "buyer_leads" | "market_update_leads";
  suburb: string;
  offerId: string;
};

type CreativePayload = WorkspacePayload & {
  campaignId: string;
  variantId?: string;
  creativeId?: string;
};

type ExportPayload = WorkspacePayload & {
  campaignId: string;
};

export const extractWebsiteBrand = task({
  id: "brand.extract.website",
  run: async (payload: BrandExtractPayload) => ({
    workspaceId: payload.workspaceId,
    websiteUrl: payload.websiteUrl,
    status: "queued_for_blockwise_api",
  }),
});

export const captureBrandScreenshots = task({
  id: "brand.capture.screenshots",
  run: async (payload: BrandExtractPayload) => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });

    try {
      const viewports = [
        { name: "desktop", width: 1440, height: 1200 },
        { name: "mobile", width: 390, height: 1200 },
      ] as const;
      const screenshots = [];

      for (const viewport of viewports) {
        const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
        await page.goto(payload.websiteUrl, { waitUntil: "networkidle", timeout: 45_000 });
        const bytes = await page.screenshot({ fullPage: true, type: "png" });
        await page.close();
        screenshots.push({
          viewport: viewport.name,
          width: viewport.width,
          height: viewport.height,
          contentType: "image/png",
          dataBase64: bytes.toString("base64"),
        });
      }

      return {
        workspaceId: payload.workspaceId,
        websiteUrl: payload.websiteUrl,
        screenshots,
      };
    } finally {
      await browser.close();
    }
  },
});

export const analyseBrandVisuals = task({
  id: "brand.analyse.visuals",
  run: async (payload: WorkspacePayload) => ({
    workspaceId: payload.workspaceId,
    providerType: "vision_analysis",
    status: "queued_for_provider_adapter",
  }),
});

export const extractBrandAssets = task({
  id: "brand.extract.assets",
  run: async (payload: BrandExtractPayload) => ({
    workspaceId: payload.workspaceId,
    websiteUrl: payload.websiteUrl,
    assets: ["logo", "favicon", "headshots", "listing_images"],
  }),
});

export const generateCampaignStrategy = task({
  id: "campaign.generate.strategy",
  run: async (payload: CampaignGeneratePayload) => ({
    ...payload,
    status: "queued_for_structured_generation",
  }),
});

export const generateCampaignCopy = task({
  id: "campaign.generate.copy",
  run: async (payload: CampaignGeneratePayload) => ({
    ...payload,
    platforms: ["meta", "google_search", "google_pmax", "google_demand_gen"],
  }),
});

export const generateCreativeBackgrounds = task({
  id: "creative.generate.backgrounds",
  run: async (payload: CreativePayload) => ({
    ...payload,
    providerType: "image_generation",
  }),
});

export const generateCreativeLayouts = task({
  id: "creative.generate.layouts",
  run: async (payload: CreativePayload) => ({
    ...payload,
    outputs: ["editable_canvas_objects"],
  }),
});

export const renderCreativeExports = task({
  id: "creative.render.exports",
  run: async (payload: CreativePayload) => ({
    ...payload,
    outputs: ["png", "jpg", "webp"],
  }),
});

export const checkCampaignCompliance = task({
  id: "compliance.check.campaign",
  run: async (payload: ExportPayload) => ({
    ...payload,
    status: "queued_for_policy_rules",
  }),
});

export const checkCreativeCompliance = task({
  id: "compliance.check.creative",
  run: async (payload: CreativePayload) => ({
    ...payload,
    status: "queued_for_policy_rules",
  }),
});

export const createExportPackage = task({
  id: "export.package.create",
  run: async (payload: ExportPayload) => ({
    ...payload,
    status: "queued_for_zip_manifest",
  }),
});

export const prepareMetaPublishPayload = task({
  id: "publish.meta.prepare",
  run: async (payload: ExportPayload) => ({
    ...payload,
    provider: "meta",
    status: "blocked_until_human_approval",
  }),
});

export const prepareGooglePublishPayload = task({
  id: "publish.google.prepare",
  run: async (payload: ExportPayload) => ({
    ...payload,
    provider: "google",
    status: "blocked_until_human_approval",
  }),
});
