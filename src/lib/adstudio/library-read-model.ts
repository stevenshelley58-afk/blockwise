import { assetUrlForRow, type AdStudioBrandAssetRow } from "./assets.ts";
import { storagePathFromMediaSrc } from "./image-src.ts";
import { createAdStudioMediaUrls } from "./media-urls.ts";
import { isExampleBrandKitSourceUrl } from "./persistence.ts";

// Inlined from deleted asset-roles.ts
export type AssetRole = "property" | "person" | "logo" | "background";

// Stub: legacy creative-preview.ts deleted in Phase 1
function creativeLibraryPreview(_creative: unknown): string | null { return null; }

export type LibraryAssetModel = {
  id: string;
  src: string;
  fullSrc: string;
  label: string;
  type: string;
  role: AssetRole;
};

export type LibraryAdModel = {
  creativeId: string;
  campaignId: string;
  campaignName: string;
  src: string;
  format: string;
};

type QueryClient = {
  from: (table: string) => any;
  storage: Parameters<typeof createAdStudioMediaUrls>[0]["supabase"]["storage"];
};

type Cursor = { orderAt: string; id: string };

export async function loadAdStudioLibraryPage(input: {
  supabase: QueryClient;
  workspaceId: string;
  kind: "assets" | "ads";
  limit?: number;
  cursor?: string | null;
  updatedAfter?: string | null;
}): Promise<{
  items: Array<LibraryAssetModel | LibraryAdModel>;
  nextCursor: string | null;
}> {
  const limit = Math.min(50, Math.max(1, input.limit ?? 24));
  const cursor = decodeCursor(input.cursor);
  const orderColumn = input.kind === "assets" ? "created_at" : "updated_at";
  let query = input.supabase
    .from(input.kind === "assets" ? "adstudio_brand_assets" : "adstudio_creatives")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .order(orderColumn, { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (cursor) {
    query = query.or(
      `${orderColumn}.lt.${cursor.orderAt},and(${orderColumn}.eq.${cursor.orderAt},id.lt.${cursor.id})`,
    );
  }
  if (input.updatedAfter) query = query.gt(orderColumn, input.updatedAfter);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const paths = new Set<string>();

  if (input.kind === "assets") {
    for (const row of pageRows as AdStudioBrandAssetRow[]) {
      const raw = assetUrlForRow(input.workspaceId, row);
      const path = storagePathFromSource(input.workspaceId, raw);
      if (path) paths.add(path);
    }
  } else {
    for (const row of pageRows) {
      const path = storagePathFromSource(
        input.workspaceId,
        creativeLibraryPreview(row),
      );
      if (path) paths.add(path);
    }
  }
  const signed =
    paths.size > 0
      ? await createAdStudioMediaUrls({
          supabase: input.supabase,
          workspaceId: input.workspaceId,
          paths: [...paths],
        })
      : {};

  let items: Array<LibraryAssetModel | LibraryAdModel>;
  if (input.kind === "assets") {
    items = [];
    for (const row of pageRows as AdStudioBrandAssetRow[]) {
      if (isExampleBrandKitSourceUrl(typeof row.source_url === "string" ? row.source_url : "")) continue;
      const raw = assetUrlForRow(input.workspaceId, row);
      const path = storagePathFromSource(input.workspaceId, raw);
      const src = path ? signed[path]?.grid : raw;
      const fullSrc = (path ? signed[path]?.full : raw) ?? src;
      if (!src || !fullSrc) continue;
      items.push({
        id: String(row.id ?? items.length),
        src,
        fullSrc,
        label: labelForAssetRow(row),
        type: String(row.asset_type ?? ""),
        role: roleForAssetType(String(row.asset_type ?? "")),
      });
    }
  } else {
    const campaignIds = [...new Set(pageRows.map((row) => String(row.campaign_id ?? "")).filter(Boolean))];
    const { data: campaigns, error: campaignError } = campaignIds.length
      ? await input.supabase
          .from("adstudio_campaigns")
          .select("id,name,status")
          .eq("workspace_id", input.workspaceId)
          .in("id", campaignIds)
          .neq("status", "archived")
      : { data: [], error: null };
    if (campaignError) throw new Error(campaignError.message);
    const campaignById = new Map(
      ((campaigns ?? []) as Array<{ id: unknown; name: unknown }>).map((campaign) => [
        String(campaign.id),
        typeof campaign.name === "string" && campaign.name.trim() ? campaign.name : "Untitled ad",
      ]),
    );
    items = [];
    for (const row of pageRows) {
      const campaignId = String(row.campaign_id ?? "");
      const campaignName = campaignById.get(campaignId);
      if (!campaignName) continue;
      const raw = creativeLibraryPreview(row);
      const path = storagePathFromSource(input.workspaceId, raw);
      const src = path ? signed[path]?.grid : raw;
      if (!src) continue;
      items.push({
        creativeId: String(row.id ?? items.length),
        campaignId,
        campaignName,
        src,
        format: String(row.format ?? ""),
      });
    }
  }

  const lastRow = pageRows.at(-1);
  const lastOrderAt = lastRow?.[orderColumn];
  const lastId = lastRow?.id;
  return {
    items,
    nextCursor:
      hasMore && typeof lastOrderAt === "string" && typeof lastId === "string"
        ? Buffer.from(JSON.stringify({ orderAt: lastOrderAt, id: lastId } satisfies Cursor)).toString("base64url")
        : null,
  };
}

function decodeCursor(value: string | null | undefined): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<Cursor>;
    return typeof parsed.orderAt === "string" && typeof parsed.id === "string"
      ? { orderAt: parsed.orderAt, id: parsed.id }
      : null;
  } catch {
    return null;
  }
}

function storagePathFromSource(workspaceId: string, src: string | null): string | null {
  if (!src) return null;
  if (src.startsWith(`${workspaceId}/`) && !src.includes("..")) return src;
  const path = storagePathFromMediaSrc(src);
  return path?.startsWith(`${workspaceId}/`) && !path.includes("..") ? path : null;
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
  const tail = storagePath.split("/").pop() ?? "";
  const name = tail.replace(/^[0-9a-f-]{36}-/i, "");
  if (name) return name;
  const type = String(row.asset_type ?? "").replace(/_/g, " ").trim();
  return type ? type.charAt(0).toUpperCase() + type.slice(1) : "Image";
}
