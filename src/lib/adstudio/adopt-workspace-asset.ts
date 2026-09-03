import type { SupabaseClient } from "@supabase/supabase-js";

import { isWorkspaceMediaPath } from "./media-urls.ts";
import { buildCustomerImageRef, CUSTOMER_IMAGE_BUCKET, imageSha256, parseCustomerImageRef, type CustomerImageMime } from "./customer-image-ref.ts";
import { CUSTOMER_IMAGE_MAX_BYTES, validateCustomerImageBytes } from "./image-validation.ts";

type AssetRow = { id: unknown; workspace_id: unknown; storage_path: unknown; asset_type: unknown };

/** Copy a canonical workspace asset into the ad-scoped, finalized media ledger. */
export async function adoptWorkspaceAsset(input: {
  accessSupabase: SupabaseClient;
  serviceSupabase: SupabaseClient;
  workspaceId: string;
  adId: string;
  sourceAssetId: string;
}): Promise<{ ref: string; sourceAssetId: string }> {
  const { data: row, error: rowError } = await input.accessSupabase
    .from("adstudio_brand_assets")
    .select("id,workspace_id,storage_path,asset_type")
    .eq("id", input.sourceAssetId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (rowError) throw new AdoptAssetError("database", "We could not look up that workspace image.");
  if (!row) throw new AdoptAssetError("source_not_found", "Workspace asset was not found.");
  const asset = row as AssetRow;
  const sourcePath = typeof asset.storage_path === "string" ? asset.storage_path.trim() : "";
  if (!isWorkspaceMediaPath(input.workspaceId, sourcePath)) throw new AdoptAssetError("source_invalid", "Workspace asset is not safely stored.");

  const source = await input.serviceSupabase.storage.from("workspace-artifacts").download(sourcePath);
  if (source.error || !source.data) throw new AdoptAssetError("source_expired", "Workspace asset is no longer available.");
  const bytes = Buffer.from(await source.data.arrayBuffer());
  if (bytes.length > CUSTOMER_IMAGE_MAX_BYTES) throw new AdoptAssetError("source_invalid", "Workspace asset exceeds the image limit.");
  const mime = sniffMime(bytes);
  if (!mime) throw new AdoptAssetError("source_invalid", "Workspace asset is not a supported image.");
  try { await validateCustomerImageBytes(bytes, mime); } catch { throw new AdoptAssetError("source_invalid", "Workspace asset could not be verified."); }

  const sha256 = imageSha256(bytes);
  const ref = buildCustomerImageRef(input.workspaceId, input.adId, sha256, mime);
  const parsed = parseCustomerImageRef(ref, input.workspaceId, input.adId);
  if (!parsed) throw new AdoptAssetError("source_invalid", "Workspace asset reference is invalid.");
  const prepared = await input.serviceSupabase.rpc("adstudio_prepare_customer_image_upload", {
    p_workspace_id: input.workspaceId, p_ad_id: input.adId, p_object_path: parsed.path,
    p_sha256: sha256, p_mime_type: mime, p_byte_size: bytes.length,
  });
  if (prepared.error) throw new AdoptAssetError("storage", "We could not prepare this image.");
  const result = ledgerResult(prepared.data);
  if (!result.ok) throw new AdoptAssetError(result.code === "workspace_upload_quota" ? "quota" : "storage", "We could not store this image.");
  if (result.status === "finalized") return { ref, sourceAssetId: String(asset.id) };
  if (!result.reservationId) throw new AdoptAssetError("storage", "We could not reserve this image.");
  const upload = await input.serviceSupabase.storage.from(CUSTOMER_IMAGE_BUCKET).upload(parsed.path, bytes, { contentType: mime, upsert: false });
  if (upload.error) {
    const existing = await input.serviceSupabase.storage.from(CUSTOMER_IMAGE_BUCKET).info(parsed.path);
    if (existing.error || existing.data?.size !== bytes.length) { await discard(input, result.reservationId, input.workspaceId, input.adId, parsed.path); throw new AdoptAssetError("storage", "We could not store this image."); }
  }
  const info = await input.serviceSupabase.storage.from(CUSTOMER_IMAGE_BUCKET).info(parsed.path);
  if (info.error || info.data?.size !== bytes.length) { await discard(input, result.reservationId, input.workspaceId, input.adId, parsed.path); throw new AdoptAssetError("storage", "We could not verify this image."); }
  const downloaded = await input.serviceSupabase.storage.from(CUSTOMER_IMAGE_BUCKET).download(parsed.path);
  if (downloaded.error || !downloaded.data || imageSha256(Buffer.from(await downloaded.data.arrayBuffer())) !== sha256) { await discard(input, result.reservationId, input.workspaceId, input.adId, parsed.path); throw new AdoptAssetError("storage", "We could not verify this image."); }
  const claimed = await input.serviceSupabase.rpc("adstudio_claim_customer_image_finalize", { p_reservation_id: result.reservationId, p_workspace_id: input.workspaceId, p_ad_id: input.adId, p_object_path: parsed.path, p_sha256: sha256, p_mime_type: mime, p_byte_size: bytes.length });
  if (claimed.error || !ledgerResult(claimed.data).ok) { await discard(input, result.reservationId, input.workspaceId, input.adId, parsed.path); throw new AdoptAssetError("storage", "This image is already being finalized. Try again."); }
  const finalized = await input.serviceSupabase.rpc("adstudio_finalize_customer_image_upload", { p_reservation_id: result.reservationId, p_workspace_id: input.workspaceId, p_ad_id: input.adId, p_object_path: parsed.path, p_sha256: sha256, p_mime_type: mime, p_byte_size: bytes.length });
  if (finalized.error || !ledgerResult(finalized.data).ok) { await discard(input, result.reservationId, input.workspaceId, input.adId, parsed.path); throw new AdoptAssetError("storage", "We could not verify this image."); }
  return { ref, sourceAssetId: String(asset.id) };
}

export class AdoptAssetError extends Error {
  readonly code: "source_not_found" | "source_invalid" | "source_expired" | "quota" | "storage" | "database";
  constructor(code: "source_not_found" | "source_invalid" | "source_expired" | "quota" | "storage" | "database", message: string) { super(message); this.code = code; }
}

async function discard(input: { serviceSupabase: SupabaseClient }, reservationId: string, workspaceId: string, adId: string, path: string) {
  await input.serviceSupabase.rpc("adstudio_discard_customer_image_upload", { p_reservation_id: reservationId, p_workspace_id: workspaceId, p_ad_id: adId, p_object_path: path });
  await input.serviceSupabase.storage.from(CUSTOMER_IMAGE_BUCKET).remove([path]);
  await input.serviceSupabase.rpc("adstudio_complete_customer_image_stale_cleanup", { p_reservation_id: reservationId, p_object_path: path });
}

function ledgerResult(value: unknown): { ok: boolean; status?: string; reservationId?: string; code?: string } {
  if (!value || typeof value !== "object") return { ok: false };
  const v = value as Record<string, unknown>;
  return { ok: v.ok === true, status: typeof v.status === "string" ? v.status : undefined, reservationId: typeof v.reservation_id === "string" ? v.reservation_id : undefined, code: typeof v.code === "string" ? v.code : undefined };
}

function sniffMime(bytes: Buffer): CustomerImageMime | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "image/jpeg";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}
