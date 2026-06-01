import { AdStudioWorkbench } from "@/ui/adstudio/ad-studio-workbench";
import { PageHeading } from "@/ui/page-heading";
import { getAdStudioDemoBundle } from "@/modules/adstudio/demo-data";
import { loadLiveAdStudioBundle } from "@/modules/adstudio/load-live-bundle";
import { requirePageSurfaceAccess } from "@/modules/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function AdStudioPage() {
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  const liveBundle = await loadLiveAdStudioBundle(supabase, access.workspaceId);
  const bundle = liveBundle ?? getAdStudioDemoBundle();
  const isLive = Boolean(liveBundle);

  return (
    <main className="content">
      <PageHeading
        eyebrow="AdStudio"
        title="Ad Studio"
        description={
          isLive
            ? "Your live workspace campaign. Generate, edit creative and copy, run compliance, and export - all saved to your workspace."
            : "Start here: generate a real-estate lead campaign from your brand kit. The sample below is a starter template - anything you generate saves to your workspace."
        }
      />
      <AdStudioWorkbench
        brandKit={bundle.brandKit}
        campaignPack={bundle.campaignPack}
        offers={bundle.offers}
        performance={bundle.performance}
      />
    </main>
  );
}
