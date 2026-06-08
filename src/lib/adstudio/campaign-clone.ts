import { deterministicUuid } from "./id.ts";
import type { AdStudioCampaignPack } from "./types.ts";

export function cloneCampaignPack(
  pack: AdStudioCampaignPack,
  options: { campaignId: string; now: string },
): AdStudioCampaignPack {
  const variantIdByOldId = new Map<string, string>();
  const creativeIdByOldId = new Map<string, string>();
  const copyPackIdByOldId = new Map<string, string>();

  const variants = pack.variants.map((variant, index) => {
    const variantId = deterministicUuid(`${options.campaignId}:variant:${index}:${variant.variantId}`);
    variantIdByOldId.set(variant.variantId, variantId);
    return {
      ...variant,
      variantId,
      campaignId: options.campaignId,
      status: "draft" as const,
    };
  });

  const creatives = pack.creatives.map((creative, index) => {
    const creativeId = deterministicUuid(`${options.campaignId}:creative:${index}:${creative.creativeId}`);
    creativeIdByOldId.set(creative.creativeId, creativeId);
    return {
      ...creative,
      creativeId,
      campaignId: options.campaignId,
      variantId: variantIdByOldId.get(creative.variantId) ?? creative.variantId,
      previewSvg: "",
      canvas: {
        ...creative.canvas,
        fabricJson: null,
      },
    };
  });

  const copyPacks = pack.copyPacks.map((copyPack, index) => {
    const copyPackId = deterministicUuid(`${options.campaignId}:copy:${index}:${copyPack.copyPackId}`);
    copyPackIdByOldId.set(copyPack.copyPackId, copyPackId);
    return {
      ...copyPack,
      copyPackId,
      campaignId: options.campaignId,
      variantId: variantIdByOldId.get(copyPack.variantId) ?? copyPack.variantId,
    };
  });

  return {
    ...pack,
    campaign: {
      ...pack.campaign,
      campaignId: options.campaignId,
      name: `${pack.campaign.name} copy`,
      status: "draft",
    },
    variants,
    creatives,
    copyPacks,
    compliance: {
      ...pack.compliance,
      reportId: deterministicUuid(`${options.campaignId}:compliance:${options.now}`),
      campaignId: options.campaignId,
      status: "needs_review",
      checkedAt: options.now,
    },
  };
}
