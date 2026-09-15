import { AdsLibrary } from "@/components/adbuilder/ads-library";
import { loadAdBuilderLibraryPage, type LibraryAdModel } from "@/lib/adbuilder/library-read-model";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function AdsCollectionPage() {
  const { supabase, access } = await requirePageSurfaceAccess("adbuilder");
  const page = await loadAdBuilderLibraryPage({ supabase, workspaceId: access.workspaceId, kind: "ads", limit: 50 });
  const ads = page.items.filter((item): item is LibraryAdModel => "adId" in item);
  return <AdsLibrary ads={ads} workspaceId={access.workspaceId} />;
}
