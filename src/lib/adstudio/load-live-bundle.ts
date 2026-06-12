import type { createSupabaseServerClient } from "@/lib/supabase/server";

import { generateAdStudioCampaignPack, listOfferTemplates } from "./index.ts";
import { applyBrandAssetRows, loadAdStudioBrandAssetRows } from "./assets.ts";
import { isExampleBrandKitSourceUrl, persistAdStudioCampaignPack, rowToBrandKit, rowToCampaignPack } from "./persistence.ts";
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
  userId?: string,
): Promise<AdStudioBundle | null> {
  if (!workspaceId) return null;

  try {
    const offers = listOfferTemplates();

    const campaignQuery = supabase.from("adstudio_campaigns").select("*").eq("workspace_id", workspaceId);
    const { data: campaigns } = requestedCampaignId
      ? await campaignQuery.eq("id", requestedCampaignId).limit(1)
      : await campaignQuery.order("created_at", { ascending: false }).limit(10);

    for (const latestCampaign of campaigns ?? []) {
      if (String(latestCampaign.status ?? "") === "archived") continue;

      const campaignId = String(latestCampaign.id);
      const [brandKitRow, variants, creatives, copy, compliance] = await Promise.all([
        supabase
          .from("adstudio_brand_kits")
          .select("*")
          .eq("workspace_id", workspaceId)
          .eq("id", String(latestCampaign.brand_kit_id))
          .maybeSingle(),
        supabase.from("adstudio_campaign_variants").select("*").eq("workspace_id", workspaceId).eq("campaign_id", campaignId),
        supabase.from("adstudio_creatives").select("*").eq("workspace_id", workspaceId).eq("campaign_id", campaignId),
        supabase.from("adstudio_platform_copy").select("*").eq("workspace_id", workspaceId).eq("campaign_id", campaignId),
        supabase
          .from("adstudio_compliance_reports")
          .select("*")
          .eq("workspace_id", workspaceId)
          .eq("campaign_id", campaignId)
          .order("checked_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (brandKitRow.data) {
        const brandKit = applyBrandAssetRows(
          rowToBrandKit(brandKitRow.data),
          await loadAdStudioBrandAssetRows(supabase, workspaceId, String(latestCampaign.brand_kit_id)),
        );
        if (isExampleBrandKitSourceUrl(brandKit.source.url)) continue;

        const campaignPack = rowToCampaignPack({
          brandKit,
          campaign: latestCampaign,
          variants: variants.data ?? [],
          creatives: creatives.data ?? [],
          copy: copy.data ?? [],
          compliance: compliance.data ?? null,
        });

        // A reconstructed pack must have at least one variant + copy pack to render.
        if (campaignPack.variants.length > 0 && campaignPack.copyPacks.length > 0) {
          return { brandKit, campaignPack, offers, performance: EMPTY_PERFORMANCE, isLive: true };
        }
      }
    }

    // No usable campaign - try to seed from the workspace's most recent approved non-demo brand kit.
    const { data: brandKitRows } = await supabase
      .from("adstudio_brand_kits")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("review_status", "approved")
      .order("updated_at", { ascending: false })
      .limit(10);

    const nonDemoRows = (brandKitRows ?? []).filter((row) => !isExampleBrandKitSourceUrl(String(row.source_url ?? "")));
    const latestBrandKitRow = nonDemoRows.find((row) => String(row.source_url ?? "").trim()) ?? nonDemoRows[0];

    if (latestBrandKitRow) {
      const brandKit = applyBrandAssetRows(
        rowToBrandKit(latestBrandKitRow),
        await loadAdStudioBrandAssetRows(supabase, workspaceId, String(latestBrandKitRow.id)),
      );
      const campaignPack = generateAdStudioCampaignPack({
        workspaceId,
        brandKit: { ...brandKit, reviewStatus: "approved" },
        goal: "seller_leads",
        suburb: "Scarborough",
        city: "Perth",
        state: brandKit.identity.marketRegion ?? "WA",
        offerId: offers[0]?.offerId ?? "seller_prep_checklist",
        platforms: ["meta"],
        variantCount: 5,
      });
      if (userId) {
        await persistAdStudioCampaignPack(supabase, campaignPack, userId).catch(() => null);
      }

      return { brandKit, campaignPack, offers, performance: EMPTY_PERFORMANCE, isLive: true };
    }

    return null;
  } catch {
    return null;
  }
}
