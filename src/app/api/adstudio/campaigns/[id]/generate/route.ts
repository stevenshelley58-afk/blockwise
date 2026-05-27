import { NextResponse, type NextRequest } from "next/server";

import { buildAdStudioLiveResult, generateAdStudioCampaignPack } from "@/lib/adstudio";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { persistAdStudioCampaignPack } from "@/lib/adstudio/persistence";
import type { AdStudioBrandKit } from "@/lib/adstudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

export async function POST(request: NextRequest, context: RouteContext) {
  await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<{ brandKit?: AdStudioBrandKit; variantCount?: number; suburb?: string }>(request);

  try {
    if (!body.brandKit) {
      return NextResponse.json({ error: "Approved brandKit is required." }, { status: 400 });
    }

    if (body.brandKit.reviewStatus !== "approved") {
      return NextResponse.json({ error: "Brand kit must be approved before campaign generation." }, { status: 409 });
    }

    const pack = generateAdStudioCampaignPack({
      workspaceId: access.access.workspaceId,
      brandKit: { ...body.brandKit, workspaceId: access.access.workspaceId, reviewStatus: "approved" },
      goal: "seller_leads",
      suburb: body.suburb ?? "Scarborough",
      city: "Perth",
      state: "WA",
      offerId: "seller_prep_checklist",
      platforms: ["meta", "google_search", "google_pmax", "google_demand_gen"],
      variantCount: body.variantCount ?? 5,
    });
    const persisted = await persistAdStudioCampaignPack(access.supabase, pack, access.access.userId);
    const liveResult = buildAdStudioLiveResult({
      data: pack,
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
