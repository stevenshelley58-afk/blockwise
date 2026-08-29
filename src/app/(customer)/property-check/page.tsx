import { notFound } from "next/navigation";

import { PropertyCheckSearch } from "@/components/property-check/property-check-search";
import { niche } from "@/config/niche";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { listPropertyChecks } from "@/lib/property-check/persistence";
import type { PropertyCheckRecord } from "@/lib/property-check/types";

export const dynamic = "force-dynamic";

export default async function PropertyCheckPage() {
  if (!niche.features.propertyCheck) notFound();
  const { supabase, access } = await requirePageSurfaceAccess("property_check");
  let checks: PropertyCheckRecord[] = [];

  try {
    checks = await listPropertyChecks(supabase, access.workspaceId);
  } catch (error) {
    console.error("[property-check] initial load failed", { error: error instanceof Error ? error.message : "unknown" });
  }

  return (
    <main className="mx-auto w-full max-w-[1120px] px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16">
      <PropertyCheckSearch initialChecks={checks} />
    </main>
  );
}
