import { NextResponse, type NextRequest } from "next/server";

import { recordWorkspaceFunnelEventBestEffort } from "@/lib/analytics/progressive-funnel";
import { approveAdStudioBrandKitForUse, buildAdStudioLiveResult, type AdStudioBrandKit } from "@/lib/adstudio";
import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { isExampleBrandKit, isExampleBrandKitSourceUrl, persistAdStudioBrandKit, rowToBrandKit } from "@/lib/adstudio/persistence";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

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

  const body = await readJsonBody<{ brandKit?: AdStudioBrandKit }>(request);

  if (body.brandKit) {
    if (isExampleBrandKit(body.brandKit)) {
      return NextResponse.json({ error: "Demo brand kits cannot be approved." }, { status: 400 });
    }

    const approvedBrandKit = approveAdStudioBrandKitForUse({
      ...body.brandKit,
      brandKitId: id,
      workspaceId: access.access.workspaceId,
    });
    const persisted = await persistAdStudioBrandKit(access.supabase, approvedBrandKit, access.access.userId);
    if (!persisted.error) {
      await recordBrandPackApproval(access.access.workspaceId, id);
    }
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

  const { data: existing, error: fetchError } = await access.supabase
    .from("adstudio_brand_kits")
    .select("*")
    .eq("workspace_id", access.access.workspaceId)
    .eq("id", id)
    .maybeSingle();

  if (fetchError) return errorResponse(fetchError);
  if (!existing) return NextResponse.json({ error: "Brand kit was not found." }, { status: 404 });
  if (isExampleBrandKitSourceUrl(String(existing.source_url ?? ""))) {
    return NextResponse.json({ error: "Demo brand kits cannot be approved." }, { status: 400 });
  }

  const { data, error } = await access.supabase
    .from("adstudio_brand_kits")
    .update({ review_status: "approved", updated_at: new Date().toISOString() })
    .eq("workspace_id", access.access.workspaceId)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) return errorResponse(error);

  await recordBrandPackApproval(access.access.workspaceId, id);
  const approvedBrandKit = approveAdStudioBrandKitForUse(rowToBrandKit(data));
  const liveResult = buildAdStudioLiveResult({ data: approvedBrandKit });

  return NextResponse.json({ brandKit: liveResult.data, data: liveResult.data, persistence: liveResult.persistence });
}

async function recordBrandPackApproval(workspaceId: string, brandKitId: string): Promise<void> {
  await recordWorkspaceFunnelEventBestEffort(createSupabaseServiceClient(), {
    eventName: "brand_pack_approved",
    workspaceId,
    idempotencyKey: `activation:${workspaceId}:first-brand-pack-approved`,
    properties: { brand_kit_id: brandKitId },
  });
}
