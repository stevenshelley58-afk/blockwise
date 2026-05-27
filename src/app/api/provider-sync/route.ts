import { NextRequest, NextResponse } from "next/server";

import { listProviderSyncSummaries, listReportingSnapshots } from "@/lib/providers/mock-adapters";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? "workspace_demo";
  const [sync, reporting] = await Promise.all([
    listProviderSyncSummaries(workspaceId),
    listReportingSnapshots(workspaceId),
  ]);

  return NextResponse.json({ workspaceId, sync, reporting });
}
