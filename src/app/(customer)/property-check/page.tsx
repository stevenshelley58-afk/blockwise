import { PropertyCheckWorkspace } from "@/components/property-check/property-check-workspace";
import { PageHeading } from "@/components/page-heading";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { listPropertyChecks } from "@/lib/property-check/persistence";
import type { PropertyCheckRecord } from "@/lib/property-check/types";

export const dynamic = "force-dynamic";

export default async function PropertyCheckPage() {
  const { supabase, access } = await requirePageSurfaceAccess("property_check");
  let checks: PropertyCheckRecord[] = [];

  try {
    checks = await listPropertyChecks(supabase, access.workspaceId);
  } catch (error) {
    console.error("[property-check] initial load failed", { error: error instanceof Error ? error.message : "unknown" });
  }

  return (
    <main className="content property-check-page">
      <PageHeading
        eyebrow="Property Check"
        title="Know the property before the call"
        description="Run preliminary property signal checks before seller, buyer, investor, renovation, and subdivision conversations."
      />
      <PropertyCheckWorkspace initialChecks={checks} />
    </main>
  );
}
