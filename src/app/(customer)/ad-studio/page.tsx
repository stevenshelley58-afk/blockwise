import { AdStudioWorkbench } from "@/components/adstudio/ad-studio-workbench";
import { getAdStudioDemoBundle } from "@/lib/adstudio/demo-data";
import { loadLiveAdStudioBundle } from "@/lib/adstudio/load-live-bundle";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

import { SampleBanner } from "./sample-banner";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function isFirstRunParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.includes("1") : value === "1";
}

export default async function AdStudioPage({ searchParams }: { searchParams?: SearchParams }) {
  const params = searchParams ? await searchParams : {};
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  const liveBundle = await loadLiveAdStudioBundle(supabase, access.workspaceId);
  const isSample = liveBundle === null;
  const bundle = liveBundle ?? getAdStudioDemoBundle();

  return (
    <>
      {isSample && <SampleBanner />}
      <AdStudioWorkbench
        workspaceId={access.workspaceId}
        brandKit={bundle.brandKit}
        campaignPack={bundle.campaignPack}
        offers={bundle.offers}
        performance={bundle.performance}
        firstRun={isFirstRunParam(params.first)}
      />
    </>
  );
}
