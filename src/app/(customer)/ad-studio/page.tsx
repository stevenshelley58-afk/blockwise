import { AdStudioWorkbench } from "@/components/adstudio/ad-studio-workbench";
import { getAdStudioDemoBundle } from "@/lib/adstudio/demo-data";
import { loadLiveAdStudioBundle } from "@/lib/adstudio/load-live-bundle";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function AdStudioPage() {
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  const liveBundle = await loadLiveAdStudioBundle(supabase, access.workspaceId);
  const bundle = liveBundle ?? getAdStudioDemoBundle();

  return (
    <>
      <AdStudioWorkbench
        brandKit={bundle.brandKit}
        campaignPack={bundle.campaignPack}
        offers={bundle.offers}
        performance={bundle.performance}
      />
    </>
  );
}
