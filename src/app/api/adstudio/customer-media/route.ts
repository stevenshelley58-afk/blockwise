import { NextResponse, type NextRequest } from "next/server";

import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { CUSTOMER_IMAGE_BUCKET, parseCustomerImageRef } from "@/lib/adstudio/customer-image-ref";
import { imageSha256 } from "@/lib/adstudio/customer-image-hash.server";
import { CUSTOMER_IMAGE_MAX_BYTES, validateCustomerImageBytes } from "@/lib/adstudio/image-validation";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;

  const path = request.nextUrl.searchParams.get("path")?.trim();
  const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
  if (!path || !workspaceId) return NextResponse.json({ error: "Invalid media reference." }, { status: 400 });

  const canonical = new RegExp(`^(${escapeRegExp(workspaceId)})/adstudio/ads/([A-Za-z0-9_-]+)/images/([a-f0-9]{64})\\.(png|jpg|webp)$`, "i").exec(path);
  if (!canonical || workspaceId !== access.access.workspaceId) return NextResponse.json({ error: "Media asset was not found." }, { status: 404 });

  const ref = request.nextUrl.pathname + request.nextUrl.search;
  const parsed = parseCustomerImageRef(ref, workspaceId, canonical[2]);
  if (!parsed) return NextResponse.json({ error: "Media asset was not found." }, { status: 404 });

  const { data: ad, error: adError } = await access.supabase
    .from("ad_customer_ads")
    .select("id")
    .eq("id", canonical[2])
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (adError || !ad) return NextResponse.json({ error: "Media asset was not found." }, { status: 404 });

  const service = createSupabaseServiceClient();
  const { data: finalizedUpload, error: finalizedUploadError } = await service
    .from("adstudio_customer_image_uploads")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("ad_id", canonical[2])
    .eq("object_path", parsed.path)
    .eq("sha256", parsed.sha256)
    .eq("mime_type", parsed.mime)
    .eq("status", "finalized")
    .maybeSingle();
  if (finalizedUploadError || !finalizedUpload) return NextResponse.json({ error: "Media asset was not found." }, { status: 404 });

  const { data, error } = await service.storage.from(CUSTOMER_IMAGE_BUCKET).download(parsed.path);
  if (error || !data) return NextResponse.json({ error: "Media asset was not found." }, { status: 404 });

  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.length > CUSTOMER_IMAGE_MAX_BYTES || imageSha256(bytes) !== parsed.sha256) return NextResponse.json({ error: "Media asset was not found." }, { status: 404 });
  try {
    await validateCustomerImageBytes(bytes, parsed.mime);
  } catch {
    return NextResponse.json({ error: "Media asset was not found." }, { status: 404 });
  }

  return new NextResponse(bytes, {
    headers: {
      "content-type": parsed.mime,
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
