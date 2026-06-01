import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, requireAdStudioRequest } from "@/lib/adstudio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request, "approve_ads");

  if (!access.ok) {
    return access.response;
  }

  const { data, error } = await access.supabase
    .from("adstudio_campaign_variants")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("workspace_id", access.access.workspaceId)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) return errorResponse(error);

  return NextResponse.json({ variant: data });
}
