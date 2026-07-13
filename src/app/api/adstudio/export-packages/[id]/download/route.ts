import { NextResponse, type NextRequest } from "next/server";

import { buildAdStudioExportPackage } from "@/lib/adstudio";
import { hydrateStoredCreativeExportRenders } from "@/lib/adstudio/export-render-storage";
import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { loadAdStudioCampaignPack } from "@/lib/adstudio/persistence";
import type { CreativeExportRender } from "@/lib/adstudio";

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

  const authoritativePack = await loadAdStudioCampaignPack(
    access.supabase,
    access.access.workspaceId,
    id,
  );
  if (!authoritativePack) {
    return NextResponse.json(
      { code: "campaign_not_found", error: "Campaign not found." },
      { status: 404 },
    );
  }

  const containsFlatClone = authoritativePack.creatives.some(
    (creative) =>
      creative.canvas.objects.length === 1 &&
      creative.canvas.objects[0]?.objectId === "template_clone_image",
  );
  if (containsFlatClone) {
    return NextResponse.json(
      {
        code: "flat_clone_export_not_ready",
        error: "This AI-designed ad cannot be exported until its approved revision files are ready.",
      },
      { status: 409 },
    );
  }

  const body = await request.json().catch(() => null) as {
    creativeRenders?: CreativeExportRender[];
  } | null;
  if (!Array.isArray(body?.creativeRenders)) {
    return NextResponse.json(
      { code: "invalid_export_payload", error: "Creative renders are required." },
      { status: 400 },
    );
  }

  const creativeRenders = await hydrateStoredCreativeExportRenders(
    access.supabase,
    access.access.workspaceId,
    body.creativeRenders,
  );
  const exportPackage = await buildAdStudioExportPackage(authoritativePack, { creativeRenders });
  const zipBlob = new Blob([new Uint8Array(exportPackage.zipBytes).buffer as ArrayBuffer], { type: "application/zip" });
  const filename = `${slugFileName(authoritativePack.campaign.name || "adstudio-campaign")}-creatives.zip`;

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
