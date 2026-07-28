import type { createSupabaseServerClient } from "@/lib/supabase/server";

import { createEmptyAdStudioCampaignPack, listOfferTemplates } from "./index.ts";
import { isFinishedCloneCreative } from "./clone-creative.ts";
import { applyBrandAssetRows } from "./assets.ts";
import { isExampleBrandKitSourceUrl, rowToBrandKit, rowToCampaignPack } from "./persistence.ts";
import type { AdStudioBrandKit, AdStudioCampaignPack, AdStudioOfferTemplate } from "./types.ts";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type AdStudioBundle = {
  brandKit: AdStudioBrandKit;
  campaignPack: AdStudioCampaignPack;
  offers: AdStudioOfferTemplate[];
  performance: {
    leads: number;
    costPerLeadAud: number;
    bookedAppraisals: number;
    bestFormat: string;
    recommendations: string[];
  };
  isLive: boolean;
};

const EMPTY_PERFORMANCE = {
  leads: 0,
  costPerLeadAud: 0,
  bookedAppraisals: 0,
  bestFormat: "4:5",
  recommendations: [
    "Generate your first campaign to unlock performance projections.",
    "Approve a brand kit so creative and copy stay on-brand.",
    "Run the compliance check before exporting or publishing.",
  ],
};

/**
 * Load the workspace's real AdStudio data from Supabase.
 *
 * Resolution order:
 *   1. Resume the workspace's most recent saved campaign (full reconstructed pack).
 *   2. If only a brand kit exists, seed a fresh pack from that real brand kit.
 *   3. Otherwise return null so the caller can fall back to the demo starter bundle.
 *
 * Any reconstruction error returns null — the page must never break on load.
 */
export async function loadLiveAdStudioBundle(
  supabase: SupabaseServerClient,
  workspaceId: string,
  requestedCampaignId?: string | null,
): Promise<AdStudioBundle | null> {
  if (!workspaceId) return null;

  try {
    const offers = listOfferTemplates();
    // Wave 1 contains only the essential rows needed to choose a resumable
    // campaign or an approved brand-kit fallback.
    const campaignQuery = supabase.from("adstudio_campaigns").select("*").eq("workspace_id", workspaceId);
    const [campaignResult, approvedBrandKitResult] = await Promise.all([
      requestedCampaignId
        ? campaignQuery.eq("id", requestedCampaignId).limit(1)
        : campaignQuery.order("created_at", { ascending: false }).limit(10),
      supabase
        .from("adstudio_brand_kits")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("review_status", "approved")
        .order("updated_at", { ascending: false })
        .limit(10),
    ]);
    const campaigns = (campaignResult.data ?? []).filter(
      (campaign) => String(campaign.status ?? "") !== "archived",
    );
    const campaignIds = campaigns.map((campaign) => String(campaign.id));
    const brandKitIds = [
      ...new Set([
        ...campaigns.map((campaign) => String(campaign.brand_kit_id ?? "")).filter(Boolean),
        ...(approvedBrandKitResult.data ?? []).map((row) => String(row.id)),
      ]),
    ];

    // Wave 2 bulk-loads every dependent row. No per-campaign or per-image
    // queries are allowed in this path.
    const [brandKitsResult, variantsResult, creativesResult, copyResult, complianceResult, assetsResult] =
      await Promise.all([
        brandKitIds.length
          ? supabase
              .from("adstudio_brand_kits")
              .select("*")
              .eq("workspace_id", workspaceId)
              .in("id", brandKitIds)
          : Promise.resolve({ data: [] }),
        campaignIds.length
          ? supabase
              .from("adstudio_campaign_variants")
              .select("*")
              .eq("workspace_id", workspaceId)
              .in("campaign_id", campaignIds)
          : Promise.resolve({ data: [] }),
        campaignIds.length
          ? supabase
              .from("adstudio_creatives")
              .select("*")
              .eq("workspace_id", workspaceId)
              .in("campaign_id", campaignIds)
          : Promise.resolve({ data: [] }),
        campaignIds.length
          ? supabase
              .from("adstudio_platform_copy")
              .select("*")
              .eq("workspace_id", workspaceId)
              .in("campaign_id", campaignIds)
          : Promise.resolve({ data: [] }),
        campaignIds.length
          ? supabase
              .from("adstudio_compliance_reports")
              .select("*")
              .eq("workspace_id", workspaceId)
              .in("campaign_id", campaignIds)
              .order("checked_at", { ascending: false })
          : Promise.resolve({ data: [] }),
        brandKitIds.length
          ? supabase
              .from("adstudio_brand_assets")
              .select("*")
              .eq("workspace_id", workspaceId)
              .in("brand_kit_id", brandKitIds)
              .order("created_at", { ascending: false })
          : Promise.resolve({ data: [] }),
      ]);
    const brandKitById = new Map(
      (brandKitsResult.data ?? []).map((row) => [String(row.id), row]),
    );
    const rowsForCampaign = (rows: Array<Record<string, unknown>>, campaignId: string) =>
      rows.filter((row) => String(row.campaign_id ?? "") === campaignId);

    for (const latestCampaign of campaigns) {
      if (String(latestCampaign.status ?? "") === "archived") continue;

      const campaignId = String(latestCampaign.id);
      const brandKitRow = brandKitById.get(String(latestCampaign.brand_kit_id));
      if (brandKitRow) {
        const brandKit = applyBrandAssetRows(
          rowToBrandKit(brandKitRow),
          (assetsResult.data ?? []).filter(
            (row) => String(row.brand_kit_id ?? "") === String(latestCampaign.brand_kit_id),
          ),
        );
        if (isExampleBrandKitSourceUrl(brandKit.source.url)) continue;

        const campaignPack = rowToCampaignPack({
          brandKit,
          campaign: latestCampaign,
          variants: rowsForCampaign(variantsResult.data ?? [], campaignId),
          creatives: rowsForCampaign(creativesResult.data ?? [], campaignId),
          copy: rowsForCampaign(copyResult.data ?? [], campaignId),
          compliance: rowsForCampaign(complianceResult.data ?? [], campaignId)[0] ?? null,
        });

        // A reconstructed pack must have at least one variant + copy pack to render.
        if (
          campaignPack.variants.length > 0
          && campaignPack.copyPacks.length > 0
          && campaignPack.creatives.length > 0
          && campaignPack.creatives.every(isFinishedCloneCreative)
        ) {
          return { brandKit, campaignPack, offers, performance: EMPTY_PERFORMANCE, isLive: true };
        }
      }
    }

    // No usable campaign - try to seed from the workspace's most recent approved non-demo brand kit.
    const nonDemoRows = (approvedBrandKitResult.data ?? []).filter((row) => !isExampleBrandKitSourceUrl(String(row.source_url ?? "")));
    const latestBrandKitRow = nonDemoRows.find((row) => String(row.source_url ?? "").trim()) ?? nonDemoRows[0];

    if (latestBrandKitRow) {
      const brandKit = applyBrandAssetRows(
        rowToBrandKit(latestBrandKitRow),
        (assetsResult.data ?? []).filter(
          (row) => String(row.brand_kit_id ?? "") === String(latestBrandKitRow.id),
        ),
      );
      const campaignPack = createEmptyAdStudioCampaignPack({ workspaceId, brandKit });

      return { brandKit, campaignPack, offers, performance: EMPTY_PERFORMANCE, isLive: true };
    }

    return null;
  } catch {
    return null;
  }
}
