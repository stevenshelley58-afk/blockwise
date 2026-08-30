"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { VideoAsset } from "@/lib/adstudio/video/types";

const MAX_BYTES = 500 * 1024 * 1024;
const MIME_TYPES = ["video/mp4", "video/webm"] as const;

export async function uploadAdStudioVideo(input: { file: File; workspaceId: string; projectId: string; onProgress?: (message: string) => void }): Promise<VideoAsset> {
  const mimeType = input.file.type.toLowerCase();
  if (!(MIME_TYPES as readonly string[]).includes(mimeType)) throw new Error("Choose an MP4 or WebM video.");
  if (input.file.size <= 0 || input.file.size > MAX_BYTES) throw new Error("Videos must be smaller than 500 MB.");
  input.onProgress?.("Checking video metadata…");
  const sha256 = await digest(input.file);
  const media = await readVideoMetadata(input.file);
  const metadata = { sha256, mimeType, byteSize: input.file.size, durationMs: media.durationMs, width: media.width, height: media.height, provenance: { source: "adstudio_video_upload" }, rights: {}, consent: {} };
  const endpoint = `/api/adstudio/videos/${encodeURIComponent(input.projectId)}/media`;
  const preparedResponse = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "prepare", ...metadata }) });
  const prepared = await preparedResponse.json().catch(() => ({})) as { assetId?: string; path?: string; token?: string; reused?: boolean; error?: string };
  if (!preparedResponse.ok || !prepared.assetId || !prepared.path) throw new Error(prepared.error ?? "We could not prepare this video upload.");
  if (!prepared.reused) {
    if (!prepared.token) throw new Error(prepared.error ?? "We could not prepare this video upload.");
    input.onProgress?.("Uploading video…");
    const supabase = createSupabaseBrowserClient();
    const upload = await supabase.storage.from("adstudio-videos").uploadToSignedUrl(prepared.path, prepared.token, input.file, { contentType: mimeType, upsert: false });
    if (upload.error) throw new Error("We could not upload this video. Try another file.");
  }
  input.onProgress?.("Verifying upload…");
  const finalizedResponse = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "finalize", assetId: prepared.assetId, ...metadata }) });
  const finalized = await finalizedResponse.json().catch(() => ({})) as { id?: string; objectPath?: string; error?: string };
  if (!finalizedResponse.ok || !finalized.id || !finalized.objectPath) throw new Error(finalized.error ?? "We could not verify this video upload.");
  return { id: finalized.id, kind: "video", url: `storage://adstudio-videos/${finalized.objectPath}` };
}

async function digest(file: File): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readVideoMetadata(file: File): Promise<{ durationMs: number | null; width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve({ durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : null, width: video.videoWidth || null, height: video.videoHeight || null }); };
    video.onerror = () => { URL.revokeObjectURL(url); resolve({ durationMs: null, width: null, height: null }); };
    video.src = url;
  });
}
