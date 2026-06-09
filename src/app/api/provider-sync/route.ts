import { NextRequest, NextResponse } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { GOOGLE_ADS_ENABLED } from "@/lib/config/feature-flags";
import { parseMonitorRange, resolveMonitorDateRange, type MonitorProvider } from "@/lib/monitor/dashboard-data";
import {
  listProviderSyncSummariesForWorkspace,
  listReportingSnapshotsForWorkspace,
  syncProviderWorkspace,
} from "@/lib/providers/provider-sync";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guard = await requireApiWorkspace(request, "monitor");

  if (!guard.ok) return guard.response;
  const { supabase, access } = guard;

  const [sync, reporting] = await Promise.all([
    listProviderSyncSummariesForWorkspace(supabase, access.workspaceId),
    listReportingSnapshotsForWorkspace(supabase, access.workspaceId),
  ]);

  return NextResponse.json({ workspaceId: access.workspaceId, sync, reporting });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as { provider?: MonitorProvider; workspaceId?: string; range?: string }));
  // Google Ads is parked for the Meta-only v1. See src/lib/config/feature-flags.ts.
  const provider = GOOGLE_ADS_ENABLED && body.provider === "google" ? "google" : "meta";
  const guard = await requireApiWorkspace(request, "monitor", body.workspaceId ?? request.nextUrl.searchParams.get("workspaceId"));

  if (!guard.ok) return guard.response;
  const { supabase, access } = guard;

  const result = await syncProviderWorkspace({
    supabase,
    serviceSupabase: createSupabaseServiceClient(),
    workspaceId: access.workspaceId,
    provider,
    range: resolveMonitorDateRange(parseMonitorRange(body.range ?? request.nextUrl.searchParams.get("range"))),
  });

  return NextResponse.json(result, { status: result.status === "failed" ? 502 : 200 });
}
