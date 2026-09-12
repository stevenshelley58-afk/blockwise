import { NextResponse, type NextRequest } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { fetchMetaTargetingLocations } from "@/lib/providers/meta-campaigns";
import { fetchMetaPublishOptions, fetchMetaPublishParentState } from "@/lib/providers/meta-publish-options";
import { loadStoredProviderTokens } from "@/lib/providers/provider-connections";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MetaConnectionRow = {
  id: string;
  external_account_id: string | null;
  external_account_name: string | null;
};

/** Read-only, workspace-scoped data for existing Meta targets and AU locations. */
export async function GET(request: NextRequest) {
  const guard = await requireApiWorkspace(request, "adstudio");
  if (!guard.ok) return guard.response;

  const serviceSupabase = createSupabaseServiceClient();
  const { data: connection, error: connectionError } = await serviceSupabase
    .from("provider_connections")
    .select("id,external_account_id,external_account_name")
    .eq("workspace_id", guard.access.workspaceId)
    .eq("provider", "meta")
    .in("status", ["connected", "needs_attention"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (connectionError) return NextResponse.json({ error: connectionError.message }, { status: 500 });
  const metaConnection = connection as MetaConnectionRow | null;
  if (!metaConnection?.external_account_id) {
    return NextResponse.json({ connected: false, campaigns: [], adSets: [], locations: [], error: "Meta account is not connected." });
  }

  const tokens = await loadStoredProviderTokens(serviceSupabase, metaConnection.id).catch(() => ({ accessToken: null, refreshToken: null }));
  if (!tokens.accessToken) {
    return NextResponse.json({ connected: false, campaigns: [], adSets: [], locations: [], error: "Meta access needs to be reconnected." });
  }

  const selectedCampaignId = request.nextUrl.searchParams.get("campaignId");
  if (selectedCampaignId) {
    try {
      const parentState = await fetchMetaPublishParentState({ accessToken: tokens.accessToken,
        accountId: metaConnection.external_account_id, campaignId: selectedCampaignId,
        adSetIds: request.nextUrl.searchParams.getAll("adSetId"),
      });
      return NextResponse.json({ parentState }, { headers: { "cache-control": "private, no-store" } });
    } catch { return NextResponse.json({ error: "This setup could not be verified. Check that it is active and compatible with lead generation." }, { status: 400 }); }
  }
  const query = request.nextUrl.searchParams.get("q");
  const country = (request.nextUrl.searchParams.get("country") ?? "AU").trim().toUpperCase();
  if (query !== null) {
    if (country !== "AU") return NextResponse.json({ error: "Only Australian targeting locations are supported." }, { status: 400 });
    try {
      const locations = await fetchMetaTargetingLocations({ accessToken: tokens.accessToken, query });
      return NextResponse.json({ connected: true, locations }, { headers: { "cache-control": "private, no-store" } });
    } catch (error) {
      return NextResponse.json({ error: "Meta location search failed. Try again or reconnect Meta." }, { status: 502 });
    }
  }

  try {
    const campaignOptions = await fetchMetaPublishOptions({ accessToken: tokens.accessToken, accountId: metaConnection.external_account_id });
    const campaigns = campaignOptions.map(({ adSets: _adSets, eligibilityReasons, ...campaign }) => ({
      ...campaign,
      reason: eligibilityReasons[0] ?? null,
    }));
    const adSets = campaignOptions.flatMap((campaign) => campaign.adSets.map(({ eligibilityReasons, ...adSet }) => ({
      ...adSet,
      campaignId: campaign.id,
      reason: eligibilityReasons[0] ?? null,
    })));
    return NextResponse.json({ connected: true, accountName: metaConnection.external_account_name, campaigns, adSets, locations: [] }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: "Meta publish options could not be loaded. Try again or reconnect Meta." }, { status: 502 });
  }
}
