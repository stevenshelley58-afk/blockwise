import type {
  AdStudioCampaignPack,
  AdStudioCampaignVariant,
  AdStudioCreative,
  AdStudioPlatformCopyPack,
} from "./types.ts";

export type AdStudioCreativeLibraryItem = {
  campaignId: string;
  variantId: string | null;
  name: string;
  status: "unpublished" | "published";
  updatedAt: string | null;
  previewSrc: string | null;
  format: string | null;
};

export type AdStudioCreativeLibrarySelection = {
  campaignId: string;
  variantId: string;
};

type CampaignRow = {
  id?: unknown;
  name?: unknown;
  status?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
};

type CreativeRow = {
  campaign_id?: unknown;
  variant_id?: unknown;
  format?: unknown;
  canvas_json?: unknown;
  preview_url?: unknown;
  updated_at?: unknown;
};

type PublishPlanRow = {
  adstudio_campaign_id?: unknown;
  status?: unknown;
};

export function buildAdStudioCreativeLibrary(
  campaigns: CampaignRow[],
  creatives: CreativeRow[],
  publishPlans: PublishPlanRow[],
): AdStudioCreativeLibraryItem[] {
  const publishedCampaignIds = new Set(
    publishPlans.flatMap((plan) =>
      plan.status === "paused_live" && typeof plan.adstudio_campaign_id === "string"
        ? [plan.adstudio_campaign_id]
        : [],
    ),
  );

  const previewByCampaign = new Map<string, CreativeRow>();
  for (const creative of creatives) {
    if (typeof creative.campaign_id !== "string") continue;
    const current = previewByCampaign.get(creative.campaign_id);
    if (!current || creativePriority(creative) > creativePriority(current)) {
      previewByCampaign.set(creative.campaign_id, creative);
    }
  }

  return campaigns
    .flatMap((campaign): AdStudioCreativeLibraryItem[] => {
      if (typeof campaign.id !== "string" || campaign.status === "archived") return [];
      const creative = previewByCampaign.get(campaign.id);
      return [{
        campaignId: campaign.id,
        variantId: typeof creative?.variant_id === "string" ? creative.variant_id : null,
        name: typeof campaign.name === "string" && campaign.name.trim() ? campaign.name : "Untitled ad",
        status: publishedCampaignIds.has(campaign.id) ? "published" : "unpublished",
        updatedAt: dateString(campaign.updated_at) ?? dateString(campaign.created_at),
        previewSrc: creativePreviewSource(creative),
        format: typeof creative?.format === "string" ? creative.format : null,
      }];
    })
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "unpublished" ? -1 : 1;
      return timestamp(b.updatedAt) - timestamp(a.updatedAt);
    });
}

/**
 * Builds the publish-only pack for a group of saved ads. The selected source
 * campaigns remain untouched; their finished artwork and copy are combined
 * under the campaign configured in the publish wizard.
 */
export function buildAdStudioLibrarySelectionPack(
  basePack: AdStudioCampaignPack,
  sourcePacks: AdStudioCampaignPack[],
  selections: AdStudioCreativeLibrarySelection[],
): AdStudioCampaignPack {
  const sourceByCampaignId = new Map(sourcePacks.map((pack) => [pack.campaign.campaignId, pack]));
  const variants: AdStudioCampaignVariant[] = [];
  const creatives: AdStudioCreative[] = [];
  const copyPacks: AdStudioPlatformCopyPack[] = [];
  const seenVariantIds = new Set<string>();
  const sharedLeadForm = basePack.copyPacks[0]?.meta.leadForm;

  for (const selection of selections) {
    const source = sourceByCampaignId.get(selection.campaignId);
    const variant = source?.variants.find((item) => item.variantId === selection.variantId);
    const copyPack = source?.copyPacks.find((item) => item.variantId === selection.variantId);
    const creative = preferredCreative(
      source?.creatives.filter((item) => item.variantId === selection.variantId) ?? [],
    );

    if (!source || !variant || !copyPack || !creative) {
      throw new Error("One of the selected ads is no longer available. Refresh the page and choose it again.");
    }
    if (seenVariantIds.has(variant.variantId)) continue;
    seenVariantIds.add(variant.variantId);

    variants.push(variant);
    creatives.push(creative);
    copyPacks.push(sharedLeadForm
      ? {
          ...copyPack,
          meta: {
            ...copyPack.meta,
            leadForm: {
              ...sharedLeadForm,
              questions: [...sharedLeadForm.questions],
              thankYouScreen: { ...sharedLeadForm.thankYouScreen },
            },
          },
        }
      : copyPack);
  }

  if (variants.length !== selections.length) {
    throw new Error("Choose each saved ad only once.");
  }

  const selectedReports = sourcePacks
    .filter((pack) => selections.some((selection) => selection.campaignId === pack.campaign.campaignId))
    .map((pack) => pack.compliance);
  const issues = selectedReports.flatMap((report) => report.issues);
  const complianceStatus = issues.some((issue) => issue.severity === "blocking")
    ? "blocked"
    : issues.length > 0
      ? "needs_review"
      : "approved";

  return {
    ...basePack,
    variants,
    creatives,
    copyPacks,
    compliance: {
      ...basePack.compliance,
      campaignId: basePack.campaign.campaignId,
      status: complianceStatus,
      issues,
      checkedAt: new Date().toISOString(),
    },
  };
}

function creativePriority(creative: CreativeRow): number {
  const hasPreview = creativePreviewSource(creative) ? 10 : 0;
  const preferredFormat = creative.format === "4:5" ? 2 : creative.format === "9:16" ? 1 : 0;
  return hasPreview + preferredFormat + timestamp(dateString(creative.updated_at)) / 1e15;
}

function preferredCreative(creatives: AdStudioCreative[]): AdStudioCreative | null {
  return [...creatives].sort((a, b) => {
    const priority = (format: string) => format === "4:5" ? 2 : format === "9:16" ? 1 : 0;
    return priority(b.format) - priority(a.format);
  })[0] ?? null;
}

function creativePreviewSource(creative: CreativeRow | undefined): string | null {
  if (!creative) return null;
  const canvas = isRecord(creative.canvas_json) ? creative.canvas_json : null;
  const objects = Array.isArray(canvas?.objects) ? canvas.objects : [];
  const primaryImage = objects.find((object) => isRecord(object) && object.role === "primary_image");
  if (isRecord(primaryImage)) {
    const source = stringValue(primaryImage.content) ?? stringValue(primaryImage.assetId);
    if (source) return source;
  }
  return stringValue(creative.preview_url);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function dateString(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function timestamp(value: string | null): number {
  return value ? Date.parse(value) || 0 : 0;
}
