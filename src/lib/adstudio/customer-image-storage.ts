import type { SupabaseClient } from "@supabase/supabase-js";
import { CustomerImageValidationError, validateCustomerImageBytes, validateCustomerImageDataUrl } from "./image-validation.ts";
import { buildCustomerImageRef, CUSTOMER_IMAGE_BUCKET, parseCustomerImageRef, type CustomerImageMime } from "./customer-image-ref.ts";
import { imageSha256 } from "./customer-image-hash.server.ts";

export class CustomerImageStorageError extends Error {
  readonly inputKey: string;
  readonly kind: "invalid" | "storage";
  constructor(inputKey: string, kind: "invalid" | "storage", message: string) {
    super(message);
    this.inputKey = inputKey;
    this.kind = kind;
  }
}

export async function storeCustomerImageBytes(input: {
  bytes: Buffer;
  declaredMime?: string;
  workspaceId: string;
  adId: string;
  supabase: SupabaseClient;
}): Promise<{ bytes: Buffer; ref: string; sha256: string; mime: CustomerImageMime }> {
  try {
    const sniffedMime = sniffMime(input.bytes);
    if (!sniffedMime || (input.declaredMime && input.declaredMime !== sniffedMime)) {
      throw new CustomerImageValidationError("magic_bytes", "Image bytes do not match the declared type.");
    }
    await validateCustomerImageBytes(input.bytes, sniffedMime);
    const sha256 = imageSha256(input.bytes);
    const ref = buildCustomerImageRef(input.workspaceId, input.adId, sha256, sniffedMime);
    const parsed = parseCustomerImageRef(ref, input.workspaceId, input.adId);
    if (!parsed) throw new Error("invalid generated ref");
    const upload = await input.supabase.storage.from(CUSTOMER_IMAGE_BUCKET).upload(parsed.path, input.bytes, {
      contentType: sniffedMime,
      upsert: true,
    });
    if (upload.error) {
      await removeCustomerImageObject(input.supabase, parsed.path);
      throw new Error(upload.error.message);
    }
    return { bytes: input.bytes, ref, sha256, mime: sniffedMime };
  } catch (error) {
    const reason = error instanceof CustomerImageValidationError ? error.reason : "storage";
    const kind = error instanceof CustomerImageValidationError || /invalid|mismatch/i.test(error instanceof Error ? error.message : "")
      ? "invalid"
      : "storage";
    console.error("Ad Studio customer image upload failed", { reason });
    throw new CustomerImageStorageError("image", kind, "Customer image could not be stored.");
  }
}

async function removeCustomerImageObject(supabase: SupabaseClient, path: string): Promise<void> {
  try {
    const result = await supabase.storage.from(CUSTOMER_IMAGE_BUCKET).remove([path]);
    if (result.error) console.error("Ad Studio customer image cleanup failed", { message: result.error.message });
  } catch (error) {
    console.error("Ad Studio customer image cleanup failed", { reason: error instanceof Error ? error.message : "unknown" });
  }
}

export async function resolveCustomerImageValues(
  sharedImageValues: Record<string, string>,
  workspaceId: string,
  adId: string,
  supabase: SupabaseClient,
  options?: { requireFinalizedLedger?: boolean },
): Promise<{ bytes: Record<string, Buffer>; refs: Record<string, string> }> {
  const bytesByKey: Record<string, Buffer> = {};
  const refs: Record<string, string> = {};
  for (const [inputKey, value] of Object.entries(sharedImageValues)) {
    try {
      if (value.startsWith("data:")) {
        const bytes = await validateCustomerImageDataUrl(value);
        const stored = await storeCustomerImageBytes({ bytes, workspaceId, adId, supabase });
        bytesByKey[inputKey] = stored.bytes;
        refs[inputKey] = stored.ref;
      } else {
        const parsed = parseCustomerImageRef(value, workspaceId, adId);
        if (!parsed) throw new Error("invalid image ref");
        if (options?.requireFinalizedLedger) {
          const ledger = await supabase
            .from("adstudio_customer_image_uploads")
            .select("id")
            .eq("workspace_id", workspaceId)
            .eq("ad_id", adId)
            .eq("object_path", parsed.path)
            .eq("sha256", parsed.sha256)
            .eq("mime_type", parsed.mime)
            .eq("status", "finalized")
            .maybeSingle();
          if (ledger.error || !ledger.data) throw new Error("image upload was not finalized");
        }
        const bucket = supabase.storage.from(CUSTOMER_IMAGE_BUCKET);
        const infoMethod = (bucket as unknown as { info?: (path: string) => Promise<{ data: { size?: number } | null; error: unknown }> }).info;
        if (infoMethod) {
          const info = await infoMethod.call(bucket, parsed.path);
          const reportedSize = info.data?.size;
          if (info.error || typeof reportedSize !== "number" || reportedSize > 10 * 1024 * 1024) throw new Error("image exceeds storage limit");
        }
        const downloaded = await bucket.download(parsed.path);
        if (downloaded.error || !downloaded.data) throw new Error(downloaded.error?.message ?? "image missing");
        const bytes = Buffer.from(await downloaded.data.arrayBuffer());
        if (imageSha256(bytes) !== parsed.sha256) throw new Error("image hash mismatch");
        await validateCustomerImageBytes(bytes, parsed.mime);
        bytesByKey[inputKey] = bytes;
        refs[inputKey] = value;
      }
    } catch (error) {
      const reason = error instanceof CustomerImageValidationError ? error.reason : "storage";
      const kind = error instanceof CustomerImageValidationError || /invalid|mismatch/i.test(error instanceof Error ? error.message : "") ? "invalid" : "storage";
      console.error("Ad Studio customer image storage failed", { inputKey, reason });
      throw new CustomerImageStorageError(inputKey, kind, "Customer image could not be stored or loaded.");
    }
  }
  return { bytes: bytesByKey, refs };
}

function sniffMime(bytes: Buffer): CustomerImageMime | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "image/jpeg";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}
