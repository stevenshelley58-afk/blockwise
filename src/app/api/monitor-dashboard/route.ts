import { after, NextResponse, type NextRequest } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { queueReportingRefresh } from "@/lib/meta-monitor/reporting-refresh-queue";
import { isMatchingEtag, loadReportingSnapshot } from "@/lib/meta-monitor/reporting-snapshots";
import { parseMonitorRange } from "@/lib/monitor/dashboard-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guard = await requireApiWorkspace(request, "monitor");

  if (!guard.ok) return guard.response;
  const { supabase, access } = guard;
  const range = parseMonitorRange(request.nextUrl.searchParams.get("range"));
  const customRange = {
    since: request.nextUrl.searchParams.get("since"),
    until: request.nextUrl.searchParams.get("until"),
  };
  const reporting = await loadReportingSnapshot({
    supabase,
    workspaceId: access.workspaceId,
    range,
    customRange,
  });

  if (reporting.needsRefresh) {
    after(async () => {
      await queueReportingRefresh({
        workspaceId: access.workspaceId,
        range,
        customRange,
        reason: "stale_navigation",
      }).catch(() => undefined);
    });
  }

  if (isMatchingEtag(request.headers.get("if-none-match"), reporting.snapshot.etag)) {
    return new NextResponse(null, {
      status: 304,
      headers: snapshotHeaders(reporting.snapshot),
    });
  }

  return NextResponse.json(reporting.snapshot.payload, {
    headers: snapshotHeaders(reporting.snapshot),
  });
}

export async function POST(request: NextRequest) {
  const guard = await requireApiWorkspace(request, "monitor");

  if (!guard.ok) return guard.response;
  const range = parseMonitorRange(request.nextUrl.searchParams.get("range"));
  const customRange = {
    since: request.nextUrl.searchParams.get("since"),
    until: request.nextUrl.searchParams.get("until"),
  };
  const reporting = await loadReportingSnapshot({
    supabase: guard.supabase,
    workspaceId: guard.access.workspaceId,
    range,
    customRange,
  });

  after(async () => {
    await queueReportingRefresh({
      workspaceId: guard.access.workspaceId,
      range,
      customRange,
      reason: "manual",
    }).catch(() => undefined);
  });

  return NextResponse.json(reporting.snapshot.payload, {
    status: 202,
    headers: {
      ...snapshotHeaders(reporting.snapshot),
      "x-bw-refresh-queued": "1",
    },
  });
}

function snapshotHeaders(snapshot: {
  etag: string;
  generatedAt: string;
  staleAt: string;
}): Record<string, string> {
  return {
    etag: snapshot.etag,
    "cache-control": "private, no-cache",
    "x-bw-snapshot-generated-at": snapshot.generatedAt,
    "x-bw-snapshot-stale-at": snapshot.staleAt,
  };
}
