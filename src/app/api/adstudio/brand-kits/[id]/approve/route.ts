import { NextResponse, type NextRequest } from "next/server";

import { approveAdStudioBrandKitForUse, buildAdStudioLiveResult, type AdStudioBrandKit } from "@/lib/adstudio";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { persistAdStudioBrandKit, rowToBrandKit } from "@/lib/adstudio/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request, "approve_ads");

  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<{ brandKit?: AdStudioBrandKit }>(request);

  if (body.brandKit) {
    const approvedBrandKit = approveAdStudioBrandKitForUse({
      ...body.brandKit,
      brandKitId: id,
      workspaceId: access.access.workspaceId,
    });
    const persisted = await persistAdStudioBrandKit(access.supabase, approvedBrandKit, access.access.userId);
    const liveResult = buildAdStudioLiveResult({
      data: approvedBrandKit,
      persistenceError: persisted.error?.message,
    });

    return NextResponse.json({
      brandKit: liveResult.data,
      data: liveResult.data,
      persistence: liveResult.persistence,
    });
  }

  const { data, error } = await access.supabase
    .from("adstudio_brand_kits")
    .update({ review_status: "approved", updated_at: new Date().toISOString() })
    .eq("workspace_id", access.access.workspaceId)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) return errorResponse(error);
  if (!data) return NextResponse.json({ error: "Brand kit was not found." }, { status: 404 });

  const approvedBrandKit = approveAdStudioBrandKitForUse(rowToBrandKit(data));
  const liveResult = buildAdStudioLiveResult({ data: approvedBrandKit });

  return NextResponse.json({ brandKit: liveResult.data, data: liveResult.data, persistence: liveResult.persistence });
}
