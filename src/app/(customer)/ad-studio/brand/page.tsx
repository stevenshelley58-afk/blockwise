import { BrandStudio } from "@/components/adstudio/brand-studio";
import { getAdStudioDemoBundle } from "@/lib/adstudio/demo-data";
import { loadLiveAdStudioBundle } from "@/lib/adstudio/load-live-bundle";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function BrandStudioPage() {
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  const liveBundle = await loadLiveAdStudioBundle(supabase, access.workspaceId);
  const bundle = liveBundle ?? getAdStudioDemoBundle();

  return <BrandStudio brandKit={bundle.brandKit} />;
}
