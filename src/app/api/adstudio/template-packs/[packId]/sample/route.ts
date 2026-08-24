import { createHash } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { requireAdStudioRequest } from "@/lib/adstudio/http";
import {
  getImportedPack,
  readGallerySampleAssetKey,
  type GallerySamplePlacement,
} from "@/lib/adstudio/pack-gallery";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * Serve an imported gallery sample through Blockwise's authenticated origin.
 *
 * The pack is immutable, but its asset bytes remain private in storage. We
 * resolve the declared placement asset, verify the stored row and bytes match
 * the signed pack metadata, then return the image without exposing a Frank or
 * raw Supabase URL to the browser.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ packId: string }> },
) {
  const context = await requireAdStudioRequest(request);
  if (!context.ok) return context.response;

  const { packId } = await params;
  const placement = parsePlacement(request.nextUrl.searchParams.get("placement"));
  if (!/^[A-Za-z0-9._-]+$/.test(packId) || !placement) {
    return notFoundResponse();
  }

  const pack = await getImportedPack(context.supabase, packId);
  if (!pack) return notFoundResponse();

  const assetKey = readGallerySampleAssetKey(pack, placement);
  if (!assetKey) return notFoundResponse();

  const { data: asset, error: assetError } = await context.supabase
    .from("ad_template_assets")
    .select("asset_key, sha256, mime_type, storage_path")
    .eq("pack_id", packId)
    .eq("asset_key", assetKey)
    .maybeSingle();
  if (assetError) {
    console.error("Ad Studio gallery asset lookup failed", { message: assetError.message });
    return notFoundResponse();
  }

  const declaredAsset = pack.assets[assetKey];
  if (!declaredAsset || !isGalleryAsset(asset, packId, assetKey, declaredAsset)) {
    return notFoundResponse();
  }

  // Imported packs are global, so their private `templates/<packId>/...`
  // objects are intentionally not workspace-prefixed. Keep the request
  // workspace-authenticated above, then use the server-only storage client to
  // read the exact verified object without weakening storage RLS policies.
  const service = createSupabaseServiceClient();
  const { data, error } = await service.storage
    .from("workspace-artifacts")
    .download(asset.storage_path);
  if (error || !data) return notFoundResponse();

  const bytes = Buffer.from(await data.arrayBuffer());
  if (sha256(bytes) !== asset.sha256) return notFoundResponse();

  return new NextResponse(bytes, {
    headers: {
      "content-type": asset.mime_type,
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-sha256": asset.sha256,
    },
  });
}

function parsePlacement(value: string | null): GallerySamplePlacement | null {
  return value === "feed" || value === "story" ? value : null;
}

function isGalleryAsset(
  value: unknown,
  packId: string,
  assetKey: string,
  declaredAsset: { sha256: string; mimeType: string },
): value is { asset_key: string; sha256: string; mime_type: string; storage_path: string } {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const storagePath = typeof row.storage_path === "string" ? row.storage_path : "";
  const safePackId = escapeRegExp(packId);
  return (
    row.asset_key === assetKey &&
    row.sha256 === declaredAsset.sha256 && /^[a-f0-9]{64}$/.test(row.sha256) &&
    row.mime_type === declaredAsset.mimeType && IMAGE_MIME_TYPES.has(row.mime_type) &&
    new RegExp(`^templates/${safePackId}/[A-Za-z0-9._-]+$`).test(storagePath)
  );
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function notFoundResponse() {
  return NextResponse.json({ error: "Gallery sample was not found." }, { status: 404 });
}
