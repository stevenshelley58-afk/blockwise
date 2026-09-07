import { assetUrlForRow, type AdStudioBrandAssetRow } from "./assets.ts";
import { storagePathFromMediaSrc } from "./image-src.ts";
import { gallerySampleProxyUrl } from "./pack-gallery.ts";
import { createAdStudioMediaUrls } from "./media-urls.ts";
import { isExampleBrandKitSourceUrl } from "./persistence.ts";
import { adFormatLabel, deriveAdLibraryStatus, type AdLibraryStatus } from "./library-contract.ts";
export { adFormatLabel, deriveAdLibraryStatus } from "./library-contract.ts";

// Inlined from deleted asset-roles.ts
export type AssetRole = "property" | "person" | "logo" | "background";

export type LibraryAssetModel = {
  id: string;
  src: string;
  fullSrc: string;
  label: string;
  type: string;
  role: AssetRole;
  width: number | null;
  height: number | null;
  dimensionsLabel: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  usageCount: number | null;
};

export type LibraryAdModel = {
  adId: string;
  templateId: string;
  name: string;
  src: string | null;
  format: string;
  updatedAt: string | null;
  revisionId: string | null;
  revisionNumber: number | null;
  status: AdLibraryStatus;
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
  let revisionByAd = new Map<string, Record<string, unknown>>();
  let metaPlanByAd = new Map<string, Record<string, unknown>>();
  let mutationsByPlan = new Map<string, Array<Record<string, unknown>>>();
  if (input.kind === "ads") {
    const revisionIds = pageRows.map(row => typeof row.active_revision_id === "string" ? row.active_revision_id : "").filter(Boolean);
    const { data: revisions, error: revisionError } = revisionIds.length
      ? await input.supabase.from("ad_revisions").select("id,ad_id,revision_number,feed_png_path,story_png_path,created_at").eq("workspace_id", input.workspaceId).in("id", revisionIds)
      : { data: [], error: null };
    if (revisionError) throw new Error(revisionError.message);
    revisionByAd = new Map(((revisions ?? []) as Array<Record<string, unknown>>).map(r => [String(r.ad_id), r]));

    // The execution layer intentionally links its plan to the customer ad
    // identity through adstudio_campaign_id. Read it workspace-scoped and use
    // only an applied activation/pause mutation as state evidence.
    try {
      const { data: plans, error: planError } = pageRows.length
        ? await input.supabase.from("meta_publish_plans").select("id,adstudio_campaign_id,status,updated_at").eq("workspace_id", input.workspaceId).in("adstudio_campaign_id", pageRows.map((row) => String(row.id))).order("updated_at", { ascending: false })
        : { data: [], error: null };
      if (planError) throw new Error(planError.message);
      for (const plan of (plans ?? []) as Array<Record<string, unknown>>) {
        const adId = String(plan.adstudio_campaign_id);
        if (!metaPlanByAd.has(adId)) metaPlanByAd.set(adId, plan);
      }
      const planIds = [...metaPlanByAd.values()].map((plan) => String(plan.id)).filter(Boolean);
      if (planIds.length) {
        const { data: mutations, error: mutationError } = await input.supabase.from("meta_publish_plan_mutations").select("meta_publish_plan_id,action,status,updated_at").eq("workspace_id", input.workspaceId).in("meta_publish_plan_id", planIds).order("updated_at", { ascending: false });
        if (mutationError) throw new Error(mutationError.message);
        for (const mutation of (mutations ?? []) as Array<Record<string, unknown>>) {
          const planId = String(mutation.meta_publish_plan_id);
          mutationsByPlan.set(planId, [...(mutationsByPlan.get(planId) ?? []), mutation]);
        }
      }
    } catch {
      // A missing/temporarily unavailable execution-layer read must not make
      // saved ads disappear. They remain Saved until explicit evidence loads.
    }
  }

  if (input.kind === "assets") {
    for (const row of pageRows as AdStudioBrandAssetRow[]) {
      const raw = assetUrlForRow(input.workspaceId, row);
      const path = storagePathFromSource(input.workspaceId, raw);
      if (path) paths.add(path);
    }
  } else {
    for (const row of pageRows) {
      const revision = revisionByAd.get(String(row.id));
      const feedPath = typeof revision?.feed_png_path === "string" ? revision.feed_png_path : null;
      const storyPath = typeof revision?.story_png_path === "string" ? revision.story_png_path : null;
      const raw = feedPath ?? storyPath;
      const path = storagePathFromSource(input.workspaceId, raw);
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
        ...assetMetadata(row),
      });
    }
  } else {
    items = [];
    for (const row of pageRows) {
      const revision = revisionByAd.get(String(row.id));
      const metaPlan = metaPlanByAd.get(String(row.id));
      const feedPath = typeof revision?.feed_png_path === "string" ? revision.feed_png_path : null;
      const storyPath = typeof revision?.story_png_path === "string" ? revision.story_png_path : null;
      const raw = firstPreviewPath(revision);
      const path = storagePathFromSource(input.workspaceId, raw);
      const src = path ? (signed[path]?.grid ?? null) : null;
      const templateId = String(row.template_id ?? "");
      items.push({
        adId: String(row.id),
        templateId: String(row.template_id ?? ""),
        name: typeof row.name === "string" && row.name.trim() ? row.name : "Untitled ad",
        src: src ?? (templateId ? gallerySampleProxyUrl(templateId, "feed", String(row.id)) : null),
        format: adFormatLabel(Boolean(feedPath), Boolean(storyPath)),
        updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
        revisionId: typeof revision?.id === "string" ? revision.id : null,
        revisionNumber: typeof revision?.revision_number === "number" ? revision.revision_number : null,
        status: deriveAdLibraryStatus({
          publishStatus: metaPlan?.status,
          mutationActions: metaPlan ? mutationsByPlan.get(String(metaPlan.id)) : [],
          hasSavedRevision: Boolean(revision),
        }),
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

function firstPreviewPath(revision: Record<string, unknown> | undefined): string | null {
  if (typeof revision?.feed_png_path === "string") return revision.feed_png_path;
  if (typeof revision?.story_png_path === "string") return revision.story_png_path;
  return null;
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

function assetMetadata(row: AdStudioBrandAssetRow): Pick<LibraryAssetModel, "width" | "height" | "dimensionsLabel" | "createdAt" | "lastUsedAt" | "usageCount"> {
  const metadata = metadataForRow(row);
  const width = numberValue(metadata.width ?? metadata.imageWidth ?? row.width);
  const height = numberValue(metadata.height ?? metadata.imageHeight ?? row.height);
  const dimensions = metadata.dimensions;
  const dimensionsLabel = width && height
    ? `${width} × ${height}`
    : typeof dimensions === "string" && /^\d+\s*[x×]\s*\d+$/i.test(dimensions)
      ? dimensions.replace("x", " × ")
      : null;
  const lastUsedAt = stringValue(metadata.lastUsedAt ?? metadata.last_used_at ?? metadata.recentUseAt ?? metadata.usedAt);
  const usageCount = numberValue(metadata.usageCount ?? metadata.usage_count ?? metadata.usedInAds);
  return {
    width,
    height,
    dimensionsLabel,
    createdAt: stringValue(row.created_at),
    lastUsedAt,
    usageCount,
  };
}

function metadataForRow(row: AdStudioBrandAssetRow): Record<string, unknown> {
  return row.metadata_json && typeof row.metadata_json === "object" && !Array.isArray(row.metadata_json)
    ? row.metadata_json as Record<string, unknown>
    : {};
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
