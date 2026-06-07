import { NextResponse, type NextRequest } from "next/server";

import { buildAdStudioExportPackage } from "@/lib/adstudio";
import { requireAdStudioRequest } from "@/lib/adstudio/http";
import type { AdStudioCampaignPack, CreativeExportRender } from "@/lib/adstudio";

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

  const body = await request.json().catch(() => null) as {
    campaignPack?: AdStudioCampaignPack;
    creativeRenders?: CreativeExportRender[];
  } | null;

  if (!body?.campaignPack) {
    return NextResponse.json({ error: "campaignPack is required." }, { status: 400 });
  }

  if (body.campaignPack.campaign.campaignId !== id) {
    return NextResponse.json({ error: "Campaign ID does not match export payload." }, { status: 400 });
  }

  const exportPackage = await buildAdStudioExportPackage(body.campaignPack, {
    creativeRenders: body.creativeRenders,
  });
  const zipBlob = new Blob([new Uint8Array(exportPackage.zipBytes).buffer as ArrayBuffer], { type: "application/zip" });
  const filename = `${slugFileName(body.campaignPack.campaign.name || "adstudio-campaign")}-creatives.zip`;

  return new NextResponse(zipBlob, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

function slugFileName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "adstudio-campaign";
}
