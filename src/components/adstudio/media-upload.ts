"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { downscaleImageForUpload, sanitizeUploadFileName } from "@/lib/upload/asset-file";

export async function uploadAdStudioMedia(input: {
  file: File;
  workspaceId: string;
  brandKitId: string;
}): Promise<{ src: string; storagePath: string }> {
  const supabase = createSupabaseBrowserClient();
  // Downscale big photos before they hit the wire: faster upload, and small
  // enough that the vision model always receives the image (see MAX_INLINE_IMAGE_BYTES).
  const uploadFile = await downscaleImageForUpload(input.file);
  const safeName = sanitizeUploadFileName(uploadFile.name);
  const storagePath = `${input.workspaceId}/adstudio/${input.brandKitId}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from("workspace-artifacts").upload(storagePath, uploadFile);

  if (error) {
    throw new Error("We couldn't upload that image. Try another file.");
  }

  const response = await fetch(`/api/adstudio/brand-kits/${input.brandKitId}/assets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      assetType: "listing_image",
      storagePath,
      fileName: input.file.name,
      contentType: uploadFile.type,
      size: uploadFile.size,
    }),
  });

  if (!response.ok) {
    throw new Error("We uploaded the image but couldn't attach it to your workspace.");
  }

  return {
    src: `/api/adstudio/media?path=${encodeURIComponent(storagePath)}`,
    storagePath,
  };
}
