import { NextResponse, type NextRequest } from "next/server";

import { createAdStudioJobRun } from "@/modules/adstudio";
import { readJsonBody, requireAdStudioRequest } from "@/modules/adstudio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const { data, error } = await access.supabase
    .from("adstudio_job_runs")
    .select("*")
    .eq("workspace_id", access.access.workspaceId)
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({ jobs: data ?? [], warning: error?.message });
}

export async function POST(request: NextRequest) {
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<{ jobType?: "campaign.generate.strategy"; payload?: unknown }>(request);

  return NextResponse.json({
    job: createAdStudioJobRun({
      workspaceId: access.access.workspaceId,
      jobType: body.jobType ?? "campaign.generate.strategy",
      payload: body.payload ?? {},
    }),
  });
}
