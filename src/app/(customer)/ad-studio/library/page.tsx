import { StudioLibrary } from "@/components/adstudio/studio-library";
import { loadAdStudioLibraryPage, type LibraryAdModel, type LibraryAssetModel } from "@/lib/adstudio/library-read-model";
import { isExampleBrandKitSourceUrl } from "@/lib/adstudio/persistence";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const params = await searchParams;
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  const workspaceId = access.workspaceId;
  const [adsResult, assetsResult, kitsResult] = await Promise.allSettled([
    loadAdStudioLibraryPage({ supabase, workspaceId, kind: "ads", limit: 50 }),
    loadAdStudioLibraryPage({ supabase, workspaceId, kind: "assets", limit: 24 }),
    supabase.from("adstudio_brand_kits").select("id,source_url").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(10),
  ]);

  const ads = adsResult.status === "fulfilled"
    ? adsResult.value.items.filter((item): item is LibraryAdModel => "adId" in item)
    : [];
  const assetsPage = assetsResult.status === "fulfilled" ? assetsResult.value : { items: [], nextCursor: null };
  const assets = assetsPage.items.filter((item): item is LibraryAssetModel => "role" in item);
  const kits = kitsResult.status === "fulfilled" ? (kitsResult.value.data ?? []) as Array<{ id: unknown; source_url: unknown }> : [];
  const kit = kits.find((row) => !isExampleBrandKitSourceUrl(typeof row.source_url === "string" ? row.source_url : ""));

  return <StudioLibrary initialView={params.view === "assets" ? "assets" : "ads"} workspaceId={workspaceId} brandKitId={kit ? String(kit.id) : ""} ads={ads} assets={assets} nextAssetCursor={assetsPage.nextCursor} adsError={adsResult.status === "rejected"} assetsError={assetsResult.status === "rejected"} />;
}
