import type { createSupabaseServerClient } from "@/lib/supabase/server";

import { ensureRasterReferenceImage } from "./rasterize-reference.ts";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// Vision models can only read images they can actually fetch. Uploaded Ad Studio
// media is served through an auth-gated proxy (`/api/adstudio/media?path=...`) from a
// private storage bucket, so it must be inlined as a data URL before it reaches a
// provider. `data:` and absolute http(s) URLs are already model-consumable.
//
// This must cover the full upload ceiling (8 MB; see AD_IMAGE_MAX_BYTES) so an
// in-policy photo is never silently dropped before reaching the model. New uploads
// are also downscaled in the browser, so this mainly backstops pre-existing and
// brand-kit assets. base64 of 8 MB (~11 MB) stays within the vision model's limit.
const MAX_INLINE_IMAGE_BYTES = 9_000_000;

export async function resolveAdStudioImageForModel(
  supabase: SupabaseServerClient,
  workspaceId: string,
  ref: string | undefined,
): Promise<string | undefined> {
  if (!ref) return undefined;
  if (ref.startsWith("data:image/")) {
    return /^data:image\/svg/i.test(ref) ? ensureRasterReferenceImage(ref) : ref;
  }
  if (/^https?:\/\//i.test(ref)) {
    return /\.svg(?:$|[?#])/i.test(ref) ? ensureRasterReferenceImage(ref) : ref;
  }

  const storagePath = mediaProxyPath(ref);
  if (!storagePath) return undefined;
  if (!storagePath.startsWith(`${workspaceId}/`) || storagePath.includes("..")) return undefined;

  const { data, error } = await supabase.storage.from("workspace-artifacts").download(storagePath);
  if (error || !data || data.size > MAX_INLINE_IMAGE_BYTES) return undefined;

  const buffer = Buffer.from(await data.arrayBuffer());
  const contentType = data.type || "image/jpeg";
  const dataUrl = `data:${contentType};base64,${buffer.toString("base64")}`;
  return /^image\/svg/i.test(contentType) ? ensureRasterReferenceImage(dataUrl) : dataUrl;
}

function mediaProxyPath(ref: string): string | undefined {
  if (!ref.startsWith("/api/adstudio/media?")) return undefined;
  const query = ref.split("?")[1] ?? "";
  const path = new URLSearchParams(query).get("path")?.trim();
  return path || undefined;
}
