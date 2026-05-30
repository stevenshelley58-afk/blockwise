import { AdStudioWorkbench } from "@/components/adstudio/ad-studio-workbench";
import { PageHeading } from "@/components/page-heading";
import { getAdStudioDemoBundle } from "@/lib/adstudio/demo-data";
import { loadLiveAdStudioBundle } from "@/lib/adstudio/load-live-bundle";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

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
