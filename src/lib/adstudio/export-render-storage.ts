import type { CreativeExportRender } from "./creative-export.ts";

export async function hydrateStoredCreativeExportRenders(
  supabase: any,
  workspaceId: string,
  renders: CreativeExportRender[] | undefined,
): Promise<CreativeExportRender[] | undefined> {
  if (!renders?.length) return renders;

  const hydrated: CreativeExportRender[] = [];
  for (const render of renders) {
    if (render.dataUrl) {
      hydrated.push(render);
      continue;
    }

    const storagePath = render.storagePath?.trim();
    if (!storagePath) {
      hydrated.push(render);
      continue;
    }

    if (!isWorkspaceStoragePath(storagePath, workspaceId)) {
      throw new Error("Creative export render was not found.");
    }

    const { data, error } = await supabase.storage.from("workspace-artifacts").download(storagePath);
    if (error || !data) {
      throw new Error("Creative export render was not found.");
    }

    const bytes = Buffer.from(await data.arrayBuffer());
    hydrated.push({
      ...render,
      dataUrl: `data:${render.mimeType};base64,${bytes.toString("base64")}`,
    });
  }

  return hydrated;
}

function isWorkspaceStoragePath(path: string, workspaceId: string): boolean {
  return Boolean(workspaceId) && path.startsWith(`${workspaceId}/`) && !path.includes("..");
}
