import { NextResponse } from "next/server";

import { requireAdRadarOperator as requireOperator } from "@/lib/operator/auth";
import { loadResearchDrainStatus } from "@/lib/research/drain-status";
import { tryCreateResearchServiceClient } from "@/lib/research/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const supabase = tryCreateResearchServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "service_role_unavailable" }, { status: 501 });
  }

  try {
    const status = await loadResearchDrainStatus(supabase);
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "drain_status_unavailable" },
      { status: 500 },
    );
  }
}
