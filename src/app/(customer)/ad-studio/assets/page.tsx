import { MediaLibrary } from "@/components/adstudio/media-library";
import { loadAdStudioLibraryPage, type LibraryAssetModel } from "@/lib/adstudio/library-read-model";
import { isExampleBrandKitSourceUrl } from "@/lib/adstudio/persistence";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function AssetsPage() {
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  const workspaceId = access.workspaceId;
  const [assetsPage, kits] = await Promise.all([
    loadAdStudioLibraryPage({ supabase, workspaceId, kind: "assets", limit: 24 }),
    supabase.from("adstudio_brand_kits").select("id,source_url").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(10),
  ]);
  const kit = ((kits.data ?? []) as Array<{ id: unknown; source_url: unknown }>).find((row) => !isExampleBrandKitSourceUrl(typeof row.source_url === "string" ? row.source_url : ""));
  return <MediaLibrary workspaceId={workspaceId} brandKitId={kit ? String(kit.id) : ""} assets={assetsPage.items as LibraryAssetModel[]} ads={[]} nextAssetCursor={assetsPage.nextCursor} nextAdCursor={null} />;
}
