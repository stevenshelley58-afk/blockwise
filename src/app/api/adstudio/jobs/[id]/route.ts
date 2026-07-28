import { NextResponse, type NextRequest } from "next/server";

import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { publicAdStudioGenerationError } from "@/lib/adstudio/generation-error";
import { compactAdStudioCampaignPackForTransport, loadAdStudioCampaignPack } from "@/lib/adstudio/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

/**
 * Workspace-scoped status for an async generation job (see
 * trigger/adstudio-generate.ts). Reads run on the user-scoped client, so the
 * member SELECT policy on adstudio_creative_jobs applies; writes stay
 * service-role only.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await Promise.resolve(context.params);
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const { data, error } = await access.supabase
    .from("adstudio_creative_jobs")
    .select("id,status,error,campaign_id,created_at")
    .eq("workspace_id", access.access.workspaceId)
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  // A finished job ships its campaign pack inline so the waiting client can
  // render the ad without a second round trip through the campaigns route.
  const campaignPack = data.status === "done" && data.campaign_id
    ? await loadAdStudioCampaignPack(access.supabase, access.access.workspaceId, String(data.campaign_id))
    : null;

  return NextResponse.json({
    job: {
      ...data,
      error: data.status === "failed" ? publicAdStudioGenerationError(data.error) : data.error,
      campaignPack: campaignPack ? compactAdStudioCampaignPackForTransport(campaignPack) : null,
    },
  });
}
