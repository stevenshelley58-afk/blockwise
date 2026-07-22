export type AdStudioCreativeLibraryItem = {
  campaignId: string;
  name: string;
  status: "unpublished" | "published";
  updatedAt: string | null;
  previewSrc: string | null;
  format: string | null;
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

function creativePriority(creative: CreativeRow): number {
  const hasPreview = creativePreviewSource(creative) ? 10 : 0;
  const preferredFormat = creative.format === "4:5" ? 2 : creative.format === "9:16" ? 1 : 0;
  return hasPreview + preferredFormat + timestamp(dateString(creative.updated_at)) / 1e15;
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
