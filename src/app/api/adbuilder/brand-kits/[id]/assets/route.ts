import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, readJsonBody, requireAdBuilderRequest } from "@/lib/adbuilder/http";
import { loadAdBuilderBrandAssetRows } from "@/lib/adbuilder/assets";
import { normalizeAndValidateExtractionUrl } from "@/lib/adbuilder/extraction-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdBuilderRequest(request);

  if (!access.ok) {
    return access.response;
  }

  if (!(await brandKitExists(access.supabase, access.access.workspaceId, id))) {
    return NextResponse.json({ error: "Brand kit not found." }, { status: 404 });
  }

  try {
    const assets = await loadAdBuilderBrandAssetRows(access.supabase, access.access.workspaceId, id);
    return NextResponse.json({ assets });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdBuilderRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<{ assetType?: string; sourceUrl?: string; storagePath?: string }>(request);
  if (!(await brandKitExists(access.supabase, access.access.workspaceId, id))) {
    return NextResponse.json({ error: "Brand kit not found." }, { status: 404 });
  }

  if (body.sourceUrl) {
    const urlResult = normalizeAndValidateExtractionUrl(body.sourceUrl);
    if (!urlResult.ok) {
      return NextResponse.json({ error: urlResult.error }, { status: 400 });
    }
    body.sourceUrl = urlResult.url;
  }

  const { data, error } = await access.supabase
    .from("adbuilder_brand_assets")
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

async function brandKitExists(supabase: any, workspaceId: string, brandKitId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("adbuilder_brand_kits")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("id", brandKitId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Boolean(data);
}
