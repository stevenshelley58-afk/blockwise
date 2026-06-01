import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/modules/adstudio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<Record<string, unknown>>(request);
  const { data, error } = await access.supabase
    .from("adstudio_creatives")
    .insert({
      ...body,
      workspace_id: access.access.workspaceId,
      render_status: "draft",
    })
    .select("*")
    .maybeSingle();

  if (error) return errorResponse(error);

  return NextResponse.json({ creative: data }, { status: 201 });
}
