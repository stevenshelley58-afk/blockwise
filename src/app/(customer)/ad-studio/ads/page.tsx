import { AdsLibrary } from "@/components/adstudio/ads-library";
import { loadAdStudioLibraryPage, type LibraryAdModel } from "@/lib/adstudio/library-read-model";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function AdsCollectionPage() {
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  let ads: LibraryAdModel[] = [];
  try {
    const page = await loadAdStudioLibraryPage({ supabase, workspaceId: access.workspaceId, kind: "ads", limit: 50 });
    ads = page.items.filter((item): item is LibraryAdModel => "adId" in item);
  } catch {
    // The client surface still provides a recoverable empty state if this optional read fails.
  }
  return <AdsLibrary ads={ads} />;
}
