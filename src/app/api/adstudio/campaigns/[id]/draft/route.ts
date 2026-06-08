import { NextResponse, type NextRequest } from "next/server";

import { buildAdStudioLiveResult } from "@/lib/adstudio";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import {
  compactAdStudioCampaignPackForTransport,
  persistAdStudioCampaignPack,
  rowToBrandKit,
  rowToCampaignPack,
} from "@/lib/adstudio/persistence";
import { applyBrandAssetRows, loadAdStudioBrandAssetRows } from "@/lib/adstudio/assets";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AdStudioCampaignPack } from "@/lib/adstudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type DraftBody = {
  campaignPack?: AdStudioCampaignPack;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<DraftBody>(request);

  try {
    if (!body.campaignPack) {
      return NextResponse.json({ error: "campaignPack is required." }, { status: 400 });
    }

    if (body.campaignPack.campaign.campaignId !== id) {
      return NextResponse.json({ error: "Campaign ID does not match draft payload." }, { status: 400 });
    }

    const existingPack = await loadExistingCampaignPack(access.supabase, access.access.workspaceId, id);

    if (!existingPack) {
      return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
    }

    const submittedPack: AdStudioCampaignPack = {
      ...body.campaignPack,
      brandKit: existingPack.brandKit,
      campaign: {
        ...body.campaignPack.campaign,
        workspaceId: access.access.workspaceId,
        brandKitId: existingPack.campaign.brandKitId,
      },
      variants: body.campaignPack.variants.map((variant) => ({
        ...variant,
        campaignId: id,
      })),
      creatives: body.campaignPack.creatives.map((creative) => ({
        ...creative,
        campaignId: id,
      })),
      copyPacks: body.campaignPack.copyPacks.map((copyPack) => ({
        ...copyPack,
        campaignId: id,
      })),
      compliance: {
        ...body.campaignPack.compliance,
        campaignId: id,
      },
    };
    const campaignPack = mergeCampaignPack(existingPack, submittedPack);

    const persisted = await persistAdStudioCampaignPack(access.supabase, campaignPack, access.access.userId);
    const responsePack = persisted.error
      ? campaignPack
      : (await loadExistingCampaignPack(access.supabase, access.access.workspaceId, id)) ?? campaignPack;
    const liveResult = buildAdStudioLiveResult({
      data: compactAdStudioCampaignPackForTransport(responsePack),
      persistenceError: persisted.error?.message,
    });

    return NextResponse.json({
      campaignPack: liveResult.data,
      data: liveResult.data,
      persistence: liveResult.persistence,
    });
  } catch (error) {
    return errorResponse(error, 400);
  }
}

async function loadExistingCampaignPack(
  supabase: SupabaseServerClient,
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

function mergeCampaignPack(existing: AdStudioCampaignPack, submitted: AdStudioCampaignPack): AdStudioCampaignPack {
  return {
    ...existing,
    campaign: {
      ...existing.campaign,
      ...submitted.campaign,
      campaignId: existing.campaign.campaignId,
      workspaceId: existing.campaign.workspaceId,
      brandKitId: existing.campaign.brandKitId,
    },
    variants: mergeById(existing.variants, submitted.variants, (variant) => variant.variantId),
    creatives: mergeById(existing.creatives, submitted.creatives, (creative) => creative.creativeId),
    copyPacks: mergeById(existing.copyPacks, submitted.copyPacks, (copyPack) => copyPack.copyPackId),
    compliance: {
      ...existing.compliance,
      ...submitted.compliance,
      campaignId: existing.campaign.campaignId,
    },
  };
}

function mergeById<T>(existing: T[], submitted: T[], getId: (item: T) => string): T[] {
  const submittedById = new Map(submitted.map((item) => [getId(item), item]));
  const merged = existing.map((item) => submittedById.get(getId(item)) ?? item);
  const existingIds = new Set(existing.map(getId));
  return [...merged, ...submitted.filter((item) => !existingIds.has(getId(item)))];
}
