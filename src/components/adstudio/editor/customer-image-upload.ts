import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { downscaleImageForUpload } from "@/lib/upload/asset-file";
import { CUSTOMER_IMAGE_BUCKET } from "@/lib/adstudio/customer-image-ref";

const CUSTOMER_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function uploadCustomerImage(input: {
  file: File;
  adId: string;
  workspaceId: string;
}): Promise<{ ref: string; file: File }> {
  const file = await downscaleImageForUpload(input.file);
  const mime = file.type.toLowerCase();
  if (!CUSTOMER_IMAGE_TYPES.has(mime)) throw new Error("Choose a PNG, JPEG, or WebP image.");

  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const query = `?workspaceId=${encodeURIComponent(input.workspaceId)}`;
  const endpoint = `/api/adstudio/ads/${encodeURIComponent(input.adId)}/media${query}`;
  const metadata = { sha256, mime, size: file.size };
  const prepareResponse = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "prepare", ...metadata }),
  });
  const prepared = await prepareResponse.json().catch(() => ({})) as { path?: string; token?: string; ref?: string; reused?: boolean; alreadyUploaded?: boolean; reservationId?: string; error?: string };
  if (!prepareResponse.ok) throw new Error(prepared.error ?? "We could not prepare this image upload.");
  if (prepared.reused && prepared.ref) return { ref: prepared.ref, file };
  if (!prepared.path || !prepared.reservationId) throw new Error(prepared.error ?? "We could not prepare this image upload.");

  if (!prepared.alreadyUploaded) {
    if (!prepared.token) throw new Error(prepared.error ?? "We could not prepare this image upload.");
    const supabase = createSupabaseBrowserClient();
    const upload = await supabase.storage.from(CUSTOMER_IMAGE_BUCKET).uploadToSignedUrl(prepared.path, prepared.token, file, {
      contentType: mime,
      upsert: false,
    });
    if (upload.error) {
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "discard", reservationId: prepared.reservationId, ...metadata }),
      }).catch(() => undefined);
      throw new Error("We could not upload this image. Try another file.");
    }
  }

  const finalizeResponse = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation: "finalize", reservationId: prepared.reservationId, ...metadata }),
  });
  const finalized = await finalizeResponse.json().catch(() => ({})) as { ref?: string; error?: string };
  if (!finalizeResponse.ok || !finalized.ref) throw new Error(finalized.error ?? "We could not verify this image upload.");
  return { ref: finalized.ref, file };
}
