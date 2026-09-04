import { AdsLibrary } from "@/components/adstudio/ads-library";
import { loadAdStudioLibraryPage, type LibraryAdModel } from "@/lib/adstudio/library-read-model";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function AdsCollectionPage() {
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  const page = await loadAdStudioLibraryPage({ supabase, workspaceId: access.workspaceId, kind: "ads", limit: 50 });
  const ads = page.items.filter((item): item is LibraryAdModel => "adId" in item);
  return <AdsLibrary ads={ads} />;
}
