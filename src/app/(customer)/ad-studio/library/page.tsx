import { MediaLibrary, type LibraryAd, type LibraryAsset } from "@/components/adstudio/media-library";
import {
  loadAdStudioWorkspaceAssetRows,
  mediaLibraryAssetForRow,
  mediaUrlForStoragePath,
} from "@/lib/adstudio/assets";
import { creativeLibraryPreview } from "@/lib/adstudio/creative-preview";
import { isExampleBrandKitSourceUrl, rowToCreative } from "@/lib/adstudio/persistence";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function MediaLibraryPage() {
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  const workspaceId = access.workspaceId;

  const [assetRows, campaignRows, creativeRows, brandKitRows] = await Promise.all([
    loadAdStudioWorkspaceAssetRows(supabase, workspaceId),
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
  for (const row of assetRows) {
    if (isExampleBrandKitSourceUrl(typeof row.source_url === "string" ? row.source_url : "")) continue;
    const asset = mediaLibraryAssetForRow(workspaceId, row);
    if (asset) assets.push(asset);
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

function toRenderableSrc(workspaceId: string, src: string | null): string | null {
  if (!src) return null;
  if (/^(https?:|data:|\/)/i.test(src)) return src;
  return mediaUrlForStoragePath(workspaceId, src) ?? src;
}
