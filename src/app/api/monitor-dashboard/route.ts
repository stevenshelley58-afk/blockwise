import { NextResponse, type NextRequest } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { getResultsPayload } from "@/lib/meta-monitor/getResultsPayload";
import { parseMonitorRange } from "@/lib/monitor/dashboard-data";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guard = await requireApiWorkspace(request, "monitor");

  if (!guard.ok) return guard.response;
  const { supabase, access } = guard;

  const serviceSupabase = createSupabaseServiceClient();
  const payload = await getResultsPayload({
    supabase,
    serviceSupabase,
    workspaceId: access.workspaceId,
    range: parseMonitorRange(request.nextUrl.searchParams.get("range")),
    customRange: {
      since: request.nextUrl.searchParams.get("since"),
      until: request.nextUrl.searchParams.get("until"),
    },
  });

  return NextResponse.json(payload);
}
