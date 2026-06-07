"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { sanitizeUploadFileName } from "@/lib/upload/asset-file";

export async function uploadAdStudioMedia(input: {
  file: File;
  workspaceId: string;
  brandKitId: string;
}): Promise<{ src: string; storagePath: string }> {
  const supabase = createSupabaseBrowserClient();
  const safeName = sanitizeUploadFileName(input.file.name);
  const storagePath = `${input.workspaceId}/adstudio/${input.brandKitId}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage.from("workspace-artifacts").upload(storagePath, input.file);

  if (error) {
    throw new Error("We couldn't upload that image. Try another file.");
  }

  return {
    src: `/api/adstudio/media?path=${encodeURIComponent(storagePath)}`,
    storagePath,
  };
}
