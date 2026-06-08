import type { AdStudioBrandKit } from "./types.ts";

export type AdStudioBrandAssetRow = {
  id?: unknown;
  asset_type?: unknown;
  source_url?: unknown;
  storage_path?: unknown;
  metadata_json?: unknown;
  created_at?: unknown;
};

export function mediaUrlForStoragePath(workspaceId: string, storagePath: string | null | undefined): string | null {
  const path = storagePath?.trim();
  if (!workspaceId || !path) return null;
  if (!path.startsWith(`${workspaceId}/`) || path.includes("..")) return null;
  return `/api/adstudio/media?path=${encodeURIComponent(path)}`;
}

export function assetUrlForRow(workspaceId: string, row: AdStudioBrandAssetRow): string | null {
  const sourceUrl = typeof row.source_url === "string" ? row.source_url.trim() : "";
  if (sourceUrl) return sourceUrl;
  return mediaUrlForStoragePath(workspaceId, typeof row.storage_path === "string" ? row.storage_path : null);
}

export function applyBrandAssetRows(brandKit: AdStudioBrandKit, rows: AdStudioBrandAssetRow[]): AdStudioBrandKit {
  const next: AdStudioBrandKit = {
    ...brandKit,
    logos: { ...brandKit.logos },
    assets: {
      headshots: [...brandKit.assets.headshots],
      officeImages: [...brandKit.assets.officeImages],
      listingImages: [...brandKit.assets.listingImages],
      socialProofImages: [...brandKit.assets.socialProofImages],
    },
  };

  for (const row of rows) {
    const url = assetUrlForRow(brandKit.workspaceId, row);
    if (!url) continue;

    const type = String(row.asset_type ?? "").toLowerCase();
    if (type === "logo" || type === "primary_logo") {
      next.logos.primaryLogoUrl = url;
    } else if (type === "headshot" || type === "agent_headshot") {
      pushUnique(next.assets.headshots, url);
    } else if (type === "office_image" || type === "team_image") {
      pushUnique(next.assets.officeImages, url);
    } else if (type === "listing_image" || type === "property_image" || type === "uploaded_asset") {
      pushUnique(next.assets.listingImages, url);
    } else if (type === "social_proof_image" || type === "testimonial_image") {
      pushUnique(next.assets.socialProofImages, url);
    }
  }

  return next;
}

export async function loadAdStudioBrandAssetRows(
  supabase: { from: (table: string) => any },
  workspaceId: string,
  brandKitId: string,
): Promise<AdStudioBrandAssetRow[]> {
  if (!workspaceId || !brandKitId) return [];
  const { data, error } = await supabase
    .from("adstudio_brand_assets")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("brand_kit_id", brandKitId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

function pushUnique(target: string[], value: string) {
  if (!target.includes(value)) target.push(value);
}
