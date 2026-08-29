import { createHash } from "node:crypto";

import { after } from "next/server";
import { NextResponse, type NextRequest } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { loadHomeDashboardData } from "@/lib/home/home-dashboard-data";
import { isMatchingEtag } from "@/lib/meta-monitor/reporting-snapshots";
import { queueReportingRefresh } from "@/lib/meta-monitor/reporting-refresh-queue";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guard = await requireApiWorkspace(request, "self_serve");
  if (!guard.ok) return guard.response;

  const model = await loadHomeDashboardData({
    supabase: guard.supabase,
    serviceSupabase: createSupabaseServiceClient(),
    workspaceId: guard.access.workspaceId,
    workspaceName: guard.access.workspaceName,
  });
  const etag = `"${createHash("sha256").update(JSON.stringify(model.safe)).digest("hex")}"`;
  if (model.reportingNeedsRefresh) {
    after(async () => {
      await queueReportingRefresh({
        workspaceId: guard.access.workspaceId,
        range: "last_30",
        reason: "stale_navigation",
      }).catch(() => undefined);
    });
  }
  const headers = {
    etag,
    "cache-control": "private, no-cache",
    "x-bw-read-model-generated-at": model.reportingGeneratedAt,
  };
  if (isMatchingEtag(request.headers.get("if-none-match"), etag)) {
    return new NextResponse(null, { status: 304, headers });
  }
  return NextResponse.json(model.safe, { headers });
}
