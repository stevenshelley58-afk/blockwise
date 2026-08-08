import type { CreativeExportRender } from "./creative-export.ts";
import { creativeDimensions, isLegacyCreative } from "./creative-preview.ts";
import type { AdStudioCampaignPack } from "./types.ts";
import { isAdDocInstanceShape } from "./v2/template-doc.ts";

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
    let storagePath: string | null;
    if (isAdDocInstanceShape(creative.canvas)) {
      storagePath = creative.canvas.format === "9:16"
        ? creative.canvas.renders?.story ?? null
        : creative.canvas.renders?.feed ?? null;
    } else {
      const clone = creative.canvas.objects.length === 1
        && creative.canvas.objects[0]?.objectId === "template_clone_image"
        ? creative.canvas.objects[0]
        : null;
      storagePath = clone
        ? cloneStoragePath(clone.content?.trim() || clone.assetId?.trim() || "")
        : null;
    }
    if (!storagePath && isLegacyCreative(creative)) continue;

    // V1 stores a flat clone; v2 stores the canonical deterministic render.
    if (!storagePath || !isWorkspaceStoragePath(storagePath, workspaceId)) {
      throw new Error("The approved ad render was not found.");
    }
    const { data, error } = await supabase.storage.from("workspace-artifacts").download(storagePath);
    if (error || !data) throw new Error("The approved ad render was not found.");

    const source = Buffer.from(await data.arrayBuffer());
    const { default: sharp } = await import("sharp");
    const dimensions = creativeDimensions(creative);
    const normalized = await sharp(source)
      .resize(dimensions.width, dimensions.height, { fit: "cover", position: "centre" })
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
    ...creativeDimensions(creative),
    mimeType,
    dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
  };
}
