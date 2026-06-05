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
  await Promise.resolve(context.params);
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

  const exportPackage = await buildAdStudioExportPackage(body.campaignPack, {
    creativeRenders: body.creativeRenders,
  });
  const zipBlob = new Blob([new Uint8Array(exportPackage.zipBytes).buffer as ArrayBuffer], { type: "application/zip" });

  return new NextResponse(zipBlob, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": "attachment; filename=\"adstudio-export.zip\"",
    },
  });
}
