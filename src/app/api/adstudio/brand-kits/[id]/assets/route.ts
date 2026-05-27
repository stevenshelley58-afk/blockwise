import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";

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

  const body = await readJsonBody<{ assetType?: string; sourceUrl?: string; storagePath?: string }>(request);
  const { data, error } = await access.supabase
    .from("adstudio_brand_assets")
    .insert({
      workspace_id: access.access.workspaceId,
      brand_kit_id: id,
      asset_type: body.assetType ?? "uploaded_asset",
      source_url: body.sourceUrl,
      storage_path: body.storagePath,
      metadata_json: body,
    })
    .select("*")
    .maybeSingle();

  if (error) return errorResponse(error);

  return NextResponse.json({ asset: data }, { status: 201 });
}
