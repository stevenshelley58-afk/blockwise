import type { CreativeExportRender } from "./creative-export.ts";
import type { AdStudioCampaignPack } from "./types.ts";

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

/** Export the authoritative full-canvas clone directly from workspace storage. */
export async function renderStoredFlatCloneExports(
  supabase: any,
  workspaceId: string,
  pack: AdStudioCampaignPack,
): Promise<CreativeExportRender[]> {
  const renders: CreativeExportRender[] = [];
  for (const creative of pack.creatives) {
    const clone = creative.canvas.objects.length === 1
      && creative.canvas.objects[0]?.objectId === "template_clone_image"
      ? creative.canvas.objects[0]
      : null;
    if (!clone) continue;

    // Draft compaction from older clients can leave an empty `content` value
    // while the authoritative storage reference is still present in `assetId`.
    // Treat blank strings as absent so export always follows the saved clone.
    const storagePath = cloneStoragePath(clone.content?.trim() || clone.assetId?.trim() || "");
    if (!storagePath || !isWorkspaceStoragePath(storagePath, workspaceId)) {
      throw new Error("The approved clone render was not found.");
    }
    const { data, error } = await supabase.storage.from("workspace-artifacts").download(storagePath);
    if (error || !data) throw new Error("The approved clone render was not found.");

    const source = Buffer.from(await data.arrayBuffer());
    const { default: sharp } = await import("sharp");
    const normalized = await sharp(source)
      .resize(creative.canvas.width, creative.canvas.height, { fit: "cover", position: "centre" })
      .png()
      .toBuffer();
    const [png, jpeg] = await Promise.all([
      Promise.resolve(normalized),
      sharp(normalized).flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toBuffer(),
    ]);
    renders.push(
      flatCloneRender(creative, "image/png", png),
      flatCloneRender(creative, "image/jpeg", jpeg),
    );
  }
  return renders;
}

function cloneStoragePath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("/api/adstudio/media?")) return trimmed;
  return new URL(trimmed, "https://blockwise.invalid").searchParams.get("path");
}

function flatCloneRender(
  creative: AdStudioCampaignPack["creatives"][number],
  mimeType: CreativeExportRender["mimeType"],
  bytes: Buffer,
): CreativeExportRender {
  return {
    creativeId: creative.creativeId,
    variantId: creative.variantId,
    format: creative.format,
    width: creative.canvas.width,
    height: creative.canvas.height,
    mimeType,
    dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
  };
}
