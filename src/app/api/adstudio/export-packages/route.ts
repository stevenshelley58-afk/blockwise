import { NextResponse, type NextRequest } from "next/server";

import { buildAdStudioExportPackage } from "@/lib/adstudio";
import { hydrateStoredCreativeExportRenders } from "@/lib/adstudio/export-render-storage";
import { errorResponse, requireAdStudioRequest } from "@/lib/adstudio/http";
import type { AdStudioCampaignPack, CreativeExportRender } from "@/lib/adstudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  try {
    const body = await request.json().catch(() => null) as {
      campaignPack?: AdStudioCampaignPack;
      creativeRenders?: CreativeExportRender[];
    } | null;

    if (!body?.campaignPack) {
      return NextResponse.json({ error: "campaignPack is required." }, { status: 400 });
    }

    const creativeRenders = await hydrateStoredCreativeExportRenders(
      access.supabase,
      access.access.workspaceId,
      body.creativeRenders,
    );
    const exportPackage = await buildAdStudioExportPackage(body.campaignPack, { creativeRenders });

    return NextResponse.json({ exportPackage: { manifest: exportPackage.manifest } }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
