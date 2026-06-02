import { NextResponse, type NextRequest } from "next/server";

import { buildAdStudioLiveResult } from "@/lib/adstudio";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { persistAdStudioCampaignPack } from "@/lib/adstudio/persistence";
import type { AdStudioCampaignPack } from "@/lib/adstudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    const campaignPack: AdStudioCampaignPack = {
      ...body.campaignPack,
      brandKit: {
        ...body.campaignPack.brandKit,
        workspaceId: access.access.workspaceId,
      },
      campaign: {
        ...body.campaignPack.campaign,
        workspaceId: access.access.workspaceId,
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

    const persisted = await persistAdStudioCampaignPack(access.supabase, campaignPack, access.access.userId);
    const liveResult = buildAdStudioLiveResult({
      data: campaignPack,
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
