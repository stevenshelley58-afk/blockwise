import { NextRequest, NextResponse } from "next/server";

import { requireWorkspaceAccess } from "@/modules/auth/workspace-access";
import { parseMonitorRange, resolveMonitorDateRange, type MonitorProvider } from "@/modules/monitor/dashboard-data";
import {
  listProviderSyncSummariesForWorkspace,
  listReportingSnapshotsForWorkspace,
  syncProviderWorkspace,
} from "@/modules/providers/provider-sync";
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

  const [sync, reporting] = await Promise.all([
    listProviderSyncSummariesForWorkspace(supabase, access.access.workspaceId),
    listReportingSnapshotsForWorkspace(supabase, access.access.workspaceId),
  ]);

  return NextResponse.json({ workspaceId: access.access.workspaceId, sync, reporting });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as { provider?: MonitorProvider; workspaceId?: string; range?: string }));
  const provider = body.provider === "google" ? "google" : "meta";
  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, {
    surface: "monitor",
    requestedWorkspaceId: body.workspaceId ?? request.nextUrl.searchParams.get("workspaceId"),
  });

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const result = await syncProviderWorkspace({
    supabase,
    serviceSupabase: createSupabaseServiceClient(),
    workspaceId: access.access.workspaceId,
    provider,
    range: resolveMonitorDateRange(parseMonitorRange(body.range ?? request.nextUrl.searchParams.get("range"))),
  });

  return NextResponse.json(result, { status: result.status === "failed" ? 502 : 200 });
}
