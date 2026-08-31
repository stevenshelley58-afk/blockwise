import { NextResponse, type NextRequest } from "next/server";
import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { getTemplate, templateAssetStoragePath } from "@/lib/adstudio/pack-gallery";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string; assetKey: string }> },
) {
  const context = await requireAdStudioRequest(request);
  if (!context.ok) return context.response;
  const { templateId, assetKey } = await params;
  const template = await getTemplate(context.supabase, templateId);
  const declared = template?.assets[assetKey];
  if (!template || !declared || !IMAGE_MIME_TYPES.has(declared.mimeType)) return notFoundResponse();

  const expectedPath = templateAssetStoragePath(templateId, assetKey, declared.fileName);
  const service = createSupabaseServiceClient();
  const { data: asset, error } = await service.from("ad_template_assets_direct")
    .select("asset_key,file_name,mime_type,storage_path")
    .eq("template_id", templateId).eq("asset_key", assetKey).maybeSingle();
  if (error || !asset || asset.asset_key !== assetKey || asset.file_name !== declared.fileName ||
      asset.mime_type !== declared.mimeType || asset.storage_path !== expectedPath) return notFoundResponse();

  const { data, error: downloadError } = await service.storage.from("workspace-artifacts").download(expectedPath);
  if (downloadError || !data) return notFoundResponse();
  return new NextResponse(new Uint8Array(await data.arrayBuffer()), {
    headers: { "content-type": asset.mime_type, "cache-control": "private, max-age=31536000, immutable" },
  });
}

function notFoundResponse() {
  return NextResponse.json({ error: "Template asset was not found." }, { status: 404 });
}
