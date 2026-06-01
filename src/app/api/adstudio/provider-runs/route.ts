import { NextResponse, type NextRequest } from "next/server";

import { requireAdStudioRequest } from "@/modules/adstudio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const { data, error } = await access.supabase
    .from("adstudio_provider_runs")
    .select("*")
    .eq("workspace_id", access.access.workspaceId)
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({ providerRuns: data ?? [], warning: error?.message });
}
