import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, requireAdStudioRequest } from "@/modules/adstudio/http";

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
    .from("adstudio_campaign_variants")
    .select("*")
    .eq("workspace_id", access.access.workspaceId)
    .eq("campaign_id", id)
    .order("created_at", { ascending: false });

  if (error) return errorResponse(error);

  return NextResponse.json({ variants: data ?? [] });
}
