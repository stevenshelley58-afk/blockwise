import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, requireAdStudioRequest } from "@/lib/adstudio/http";

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
    .from("adstudio_compliance_reports")
    .select("*")
    .eq("workspace_id", access.access.workspaceId)
    .eq("id", id)
    .maybeSingle();

  if (error) return errorResponse(error);
  if (!data) return NextResponse.json({ error: "Compliance report not found." }, { status: 404 });

  return NextResponse.json({ report: data });
}
