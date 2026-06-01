import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/modules/adstudio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const { data, error } = await access.supabase
    .from("adstudio_creatives")
    .select("*")
    .eq("workspace_id", access.access.workspaceId)
    .eq("id", id)
    .maybeSingle();

  if (error) return errorResponse(error);
  if (!data) return NextResponse.json({ error: "Creative not found." }, { status: 404 });

  return NextResponse.json({ creative: data });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<Record<string, unknown>>(request);
  const { data, error } = await access.supabase
    .from("adstudio_creatives")
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq("workspace_id", access.access.workspaceId)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) return errorResponse(error);

  return NextResponse.json({ creative: data });
}
