import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";

import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { saveAd, SaveError } from "@/lib/adstudio/save-ad";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { adDocumentSchema, type AdDocumentParsed } from "../../../../../../../packages/ad-template-pack-contract/src/schema.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

type SaveBody = {
  document?: unknown;
  expectedRevision?: unknown;
};

/**
 * POST /api/adstudio/ads/[id]/save?workspaceId=...
 *
 * Persists a customer AdDocument as a new revision and renders Feed + Story
 * PNGs through saveAd. Returns both PNG hashes. Workspace-scoped: the ad row
 * must belong to the caller's workspace. Rejects stale revisions (409) so two
 * editors can't silently overwrite each other.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<SaveBody>(request);

  const parsed = adDocumentSchema.safeParse(body.document);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid ad document: " + parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }

  if (typeof body.expectedRevision !== "number" || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) {
    return NextResponse.json({ error: "expectedRevision must be a non-negative integer." }, { status: 400 });
  }

  const document = parsed.data as AdDocumentParsed;

  try {
    const [customerImages, templateAssets] = await Promise.all([
      resolveImageValues(document),
      resolveTemplatePlateValues(id, access.access.workspaceId),
    ]);
    const output = await saveAd({
      supabase: access.supabase,
      workspaceId: access.access.workspaceId,
      adId: id,
      document,
      expectedRevision: body.expectedRevision,
      colourMap: document.resolvedColourMap,
      imageValues: { ...templateAssets, ...customerImages },
    });

    return NextResponse.json({ ad: output });
  } catch (err) {
    if (err instanceof SaveError) {
      const status =
        err.code === "ad_not_found" || err.code === "pack_not_found"
          ? 404
          : err.code === "stale_revision" || err.code === "template_hash_mismatch"
            ? 409
            : err.code.startsWith("image_")
              ? 400
              : 500;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    return errorResponse(err);
  }
}

// ---------------------------------------------------------------------------
// Customer image resolution. The browser editor emits a data URL; accepting
// arbitrary network URLs here would turn Save into an authenticated SSRF.
// ---------------------------------------------------------------------------

const MAX_CUSTOMER_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_CUSTOMER_IMAGE_PIXELS = 40_000_000;

export async function resolveImageValues(document: AdDocumentParsed): Promise<Record<string, Buffer>> {
  const entries = Object.entries(document.sharedImageValues);
  if (entries.length === 0) return {};

  const resolved: Record<string, Buffer> = {};
  for (const [key, value] of entries) {
    try {
      const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
      if (!match) throw new Error("Only PNG, JPEG, or WebP data URLs are accepted");
      if (match[2].length > Math.ceil(MAX_CUSTOMER_IMAGE_BYTES / 3) * 4 + 4) throw new Error("Image is too large");
      const bytes = Buffer.from(match[2], "base64");
      if (bytes.length === 0 || bytes.length > MAX_CUSTOMER_IMAGE_BYTES) throw new Error("Image is too large");
      if (sniffImageMime(bytes) !== match[1]) throw new Error("Image bytes do not match the declared type");
      const sharp = (await import("sharp")).default;
      const metadata = await sharp(bytes, { limitInputPixels: MAX_CUSTOMER_IMAGE_PIXELS }).metadata();
      if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_CUSTOMER_IMAGE_PIXELS) {
        throw new Error("Image dimensions are invalid");
      }
      resolved[key] = bytes;
    } catch {
      throw new SaveError("image_invalid", `Image for input "${key}" must be a valid PNG, JPEG, or WebP under 10 MB.`);
    }
  }
  return resolved;
}

function sniffImageMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "image/jpeg";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

async function resolveTemplatePlateValues(adId: string, workspaceId: string): Promise<Record<string, Buffer>> {
  const service = createSupabaseServiceClient();
  const { data: ad, error: adError } = await service
    .from("ad_customer_ads")
    .select("template_pack_id")
    .eq("id", adId)
    .eq("workspace_id", workspaceId)
    .single();
  if (adError || !ad?.template_pack_id) throw new SaveError("ad_not_found", "Ad not found");

  const { data: assets, error: assetError } = await service
    .from("ad_template_assets")
    .select("asset_key, sha256, storage_path")
    .eq("pack_id", ad.template_pack_id)
    .in("asset_key", ["feed-plate", "story-plate"]);
  if (assetError) throw new SaveError("template_asset_load_failed", assetError.message);

  const values: Record<string, Buffer> = {};
  for (const asset of assets ?? []) {
    if (!asset.storage_path) throw new SaveError("template_asset_missing", `Template asset ${asset.asset_key} has no stored bytes.`);
    const { data, error } = await service.storage.from("workspace-artifacts").download(asset.storage_path);
    if (error || !data) throw new SaveError("template_asset_missing", `Template asset ${asset.asset_key} could not be loaded.`);
    const bytes = Buffer.from(await data.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {
      throw new SaveError("template_asset_tampered", `Template asset ${asset.asset_key} failed its integrity check.`);
    }
    values[asset.asset_key] = bytes;
  }
  return values;
}
