import { MediaLibrary, type LibraryAd, type LibraryAsset } from "@/components/adstudio/media-library";
import type { AssetRole } from "@/components/adstudio/asset-roles";
import { assetUrlForRow, mediaUrlForStoragePath, type AdStudioBrandAssetRow } from "@/lib/adstudio/assets";
import { creativeLibraryPreview } from "@/lib/adstudio/creative-preview";
import { isExampleBrandKitSourceUrl, rowToCreative } from "@/lib/adstudio/persistence";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function MediaLibraryPage() {
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  const workspaceId = access.workspaceId;

  const [assetRows, campaignRows, creativeRows, brandKitRows] = await Promise.all([
    supabase
      .from("adstudio_brand_assets")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }),
    supabase
      .from("adstudio_campaigns")
      .select("id, name, status")
      .eq("workspace_id", workspaceId)
      .neq("status", "archived"),
    supabase.from("adstudio_creatives").select("*").eq("workspace_id", workspaceId),
    supabase
      .from("adstudio_brand_kits")
      .select("id, source_url")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(10),
  ]);

  // Assets: skip demo/example sources, resolve a renderable URL for the rest.
  const assets: LibraryAsset[] = [];
  for (const row of (assetRows.data ?? []) as AdStudioBrandAssetRow[]) {
    if (isExampleBrandKitSourceUrl(typeof row.source_url === "string" ? row.source_url : "")) continue;
    const src = toRenderableSrc(workspaceId, assetUrlForRow(workspaceId, row));
    if (!src) continue;
    assets.push({
      id: String(row.id ?? `${assets.length}`),
      src,
      label: labelForAssetRow(row),
      type: String(row.asset_type ?? ""),
      role: roleForAssetType(String(row.asset_type ?? "")),
    });
  }

  // Ads: every creative that belongs to a non-archived campaign and has a preview.
  const campaignById = new Map(
    ((campaignRows.data ?? []) as Array<{ id: unknown; name: unknown }>).map((campaign) => [
      String(campaign.id),
      typeof campaign.name === "string" && campaign.name.trim() ? campaign.name : "Untitled ad",
    ]),
  );
  const ads: LibraryAd[] = [];
  for (const row of (creativeRows.data ?? []) as Array<Record<string, unknown>>) {
    const campaignId = String(row.campaign_id ?? "");
    const campaignName = campaignById.get(campaignId);
    if (!campaignName) continue; // archived or missing campaign
    const src = toRenderableSrc(workspaceId, creativeLibraryPreview(rowToCreative(row)));
    if (!src) continue;
    ads.push({
      creativeId: String(row.id ?? `${ads.length}`),
      campaignId,
      campaignName,
      src,
      format: String(row.format ?? ""),
    });
  }

  // Uploads attach to the workspace's most recent non-demo brand kit.
  const uploadBrandKit = ((brandKitRows.data ?? []) as Array<{ id: unknown; source_url: unknown }>).find(
    (kit) => !isExampleBrandKitSourceUrl(typeof kit.source_url === "string" ? kit.source_url : ""),
  );

  return (
    <MediaLibrary
      workspaceId={workspaceId}
      brandKitId={uploadBrandKit ? String(uploadBrandKit.id) : ""}
      assets={assets}
      ads={ads}
    />
  );
}

/** Resolve a bare workspace storage path to the media API; pass URLs through. */
function toRenderableSrc(workspaceId: string, src: string | null): string | null {
  if (!src) return null;
  if (/^(https?:|data:|\/)/i.test(src)) return src;
  return mediaUrlForStoragePath(workspaceId, src) ?? src;
}

function roleForAssetType(assetType: string): AssetRole {
  const type = assetType.toLowerCase();
  if (type === "logo" || type === "primary_logo") return "logo";
  if (type === "headshot" || type === "agent_headshot") return "person";
  if (type === "office_image" || type === "team_image") return "background";
  return "property";
}

function labelForAssetRow(row: AdStudioBrandAssetRow): string {
  const metadata =
    row.metadata_json && typeof row.metadata_json === "object" && !Array.isArray(row.metadata_json)
      ? (row.metadata_json as Record<string, unknown>)
      : {};
  const fileName = typeof metadata.fileName === "string" ? metadata.fileName.trim() : "";
  if (fileName) return fileName;

  const storagePath = typeof row.storage_path === "string" ? row.storage_path.trim() : "";
  if (storagePath) {
    const tail = storagePath.split("/").pop() ?? "";
    const name = tail.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, "");
    if (name) return name;
  }

  const type = String(row.asset_type ?? "").replace(/_/g, " ").trim();
  return type ? type.charAt(0).toUpperCase() + type.slice(1) : "Image";
}
