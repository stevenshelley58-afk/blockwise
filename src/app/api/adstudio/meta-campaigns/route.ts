import { NextResponse, type NextRequest } from "next/server";

import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { fetchEligibleMetaCampaigns } from "@/lib/providers/meta-campaigns";
import {
  listProviderConnections,
  loadStoredProviderTokens,
} from "@/lib/providers/provider-connections";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await requireAdStudioRequest(request);

  if (!access.ok) {
    return access.response;
  }

  const connections = await listProviderConnections(access.supabase, access.access.workspaceId);
  const connection = connections.find((item) => item.provider === "meta" && item.status === "connected")
    ?? connections.find((item) => item.provider === "meta" && item.status === "needs_attention")
    ?? connections.find((item) => item.provider === "meta");

  if (!connection?.externalAccountId) {
    return NextResponse.json({
      connected: false,
      campaigns: [],
      issue: "Connect Meta to use an existing campaign.",
    });
  }

  const tokens = await loadStoredProviderTokens(createSupabaseServiceClient(), connection.id);

  if (!tokens.accessToken) {
    return NextResponse.json({
      connected: false,
      account: { id: connection.externalAccountId, name: connection.externalAccountName ?? "Meta Ads" },
      campaigns: [],
      issue: "Reconnect Meta to load campaigns.",
    });
  }

  try {
    const campaigns = await fetchEligibleMetaCampaigns({
      accessToken: tokens.accessToken,
      accountId: connection.externalAccountId,
    });

    return NextResponse.json({
      connected: true,
      account: { id: connection.externalAccountId, name: connection.externalAccountName ?? "Meta Ads" },
      campaigns,
    });
  } catch (error) {
    console.error("[adstudio/meta-campaigns] Campaign lookup failed", error);
    return NextResponse.json({
      connected: true,
      account: { id: connection.externalAccountId, name: connection.externalAccountName ?? "Meta Ads" },
      campaigns: [],
      issue: "Campaigns could not be loaded. Retry or create a new campaign.",
    });
  }
}
