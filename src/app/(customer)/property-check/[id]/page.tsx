import { notFound } from "next/navigation";

import { PropertyCheckReport } from "@/components/property-check/property-check-report";
import { niche } from "@/config/niche";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { getPropertyCheck } from "@/lib/property-check/persistence";

export const dynamic = "force-dynamic";

export default async function PropertyCheckReportPage({ params }: { params: Promise<{ id: string }> }) {
  if (!niche.features.propertyCheck) notFound();
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
    <main className="mx-auto w-full max-w-[880px] px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16">
      <PropertyCheckReport check={check} />
    </main>
  );
}
