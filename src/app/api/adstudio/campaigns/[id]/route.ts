import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, readJsonBody, requireAdStudioRequest } from "@/lib/adstudio/http";
import { compactAdStudioCampaignPackForTransport, loadAdStudioCampaignPack } from "@/lib/adstudio/persistence";

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

  const campaignPack = await loadAdStudioCampaignPack(
    access.supabase,
    access.access.workspaceId,
    id,
  );
  if (!campaignPack) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  return NextResponse.json({
    campaignPack: compactAdStudioCampaignPackForTransport(campaignPack),
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const body = await readJsonBody<Record<string, unknown>>(request);
  const patch = campaignPatch(body);
  const { data, error } = await access.supabase
    .from("adstudio_campaigns")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("workspace_id", access.access.workspaceId)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) return errorResponse(error);

  return NextResponse.json({ campaign: data });
}

function campaignPatch(body: Record<string, unknown>): Record<string, unknown> {
  const allowed = [
    "name",
    "goal",
    "market_json",
    "audience_intent",
    "offer_id",
    "platforms_json",
    "creative_formats_json",
    "status",
  ];
  return Object.fromEntries(allowed.filter((key) => key in body).map((key) => [key, body[key]]));
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  // Verify the campaign belongs to this workspace before deleting.
  const { data: campaign, error: fetchError } = await access.supabase
    .from("adstudio_campaigns")
    .select("id")
    .eq("workspace_id", access.access.workspaceId)
    .eq("id", id)
    .maybeSingle();

  if (fetchError) return errorResponse(fetchError);
  if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

  // Cascade-delete related records first, then the campaign row itself.
  const [variantsResult, creativesResult, copyResult, complianceResult] = await Promise.all([
    access.supabase
      .from("adstudio_campaign_variants")
      .delete()
      .eq("workspace_id", access.access.workspaceId)
      .eq("campaign_id", id),
    access.supabase
      .from("adstudio_creatives")
      .delete()
      .eq("workspace_id", access.access.workspaceId)
      .eq("campaign_id", id),
    access.supabase
      .from("adstudio_platform_copy")
      .delete()
      .eq("workspace_id", access.access.workspaceId)
      .eq("campaign_id", id),
    access.supabase
      .from("adstudio_compliance_reports")
      .delete()
      .eq("workspace_id", access.access.workspaceId)
      .eq("campaign_id", id),
  ]);

  if (variantsResult.error) return errorResponse(variantsResult.error);
  if (creativesResult.error) return errorResponse(creativesResult.error);
  if (copyResult.error) return errorResponse(copyResult.error);
  if (complianceResult.error) return errorResponse(complianceResult.error);

  const { error: deleteError } = await access.supabase
    .from("adstudio_campaigns")
    .delete()
    .eq("workspace_id", access.access.workspaceId)
    .eq("id", id);

  if (deleteError) return errorResponse(deleteError);

  return NextResponse.json({ deleted: true });
}
