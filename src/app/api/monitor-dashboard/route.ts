import { NextResponse, type NextRequest } from "next/server";

import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { getMetaMonitorData } from "@/lib/meta-monitor/getMetaMonitorData";
import { parseMonitorRange } from "@/lib/monitor/dashboard-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

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
  const payload = await getMetaMonitorData({
    supabase,
    serviceSupabase,
    workspaceId: access.access.workspaceId,
    range: parseMonitorRange(request.nextUrl.searchParams.get("range")),
  });

  return NextResponse.json(payload);
}
