import { MediaLibrary } from "@/components/adstudio/media-library";
import {
  loadAdStudioLibraryPage,
  type LibraryAdModel,
  type LibraryAssetModel,
} from "@/lib/adstudio/library-read-model";
import { isExampleBrandKitSourceUrl } from "@/lib/adstudio/persistence";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

export async function MediaLibraryPage() {
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  const workspaceId = access.workspaceId;
  const [assetsPage, adsPage, brandKitRows] = await Promise.all([
    loadAdStudioLibraryPage({ supabase, workspaceId, kind: "assets", limit: 24 }),
    loadAdStudioLibraryPage({ supabase, workspaceId, kind: "ads", limit: 24 }),
    supabase
      .from("adstudio_brand_kits")
      .select("id, source_url")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(10),
  ]);
  const uploadBrandKit = ((brandKitRows.data ?? []) as Array<{ id: unknown; source_url: unknown }>).find(
    (kit) => !isExampleBrandKitSourceUrl(typeof kit.source_url === "string" ? kit.source_url : ""),
  );

  return (
    <MediaLibrary
      workspaceId={workspaceId}
      brandKitId={uploadBrandKit ? String(uploadBrandKit.id) : ""}
      assets={assetsPage.items as LibraryAssetModel[]}
      ads={adsPage.items as LibraryAdModel[]}
      nextAssetCursor={assetsPage.nextCursor}
      nextAdCursor={adsPage.nextCursor}
    />
  );
}

export default MediaLibraryPage;
