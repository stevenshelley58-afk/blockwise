import { NextResponse, type NextRequest } from "next/server";

import { requireWorkspaceAccess } from "@/modules/auth/workspace-access";
import { buildMonitorDashboardForWorkspace } from "@/modules/monitor/live-dashboard";
import { parseMonitorRange } from "@/modules/monitor/dashboard-data";
import { createSupabaseServerClient } from "@/modules/supabase/server";
import { createSupabaseServiceClient } from "@/modules/supabase/service";

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

  const serviceSupabase = createSupabaseServiceClient();
  const bundle = await buildMonitorDashboardForWorkspace({
    supabase,
    serviceSupabase,
    workspaceId: access.access.workspaceId,
    range: parseMonitorRange(request.nextUrl.searchParams.get("range")),
  });

  return NextResponse.json(bundle);
}
