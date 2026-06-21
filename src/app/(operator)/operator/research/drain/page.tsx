import { ServiceRoleRequired } from "@/components/operator/service-role-required";
import { ResearchDrainDashboard } from "@/components/operator/research-drain-dashboard";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { createOperatorSupabaseServiceClient } from "@/lib/operator/service-role";
import { loadResearchDrainStatus } from "@/lib/research/drain-status";

export const dynamic = "force-dynamic";

export default async function ResearchDrainPage() {
  await requirePageSurfaceAccess("operator");
  const supabase = createOperatorSupabaseServiceClient();

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
