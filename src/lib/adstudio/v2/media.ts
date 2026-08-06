// v2 render persistence (Track A/E): canonical server renders land in
// workspace-artifacts under <workspaceId>/adstudio/renders/. This is the
// upload helper Track H's cleanup renames clone-generation's upload into.

export async function persistAdDocRender(input: {
  supabase: {
    storage: {
      from(bucket: string): {
        upload(
          path: string,
          bytes: Uint8Array,
          options: { contentType: string; upsert: boolean },
        ): Promise<{ error: { message: string } | null }>;
      };
    };
  };
  workspaceId: string;
  bytes: Uint8Array;
  /** e.g. `${creativeId}-feed` — becomes ${workspaceId}/adstudio/renders/<name>.png */
  name: string;
}): Promise<string> {
  const storagePath = `${input.workspaceId}/adstudio/renders/${input.name}.png`;
  const { error } = await input.supabase.storage.from("workspace-artifacts").upload(storagePath, input.bytes, {
    contentType: "image/png",
    upsert: true,
  });
  if (error) {
    throw new Error(`Ad render could not be stored: ${error.message}`);
  }
  return storagePath;
}
