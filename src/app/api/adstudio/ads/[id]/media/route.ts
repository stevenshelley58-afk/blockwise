import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { buildCustomerImageRef, CUSTOMER_IMAGE_BUCKET, parseCustomerImageRef, type CustomerImageMime } from "@/lib/adstudio/customer-image-ref";
import { imageSha256 } from "@/lib/adstudio/customer-image-hash.server";
import { CUSTOMER_IMAGE_MAX_BYTES, CustomerImageValidationError, validateCustomerImageBytes } from "@/lib/adstudio/image-validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { adoptWorkspaceAsset, AdoptAssetError } from "@/lib/adstudio/adopt-workspace-asset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> | { id: string } };
type ImageBody = {
  operation?: unknown;
  reservationId?: unknown;
  sha256?: unknown;
  mime?: unknown;
  size?: unknown;
  sourceAssetId?: unknown;
};

const CUSTOMER_MIMES = new Set<CustomerImageMime>(["image/png", "image/jpeg", "image/webp"]);

/**
 * POST /api/adstudio/ads/[id]/media?workspaceId=...
 *
 * Issues a one-shot signed upload token, then finalizes the upload after the
 * browser has sent the bytes directly to Supabase Storage. The Next route
 * never receives the image body; only small metadata crosses the Vercel route.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;
  const { id } = await Promise.resolve(context.params);

  const body = (await request.json().catch(() => ({}))) as ImageBody;
  if (body.operation === "adopt") {
    const sourceAssetId = typeof body.sourceAssetId === "string" ? body.sourceAssetId.trim() : "";
    if (!sourceAssetId) return NextResponse.json({ error: "Select a workspace image first.", code: "invalid_source" }, { status: 400 });
    const { data: ad, error: adError } = await access.supabase.from("ad_customer_ads").select("id").eq("id", id).eq("workspace_id", access.access.workspaceId).maybeSingle();
    if (adError) return NextResponse.json({ error: "We could not verify this ad." }, { status: 500 });
    if (!ad) return NextResponse.json({ error: "Ad not found." }, { status: 404 });
    const rateLimit = await checkRateLimit(access.supabase, access.access.workspaceId, access.access.userId, { windowSeconds: 60 * 60, maxRequests: 120, bucket: "adstudio-media-upload" });
    if (!rateLimit.ok) return NextResponse.json({ error: "Upload limit reached. Try again later." }, { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } });
    const service = createSupabaseServiceClient();
    try {
      const adopted = await adoptWorkspaceAsset({ accessSupabase: access.supabase, serviceSupabase: service, workspaceId: access.access.workspaceId, adId: id, sourceAssetId });
      return NextResponse.json(adopted, { headers: { "cache-control": "private, no-store" } });
    } catch (error) {
      const status = error instanceof AdoptAssetError && error.code === "source_not_found" ? 404 : error instanceof AdoptAssetError && error.code === "database" ? 500 : error instanceof AdoptAssetError && error.code === "quota" ? 413 : error instanceof AdoptAssetError && error.code === "source_expired" ? 410 : 400;
      console.error("Ad Studio workspace asset adoption failed", { code: error instanceof AdoptAssetError ? error.code : "storage" });
      return NextResponse.json({ error: error instanceof AdoptAssetError ? error.message : "We could not use this workspace image.", code: error instanceof AdoptAssetError ? error.code : "storage" }, { status });
    }
  }
  const operation = body.operation === "finalize" ? "finalize" : body.operation === "prepare" ? "prepare" : body.operation === "discard" ? "discard" : null;
  const validated = validateMetadata(body);
  const reservationId = typeof body.reservationId === "string" && isUuid(body.reservationId) ? body.reservationId : null;
  if (!operation || !validated.ok || (operation === "finalize" || operation === "discard") && !reservationId) {
    return NextResponse.json({ error: validated.ok ? "Invalid media operation." : validated.error }, { status: 400 });
  }

  const { data: ad, error: adError } = await access.supabase
    .from("ad_customer_ads")
    .select("id")
    .eq("id", id)
    .eq("workspace_id", access.access.workspaceId)
    .maybeSingle();
  if (adError) {
    console.error("Ad Studio media ownership check failed", { message: adError.message });
    return NextResponse.json({ error: "We could not prepare this image upload." }, { status: 500 });
  }
  if (!ad) return NextResponse.json({ error: "Ad not found." }, { status: 404 });

  const rateLimit = await checkRateLimit(access.access.workspaceId, access.access.userId, {
    windowSeconds: 60 * 60,
    maxRequests: 120,
    bucket: "adstudio-media-upload",
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Upload limit reached. Try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const ref = buildCustomerImageRef(access.access.workspaceId, id, validated.sha256, validated.mime);
  const parsed = parseCustomerImageRef(ref, access.access.workspaceId, id);
  if (!parsed) return NextResponse.json({ error: "Invalid image reference." }, { status: 400 });

  const service = createSupabaseServiceClient();

  if (operation === "discard") {
    const discarded = await discardAndCleanup(service, reservationId, access.access.workspaceId, id, parsed.path);
    return NextResponse.json({ discarded }, { headers: { "cache-control": "private, no-store" } });
  }

  if (operation === "prepare") {
    const ledger = await service.rpc("adstudio_prepare_customer_image_upload", {
      p_workspace_id: access.access.workspaceId,
      p_ad_id: id,
      p_object_path: parsed.path,
      p_sha256: validated.sha256,
      p_mime_type: validated.mime,
      p_byte_size: validated.size,
    });
    if (ledger.error) {
      console.error("Ad Studio customer image ledger prepare failed", { message: ledger.error.message });
      return NextResponse.json({ error: "We could not prepare this image upload." }, { status: 500 });
    }
    const ledgerResult = asLedgerResult(ledger.data);
    await removeStaleObjects(service, ledgerResult.stalePaths);
    if (!ledgerResult.ok) {
      const status = ledgerResult.code === "workspace_upload_quota" ? 413 : ledgerResult.code === "upload_cleanup_in_progress" ? 409 : 400;
      return NextResponse.json({ error: ledgerResult.code === "workspace_upload_quota" ? "This workspace has reached its image storage limit." : ledgerResult.code === "upload_cleanup_in_progress" ? "This image upload is being cleaned up. Try again." : "Invalid image upload metadata." }, { status });
    }

    if (ledgerResult.status === "finalized") {
      return NextResponse.json({ ref, sha256: validated.sha256, mime: validated.mime, size: validated.size, reused: true }, { headers: { "cache-control": "private, no-store" } });
    }

    const existingObject = await service.storage.from(CUSTOMER_IMAGE_BUCKET).info(parsed.path);
    if (existingObject.data) {
      return NextResponse.json({ path: parsed.path, reservationId: ledgerResult.reservationId, alreadyUploaded: true }, { headers: { "cache-control": "private, no-store" } });
    }

    const upload = await service.storage.from(CUSTOMER_IMAGE_BUCKET).createSignedUploadUrl(parsed.path, { upsert: false });
    if (upload.error || !upload.data?.token) {
      await discardAndCleanup(service, ledgerResult.reservationId, access.access.workspaceId, id, parsed.path);
      console.error("Ad Studio media signed upload failed", { message: upload.error?.message ?? "missing token" });
      return NextResponse.json({ error: "We could not prepare this image upload." }, { status: 500 });
    }
    return NextResponse.json({ path: parsed.path, token: upload.data.token, reservationId: ledgerResult.reservationId }, { headers: { "cache-control": "private, no-store" } });
  }

  const claimed = await service.rpc("adstudio_claim_customer_image_finalize", {
    p_reservation_id: reservationId,
    p_workspace_id: access.access.workspaceId,
    p_ad_id: id,
    p_object_path: parsed.path,
    p_sha256: validated.sha256,
    p_mime_type: validated.mime,
    p_byte_size: validated.size,
  });
  const claimResult = asLedgerResult(claimed.data);
  if (claimed.error || !claimResult.ok) {
    const status = claimResult.code === "upload_cleanup_in_progress" ? 409 : 400;
    return NextResponse.json({ error: claimResult.code === "upload_cleanup_in_progress" ? "This image upload is being cleaned up. Try again." : "This image upload is no longer available." }, { status });
  }

  try {
    const bucket = service.storage.from(CUSTOMER_IMAGE_BUCKET);
    const info = await bucket.info(parsed.path);
    const infoSize = info.data?.size;
    const infoMime = typeof info.data?.contentType === "string" ? info.data.contentType.toLowerCase() : null;
    if (info.error || typeof infoSize !== "number" || infoSize > CUSTOMER_IMAGE_MAX_BYTES || infoSize !== validated.size || (infoMime && infoMime !== validated.mime)) {
      throw new CustomerImageValidationError("size", "Uploaded object metadata did not match the declared image.");
    }
    // Only download after Storage metadata has proved the object is within the
    // hard limit. This prevents an attacker from making finalize buffer a large
    // object before the byte-level integrity checks run.
    const downloaded = await bucket.download(parsed.path);
    if (downloaded.error || !downloaded.data) throw new Error(downloaded.error?.message ?? "image missing");
    const bytes = Buffer.from(await downloaded.data.arrayBuffer());
    if (bytes.length !== validated.size || imageSha256(bytes) !== validated.sha256) throw new Error("image hash mismatch");
    await validateCustomerImageBytes(bytes, validated.mime);
    const finalized = await service.rpc("adstudio_finalize_customer_image_upload", {
      p_reservation_id: reservationId,
      p_workspace_id: access.access.workspaceId,
      p_ad_id: id,
      p_object_path: parsed.path,
      p_sha256: validated.sha256,
      p_mime_type: validated.mime,
      p_byte_size: validated.size,
    });
    if (finalized.error || !asLedgerResult(finalized.data).ok) throw new CustomerImageValidationError("magic_bytes", "Upload reservation was not valid.");
    return NextResponse.json({ ref, sha256: validated.sha256, mime: validated.mime, size: bytes.length }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    // Only the reservation that successfully transitioned to the deleting
    // tombstone may remove bytes. A stale finalize request cannot affect a
    // newer reservation that reuses the content-addressed path.
    await discardAndCleanup(service, reservationId, access.access.workspaceId, id, parsed.path);
    const kind = error instanceof CustomerImageValidationError || error instanceof Error && /invalid|mismatch/i.test(error.message) ? "invalid" : "storage";
    console.error("Ad Studio media finalization failed", { kind });
    return NextResponse.json(
      { error: kind === "invalid" ? "This image could not be verified. Choose another image." : "We could not finish storing this image.", code: kind === "invalid" ? "image_invalid" : "image_storage_failed" },
      { status: kind === "invalid" ? 400 : 500 },
    );
  }
}

async function removeUploadedObject(supabase: SupabaseClient, path: string): Promise<boolean> {
  try {
    const result = await supabase.storage.from(CUSTOMER_IMAGE_BUCKET).remove([path]);
    if (result.error) {
      console.error("Ad Studio media cleanup failed", { message: result.error.message });
      return false;
    }
    return true;
  } catch (error) {
    console.error("Ad Studio media cleanup failed", { reason: error instanceof Error ? error.message : "unknown" });
    return false;
  }
}

async function discardAndCleanup(supabase: SupabaseClient, reservationId: string | null | undefined, workspaceId: string, adId: string, path: string): Promise<boolean> {
  const claimed = await discardUpload(supabase, reservationId, workspaceId, adId, path);
  if (!claimed) return false;
  const removed = await removeUploadedObject(supabase, path);
  if (!removed) return false;
  const completed = await supabase.rpc("adstudio_complete_customer_image_stale_cleanup", {
    p_reservation_id: reservationId,
    p_object_path: path,
  });
  if (completed.error || completed.data !== true) {
    console.error("Ad Studio customer image tombstone completion failed", { message: completed.error?.message ?? "claim no longer exists" });
    return false;
  }
  return true;
}

async function removeStaleObjects(supabase: SupabaseClient, entries: Array<{ id: string; path: string }> | undefined): Promise<void> {
  if (!entries?.length) return;
  for (const entry of entries) {
    try {
      const result = await supabase.storage.from(CUSTOMER_IMAGE_BUCKET).remove([entry.path]);
      if (result.error) {
        console.error("Ad Studio stale customer image cleanup failed", { message: result.error.message });
        continue;
      }
      const completed = await supabase.rpc("adstudio_complete_customer_image_stale_cleanup", {
        p_reservation_id: entry.id,
        p_object_path: entry.path,
      });
      if (completed.error || completed.data !== true) {
        console.error("Ad Studio stale customer image tombstone completion failed", { message: completed.error?.message ?? "claim no longer exists" });
      }
    } catch (error) {
      console.error("Ad Studio stale customer image cleanup failed", { reason: error instanceof Error ? error.message : "unknown" });
    }
  }
}

async function discardUpload(supabase: SupabaseClient, reservationId: string | null | undefined, workspaceId: string, adId: string, path: string): Promise<boolean> {
  if (!reservationId) return false;
  const result = await supabase.rpc("adstudio_discard_customer_image_upload", {
    p_reservation_id: reservationId,
    p_workspace_id: workspaceId,
    p_ad_id: adId,
    p_object_path: path,
  });
  if (result.error) console.error("Ad Studio customer image ledger cleanup failed", { message: result.error.message });
  return result.error ? false : result.data === true;
}

function asLedgerResult(value: unknown): { ok: boolean; code?: string; status?: string; reservationId?: string; stalePaths?: Array<{ id: string; path: string }> } {
  if (!value || typeof value !== "object") return { ok: false, code: "invalid_ledger_response" };
  const result = value as Record<string, unknown>;
  return {
    ok: result.ok === true,
    code: typeof result.code === "string" ? result.code : undefined,
    status: typeof result.status === "string" ? result.status : undefined,
    reservationId: typeof result.reservation_id === "string" ? result.reservation_id : undefined,
    stalePaths: Array.isArray(result.stale_paths)
      ? result.stale_paths.flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const candidate = entry as Record<string, unknown>;
          return typeof candidate.id === "string" && typeof candidate.path === "string" ? [{ id: candidate.id, path: candidate.path }] : [];
        })
      : undefined,
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validateMetadata(body: ImageBody):
  | { ok: true; sha256: string; mime: CustomerImageMime; size: number }
  | { ok: false; error: string } {
  const sha256 = typeof body.sha256 === "string" ? body.sha256.toLowerCase() : "";
  const mime = typeof body.mime === "string" ? body.mime.toLowerCase() as CustomerImageMime : null;
  const size = typeof body.size === "number" ? body.size : NaN;
  if (!/^[a-f0-9]{64}$/.test(sha256) || !mime || !CUSTOMER_MIMES.has(mime) || !Number.isInteger(size) || size <= 0 || size > CUSTOMER_IMAGE_MAX_BYTES) {
    return { ok: false, error: `Image must be PNG, JPEG, or WebP under ${Math.floor(CUSTOMER_IMAGE_MAX_BYTES / (1024 * 1024))} MB.` };
  }
  return { ok: true, sha256, mime, size };
}
