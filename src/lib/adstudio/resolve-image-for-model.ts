import type { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// Vision models can only read images they can actually fetch. Uploaded Ad Studio
// media is served through an auth-gated proxy (`/api/adstudio/media?path=...`) from a
// private storage bucket, so it must be inlined as a data URL before it reaches a
// provider. `data:` and absolute http(s) URLs are already model-consumable.
const MAX_INLINE_IMAGE_BYTES = 6_000_000;

export async function resolveAdStudioImageForModel(
  supabase: SupabaseServerClient,
  workspaceId: string,
  ref: string | undefined,
): Promise<string | undefined> {
  if (!ref) return undefined;
  if (ref.startsWith("data:image/")) return ref;
  if (/^https?:\/\//i.test(ref)) return ref;

  const storagePath = mediaProxyPath(ref);
  if (!storagePath) return undefined;
  if (!storagePath.startsWith(`${workspaceId}/`) || storagePath.includes("..")) return undefined;

  const { data, error } = await supabase.storage.from("workspace-artifacts").download(storagePath);
  if (error || !data || data.size > MAX_INLINE_IMAGE_BYTES) return undefined;

  const buffer = Buffer.from(await data.arrayBuffer());
  const contentType = data.type || "image/jpeg";
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

function mediaProxyPath(ref: string): string | undefined {
  if (!ref.startsWith("/api/adstudio/media?")) return undefined;
  const query = ref.split("?")[1] ?? "";
  const path = new URLSearchParams(query).get("path")?.trim();
  return path || undefined;
}
