import { assetUrlForRow, type AdStudioBrandAssetRow } from "./assets.ts";
import { storagePathFromMediaSrc } from "./image-src.ts";
import { createAdStudioMediaUrls } from "./media-urls.ts";
import { isExampleBrandKitSourceUrl } from "./persistence.ts";

// Inlined from deleted asset-roles.ts
export type AssetRole = "property" | "person" | "logo" | "background";

export type LibraryAssetModel = {
  id: string;
  src: string;
  fullSrc: string;
  label: string;
  type: string;
  role: AssetRole;
};

export type LibraryAdModel = {
  adId: string;
  templateId: string;
  name: string;
  src: string;
  revisionNumber: number;
  updatedAt: string;
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
    .from(input.kind === "assets" ? "adstudio_brand_assets" : "ad_customer_ads")
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
  const revisionById = new Map<string, { ad_id: string; revision_number: number; feed_png_path: string | null }>();
  const templateNameById = new Map<string, string>();

  if (input.kind === "assets") {
    for (const row of pageRows as AdStudioBrandAssetRow[]) {
      const raw = assetUrlForRow(input.workspaceId, row);
      const path = storagePathFromSource(input.workspaceId, raw);
      if (path) paths.add(path);
    }
  } else {
    const revisionIds = [...new Set(pageRows.map(row => String(row.active_revision_id ?? "")).filter(Boolean))];
    const templateIds = [...new Set(pageRows.map(row => String(row.template_id ?? "")).filter(Boolean))];
    const [revisionsResult, templatesResult] = await Promise.all([
      revisionIds.length
        ? input.supabase.from("ad_revisions").select("id,ad_id,revision_number,feed_png_path").eq("workspace_id", input.workspaceId).in("id", revisionIds)
        : Promise.resolve({ data: [], error: null }),
      templateIds.length
        ? input.supabase.from("ad_templates").select("template_id,template_json").in("template_id", templateIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (revisionsResult.error) throw new Error(revisionsResult.error.message);
    if (templatesResult.error) throw new Error(templatesResult.error.message);
    for (const revision of (revisionsResult.data ?? []) as Array<Record<string, unknown>>) {
      const id = String(revision.id ?? "");
      const adId = String(revision.ad_id ?? "");
      const feedPath = typeof revision.feed_png_path === "string" ? revision.feed_png_path : null;
      if (!id || !adId) continue;
      revisionById.set(id, {
        ad_id: adId,
        revision_number: typeof revision.revision_number === "number" ? revision.revision_number : 0,
        feed_png_path: feedPath,
      });
      const path = storagePathFromSource(input.workspaceId, feedPath);
      if (path) paths.add(path);
    }
    for (const template of (templatesResult.data ?? []) as Array<Record<string, unknown>>) {
      const templateId = String(template.template_id ?? "");
      const json = template.template_json && typeof template.template_json === "object" && !Array.isArray(template.template_json)
        ? template.template_json as Record<string, unknown>
        : {};
      const metadata = json.metadata && typeof json.metadata === "object" && !Array.isArray(json.metadata)
        ? json.metadata as Record<string, unknown>
        : {};
      if (templateId) templateNameById.set(templateId, typeof metadata.title === "string" && metadata.title.trim() ? metadata.title : templateId);
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
    items = [];
    for (const row of pageRows) {
      const adId = String(row.id ?? "");
      const activeRevisionId = String(row.active_revision_id ?? "");
      const revision = revisionById.get(activeRevisionId);
      const templateId = String(row.template_id ?? "");
      if (!adId || !revision?.feed_png_path || revision.ad_id !== adId || !templateId) continue;
      const path = storagePathFromSource(input.workspaceId, revision.feed_png_path);
      const src = path ? signed[path]?.full : null;
      if (!src) continue;
      items.push({
        adId,
        templateId,
        name: templateNameById.get(templateId) ?? templateId,
        src,
        revisionNumber: revision.revision_number,
        updatedAt: typeof row.updated_at === "string" ? row.updated_at : "",
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
