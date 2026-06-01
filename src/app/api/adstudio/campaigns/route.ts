import { NextResponse, type NextRequest } from "next/server";

import { buildAdStudioLiveResult, generateAdStudioCampaignPack } from "@/lib/adstudio";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { persistAdStudioCampaignPack } from "@/lib/adstudio/persistence";
import type { AdStudioBrandKit, AdStudioGoal, AdStudioPlatform } from "@/lib/adstudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateCampaignBody = {
  brandKit?: AdStudioBrandKit;
  goal?: AdStudioGoal;
  suburb?: string;
  city?: string;
  state?: string;
  offerId?: string;
  platforms?: AdStudioPlatform[];
  variantCount?: number;
};

export async function GET(request: NextRequest) {
  const context = await requireAdStudioRequest(request);

  if (!context.ok) {
    return context.response;
  }

  const { data, error } = await context.supabase
    .from("adstudio_campaigns")
    .select("*")
    .eq("workspace_id", context.access.workspaceId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ campaigns: data ?? [] });
}

export async function POST(request: NextRequest) {
  const context = await requireAdStudioRequest(request);

  if (!context.ok) {
    return context.response;
  }

  const body = await readJsonBody<CreateCampaignBody>(request);

  try {
    if (!body.brandKit) {
      return NextResponse.json({ error: "Approved brandKit is required." }, { status: 400 });
    }

    if (body.brandKit.reviewStatus !== "approved") {
      return NextResponse.json({ error: "Brand kit must be approved before campaign generation." }, { status: 409 });
    }

    const pack = generateAdStudioCampaignPack({
      workspaceId: context.access.workspaceId,
      brandKit: { ...body.brandKit, workspaceId: context.access.workspaceId, reviewStatus: "approved" },
      goal: body.goal ?? "seller_leads",
      suburb: body.suburb ?? "Scarborough",
      city: body.city ?? "Perth",
      state: body.state ?? "WA",
      offerId: body.offerId ?? "seller_prep_checklist",
      // Google Ads parked for Meta-only v1 (see src/lib/config/feature-flags.ts). Was: ["meta", "google_search", "google_pmax", "google_demand_gen"]
      platforms: body.platforms ?? ["meta"],
      variantCount: body.variantCount ?? 5,
    });
    const persisted = await persistAdStudioCampaignPack(context.supabase, pack, context.access.userId);
    const liveResult = buildAdStudioLiveResult({
      data: pack,
      persistenceError: persisted.error?.message,
    });

    return NextResponse.json(
      {
        campaignPack: liveResult.data,
        data: liveResult.data,
        persistence: liveResult.persistence,
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, 400);
  }
}
