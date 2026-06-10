import { NextResponse, type NextRequest } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { getMetaMonitorData } from "@/lib/meta-monitor/getMetaMonitorData";
import { parseMonitorRange } from "@/lib/monitor/dashboard-data";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guard = await requireApiWorkspace(request, "monitor");

  if (!guard.ok) return guard.response;
  const { supabase, access } = guard;

  const serviceSupabase = createSupabaseServiceClient();
  const payload = await getMetaMonitorData({
    supabase,
    serviceSupabase,
    workspaceId: access.workspaceId,
    range: parseMonitorRange(request.nextUrl.searchParams.get("range")),
  });

  return NextResponse.json(payload);
}
