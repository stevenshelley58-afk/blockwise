import type { AdStudioBrandKit } from "./types.ts";

export const ADSTUDIO_EMBEDDED_ASSET_LIMIT = 24;

export type AdStudioBrandAssetRow = {
  id?: unknown;
  asset_type?: unknown;
  source_url?: unknown;
  storage_path?: unknown;
  metadata_json?: unknown;
  created_at?: unknown;
};

export type AdStudioMediaLibraryAsset = {
  id: string;
  src: string;
  label: string;
  type: string;
  role: "property" | "person" | "logo" | "background";
  ratio: "Image";
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

export function mediaLibraryAssetForRow(
  workspaceId: string,
  row: AdStudioBrandAssetRow,
): AdStudioMediaLibraryAsset | null {
  const src = assetUrlForRow(workspaceId, row);
  if (!src) return null;

  const type = String(row.asset_type ?? "");
  return {
    id: String(row.id ?? src),
    src,
    label: labelForAssetRow(row),
    type,
    role: roleForAssetType(type),
    ratio: "Image",
  };
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
  limit?: number,
): Promise<AdStudioBrandAssetRow[]> {
  if (!workspaceId || !brandKitId) return [];
  let query = supabase
    .from("adstudio_brand_assets")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("brand_kit_id", brandKitId)
    .order("created_at", { ascending: false });
  if (limit) query = query.limit(Math.max(1, limit));
  const { data, error } = await query;

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function loadAdStudioWorkspaceAssetRows(
  supabase: { from: (table: string) => any },
  workspaceId: string,
): Promise<AdStudioBrandAssetRow[]> {
  if (!workspaceId) return [];
  const { data, error } = await supabase
    .from("adstudio_brand_assets")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

function roleForAssetType(assetType: string): AdStudioMediaLibraryAsset["role"] {
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

function pushUnique(target: string[], value: string) {
  if (!target.includes(value)) target.push(value);
}
