import { NextResponse, type NextRequest } from "next/server";

import { requireAdStudioRequest } from "@/lib/adstudio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECENT_JOB_WINDOW_MS = 15 * 60_000;

/**
 * Newest recent generation job for the workspace. The client uses this to
 * re-attach to an in-flight generation after its POST connection dropped
 * (deploy, Vercel timeout, flaky network) instead of dead-ending on an error.
 */
export async function GET(request: NextRequest) {
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const { data, error } = await access.supabase
    .from("adstudio_creative_jobs")
    .select("id,status,created_at")
    .eq("workspace_id", access.access.workspaceId)
    .gte("created_at", new Date(Date.now() - RECENT_JOB_WINDOW_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ job: data ?? null });
}
