import { AdStudioWorkbench } from "@/components/adstudio/ad-studio-workbench";
import { PageHeading } from "@/components/page-heading";
import { getAdStudioDemoBundle } from "@/lib/adstudio/demo-data";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function AdStudioPage() {
  await requirePageSurfaceAccess("adstudio");
  const bundle = getAdStudioDemoBundle();

  return (
    <main className="content">
      <PageHeading
        eyebrow="AdStudio"
        title="Ad Studio"
        description="Generate real-estate lead campaigns from an approved brand kit, campaign brief, offer library, editable creative, platform copy, compliance review, and export pack."
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
