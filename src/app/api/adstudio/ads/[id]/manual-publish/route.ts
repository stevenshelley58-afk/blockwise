import { NextResponse, type NextRequest } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { ManualPublishError, createOrLoadManualPublishRequest, getManualPublishRequest } from "@/lib/adstudio/manual-publish";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> | { id: string } };

export async function GET(request: NextRequest, context: Context) {
  const bodyWorkspace = request.nextUrl.searchParams.get("workspaceId");
  const guard = await requireApiWorkspace(request, "adstudio", bodyWorkspace);
  if (!guard.ok) return guard.response;
  if (!guard.access.isOperator && !["owner", "admin"].includes(guard.access.role)) return NextResponse.json({ error: "Only a workspace owner or admin can request manual publishing." }, { status: 403 });
  const { id } = await Promise.resolve(context.params);
  try {
    const result = await getManualPublishRequest(createSupabaseServiceClient(), { workspaceId: guard.access.workspaceId, adId: id });
    return NextResponse.json({ request: result });
  } catch (error) { return manualError(error); }
}

export async function POST(request: NextRequest, context: Context) {
  const body = (await request.json().catch(() => ({}))) as { workspaceId?: unknown; notes?: unknown; mutationId?: unknown; publishSummary?: unknown; controls?: unknown };
  const requestedWorkspace = typeof body.workspaceId === "string" ? body.workspaceId : null;
  const guard = await requireApiWorkspace(request, "adstudio", requestedWorkspace);
  if (!guard.ok) return guard.response;
  if (!guard.access.isOperator && !["owner", "admin"].includes(guard.access.role)) return NextResponse.json({ error: "Only a workspace owner or admin can request manual publishing." }, { status: 403 });
  const { id } = await Promise.resolve(context.params);
  try {
    const result = await createOrLoadManualPublishRequest({ serviceSupabase: createSupabaseServiceClient(), workspaceId: guard.access.workspaceId, adId: id, mutationId: typeof body.mutationId === "string" ? body.mutationId : "", notes: typeof body.notes === "string" ? body.notes : null, publishSummary: body.publishSummary, controls: body.controls, actorProfileId: guard.access.userId });
    return NextResponse.json({ request: result }, { status: 201 });
  } catch (error) { return manualError(error); }
}

function manualError(error: unknown) {
  if (error instanceof ManualPublishError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  console.error("Manual publish request failed", error);
  return NextResponse.json({ error: "Manual publishing request failed." }, { status: 500 });
}
