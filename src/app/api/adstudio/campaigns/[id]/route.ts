import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";

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

  const [{ data: campaign, error }, { data: variants }, { data: creatives }, { data: copy }, { data: compliance }] =
    await Promise.all([
      access.supabase.from("adstudio_campaigns").select("*").eq("workspace_id", access.access.workspaceId).eq("id", id).maybeSingle(),
      access.supabase.from("adstudio_campaign_variants").select("*").eq("workspace_id", access.access.workspaceId).eq("campaign_id", id),
      access.supabase.from("adstudio_creatives").select("*").eq("workspace_id", access.access.workspaceId).eq("campaign_id", id),
      access.supabase.from("adstudio_platform_copy").select("*").eq("workspace_id", access.access.workspaceId).eq("campaign_id", id),
      access.supabase.from("adstudio_compliance_reports").select("*").eq("workspace_id", access.access.workspaceId).eq("campaign_id", id),
    ]);

  if (error) return errorResponse(error);
  if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

  return NextResponse.json({ campaign, variants, creatives, copy, compliance });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<Record<string, unknown>>(request);
  const { data, error } = await access.supabase
    .from("adstudio_campaigns")
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq("workspace_id", access.access.workspaceId)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) return errorResponse(error);

  return NextResponse.json({ campaign: data });
}
