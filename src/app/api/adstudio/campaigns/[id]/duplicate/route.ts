import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { applyBrandAssetRows, loadAdStudioBrandAssetRows } from "@/lib/adstudio/assets";
import { cloneCampaignPack } from "@/lib/adstudio/campaign-clone";
import { requireAdStudioRequest } from "@/lib/adstudio/http";
import {
  persistAdStudioCampaignPack,
  rowToBrandKit,
  rowToCampaignPack,
} from "@/lib/adstudio/persistence";
import type { AdStudioCampaignPack } from "@/lib/adstudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  try {
    const sourcePack = await loadCampaignPack(access.supabase, access.access.workspaceId, id);
    if (!sourcePack) {
      return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
    }

    const campaignId = randomUUID();
    const cloned = cloneCampaignPack(sourcePack, {
      campaignId,
      now: new Date().toISOString(),
    });
    const persisted = await persistAdStudioCampaignPack(access.supabase, cloned, access.access.userId);
    if (persisted.error) {
      return NextResponse.json({ error: persisted.error.message }, { status: 500 });
    }

    const location = `/ad-studio?campaignId=${encodeURIComponent(campaignId)}`;
    return NextResponse.json(
      {
        duplicate: {
          sourceCampaignId: id,
          campaignId,
          status: "created",
          message: "Campaign duplicated.",
          location,
        },
      },
      {
        status: 201,
        headers: { Location: location },
      },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Campaign could not be duplicated." },
      { status: 500 },
    );
  }
}

async function loadCampaignPack(
  supabase: any,
  workspaceId: string,
  campaignId: string,
): Promise<AdStudioCampaignPack | null> {
  const { data: campaign, error: campaignError } = await supabase
    .from("adstudio_campaigns")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", campaignId)
    .maybeSingle();

  if (campaignError) throw new Error(campaignError.message);
  if (!campaign) return null;

  const [brandKitRow, variants, creatives, copy, compliance] = await Promise.all([
    supabase
      .from("adstudio_brand_kits")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", String(campaign.brand_kit_id))
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

  if (brandKitRow.error) throw new Error(brandKitRow.error.message);
  if (variants.error) throw new Error(variants.error.message);
  if (creatives.error) throw new Error(creatives.error.message);
  if (copy.error) throw new Error(copy.error.message);
  if (compliance.error) throw new Error(compliance.error.message);
  if (!brandKitRow.data) return null;

  const brandKit = applyBrandAssetRows(
    rowToBrandKit(brandKitRow.data),
    await loadAdStudioBrandAssetRows(supabase, workspaceId, String(campaign.brand_kit_id)),
  );

  return rowToCampaignPack({
    brandKit,
    campaign,
    variants: variants.data ?? [],
    creatives: creatives.data ?? [],
    copy: copy.data ?? [],
    compliance: compliance.data ?? null,
  });
}
