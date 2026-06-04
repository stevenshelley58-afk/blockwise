import { NextResponse, type NextRequest } from "next/server";

import { buildAdStudioLiveResult, generateAdStudioCampaignPack } from "@/lib/adstudio";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { persistAdStudioCampaignPack } from "@/lib/adstudio/persistence";
import { AD_STUDIO_TEMPLATES, FIRST_AD_FORMATS, type AdStudioBrandKit, type AdStudioFormat, type AdStudioGoal, type AdStudioPlatform, type FirstAdInput } from "@/lib/adstudio";

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
  creativeFormats?: AdStudioFormat[];
  variantCount?: number;
  firstAd?: FirstAdInput;
};

function validateFirstAd(firstAd: FirstAdInput | undefined): string | null {
  if (!firstAd) return null;
  if (firstAd.mode !== "template" && firstAd.mode !== "custom") return "Invalid first ad start mode.";
  if (!firstAd.description?.trim()) return "A short description is required.";
  if (firstAd.description.length > 500) return "Description must be 500 characters or less.";
  if (!firstAd.imageDataUrl?.startsWith("data:image/")) return "An uploaded image is required.";
  if (JSON.stringify(firstAd.formats) !== JSON.stringify(FIRST_AD_FORMATS)) {
    return "First ad formats must be Story, Feed, and Square.";
  }
  if (firstAd.mode === "template" && !AD_STUDIO_TEMPLATES.some((template) => template.id === firstAd.templateId)) {
    return "Selected template was not found.";
  }
  return null;
}

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

    const firstAdError = validateFirstAd(body.firstAd);
    if (firstAdError) {
      return NextResponse.json({ error: firstAdError }, { status: 400 });
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
      creativeFormats: body.creativeFormats,
      variantCount: body.variantCount ?? 5,
      firstAd: body.firstAd,
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
