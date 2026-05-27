import { NextResponse, type NextRequest } from "next/server";

import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { listResearchSignals } from "@/lib/product/live-data";
import { getComplianceDemo } from "@/lib/product/workflow-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, {
    surface: "monitor",
    requestedWorkspaceId: request.nextUrl.searchParams.get("workspaceId"),
  });

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const signals = await listResearchSignals(supabase, access.access.workspaceId);

  return NextResponse.json({
    signals,
    competitorSignals: signals,
    complianceExamples: getComplianceDemo(),
  });
}
