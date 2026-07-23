import { NextResponse, type NextRequest } from "next/server";

import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { fetchMetaTargetingLocations } from "@/lib/providers/meta-campaigns";
import { listProviderConnections, loadStoredProviderTokens } from "@/lib/providers/provider-connections";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;

  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (query.length < 2) return NextResponse.json({ locations: [] });

  const connections = await listProviderConnections(access.supabase, access.access.workspaceId);
  const connection = connections.find((item) => item.provider === "meta" && item.status === "connected")
    ?? connections.find((item) => item.provider === "meta" && item.status === "needs_attention")
    ?? connections.find((item) => item.provider === "meta");
  if (!connection) {
    return NextResponse.json({ error: "Connect Meta before choosing target suburbs.", locations: [] }, { status: 422 });
  }

  const tokens = await loadStoredProviderTokens(createSupabaseServiceClient(), connection.id);
  if (!tokens.accessToken) {
    return NextResponse.json({ error: "Reconnect Meta before choosing target suburbs.", locations: [] }, { status: 422 });
  }

  try {
    const locations = await fetchMetaTargetingLocations({ accessToken: tokens.accessToken, query });
    return NextResponse.json({ locations });
  } catch (error) {
    console.error("[adstudio/meta-targeting-locations] Location lookup failed", error);
    return NextResponse.json({ error: "Suburbs could not be loaded. Try again.", locations: [] }, { status: 502 });
  }
}
