import { createHash } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { getImportedPack } from "@/lib/adstudio/pack-gallery";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const SAFE_ID = /^[A-Za-z0-9._-]+$/;

/**
 * Serve one signed, imported template image to the layered editor. The browser
 * receives neither the private bucket path nor the Frank release URL.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ packId: string; assetKey: string }> },
) {
  const context = await requireAdStudioRequest(request);
  if (!context.ok) return context.response;

  const { packId, assetKey } = await params;
  if (!SAFE_ID.test(packId) || !SAFE_ID.test(assetKey)) return notFoundResponse();

  const pack = await getImportedPack(context.supabase, packId);
  const declared = pack?.assets[assetKey];
  if (!pack || !declared || !IMAGE_MIME_TYPES.has(declared.mimeType)) return notFoundResponse();

  const { data: asset, error: assetError } = await context.supabase
    .from("ad_template_assets")
    .select("asset_key, sha256, mime_type, storage_path")
    .eq("pack_id", packId)
    .eq("asset_key", assetKey)
    .maybeSingle();
  if (assetError || !isVerifiedAssetRow(asset, packId, assetKey, declared)) return notFoundResponse();

  const service = createSupabaseServiceClient();
  const { data, error } = await service.storage.from("workspace-artifacts").download(asset.storage_path);
  if (error || !data) return notFoundResponse();

  const bytes = Buffer.from(await data.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256) return notFoundResponse();

  return new NextResponse(bytes, {
    headers: {
      "content-type": asset.mime_type,
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-sha256": asset.sha256,
    },
  });
}

function isVerifiedAssetRow(
  value: unknown,
  packId: string,
  assetKey: string,
  declared: { sha256: string; mimeType: string },
): value is { asset_key: string; sha256: string; mime_type: string; storage_path: string } {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const storagePath = typeof row.storage_path === "string" ? row.storage_path : "";
  return (
    row.asset_key === assetKey &&
    row.sha256 === declared.sha256 && /^[a-f0-9]{64}$/.test(String(row.sha256)) &&
    row.mime_type === declared.mimeType && IMAGE_MIME_TYPES.has(String(row.mime_type)) &&
    new RegExp(`^templates/${escapeRegExp(packId)}/[A-Za-z0-9._-]+$`).test(storagePath)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function notFoundResponse() {
  return NextResponse.json({ error: "Template asset was not found." }, { status: 404 });
}
