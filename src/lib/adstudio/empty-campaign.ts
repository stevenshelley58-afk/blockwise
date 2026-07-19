import { deterministicUuid } from "./id.ts";
import type { AdStudioBrandKit, AdStudioCampaignPack } from "./types.ts";

export function createEmptyAdStudioCampaignPack(input: {
  workspaceId: string;
  brandKit: AdStudioBrandKit;
}): AdStudioCampaignPack {
  const campaignId = deterministicUuid(`adstudio-empty:${input.workspaceId}:${input.brandKit.brandKitId}`);
  return {
    brandKit: input.brandKit,
    campaign: {
      campaignId,
      workspaceId: input.workspaceId,
      brandKitId: input.brandKit.brandKitId,
      name: "New ad",
      goal: "seller_leads",
      market: {
        country: "AU",
        state: input.brandKit.identity.marketRegion || "WA",
        city: "Perth",
        suburb: "",
      },
      audienceIntent: "",
      offerId: "seller_prep_checklist",
      templateKey: null,
      templateSource: null,
      sourceObservedAdId: null,
      templateSnapshot: null,
      generationQuality: "fast",
      platforms: ["meta"],
      creativeFormats: [],
      status: "draft",
    },
    variants: [],
    creatives: [],
    copyPacks: [],
    compliance: {
      reportId: `compliance_${campaignId}`,
      campaignId,
      status: "needs_review",
      issues: [],
      checkedAt: new Date(0).toISOString(),
    },
  };
}
