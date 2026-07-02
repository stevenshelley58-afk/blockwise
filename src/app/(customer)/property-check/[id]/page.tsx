import { notFound } from "next/navigation";

import { PropertyCheckReport } from "@/components/property-check/property-check-report";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { getPropertyCheck } from "@/lib/property-check/persistence";

export const dynamic = "force-dynamic";

export default async function PropertyCheckReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, access } = await requirePageSurfaceAccess("property_check");

  const check = await getPropertyCheck(supabase, access.workspaceId, id).catch((error: unknown) => {
    console.error("[property-check] report load failed", { error: error instanceof Error ? error.message : "unknown" });
    return null;
  });

  if (!check) {
    notFound();
  }

  return (
    <main className="content property-check-page">
      <PropertyCheckReport check={check} />
    </main>
  );
}
