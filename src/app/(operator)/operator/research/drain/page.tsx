import { ServiceRoleRequired } from "@/components/operator/service-role-required";
import { ResearchDrainDashboard } from "@/components/operator/research-drain-dashboard";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { loadResearchDrainStatus } from "@/lib/research/drain-status";
import { tryCreateResearchServiceClient } from "@/lib/research/service";

export const dynamic = "force-dynamic";

export default async function ResearchDrainPage() {
  await requirePageSurfaceAccess("operator");
  const supabase = tryCreateResearchServiceClient();

  if (!supabase) {
    return (
      <main className="operator-os">
        <div className="operator-os-main">
          <ServiceRoleRequired />
        </div>
      </main>
    );
  }

  const initialStatus = await loadResearchDrainStatus(supabase);

  return <ResearchDrainDashboard initialStatus={initialStatus} />;
}
