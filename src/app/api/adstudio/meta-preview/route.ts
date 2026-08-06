import { NextResponse, type NextRequest } from "next/server";

import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { DEFAULT_META_GRAPH_VERSION } from "@/lib/providers/meta-graph-version";
import {
  resolveMetaConnectionSetup,
  validateMetaConnectionSetup,
} from "@/lib/providers/meta-execution";
import { loadStoredProviderTokens } from "@/lib/providers/provider-connections";
import { listProviderConnections } from "@/lib/providers/provider-connections";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

// "Check against Meta's preview" (§8): proxies GET /act_{id}/generatepreviews
// with the workspace's own connection. Called ON DEMAND from the publish
// review step (never automatically — Meta rate-limits it under standard
// ads_management BUC and iframes expire in 24 h).

const PREVIEW_FORMATS = new Set([
  "MOBILE_FEED_STANDARD",
  "DESKTOP_FEED_STANDARD",
  "INSTAGRAM_STANDARD",
  "INSTAGRAM_STORY",
  "FACEBOOK_STORY_MOBILE",
  "INSTAGRAM_REELS",
  "RIGHT_COLUMN_STANDARD",
]);

export async function POST(request: NextRequest) {
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;

  const body = (await request.json().catch(() => null)) as {
    creative?: Record<string, unknown>;
    adFormat?: string;
  } | null;

  if (!body?.creative || typeof body.creative !== "object") {
    return NextResponse.json({ error: "creative is required." }, { status: 400 });
  }
  const adFormat = typeof body.adFormat === "string" && PREVIEW_FORMATS.has(body.adFormat)
    ? body.adFormat
    : "MOBILE_FEED_STANDARD";

  const connections = await listProviderConnections(access.supabase, access.access.workspaceId);
  const metaConnection =
    connections.find((connection) => connection.provider === "meta" && connection.status === "connected")
    ?? connections.find((connection) => connection.provider === "meta");
  if (!metaConnection?.externalAccountId) {
    return NextResponse.json({ error: "Connect Meta before requesting Meta's own preview." }, { status: 422 });
  }

  const setupIssues = validateMetaConnectionSetup(
    resolveMetaConnectionSetup(metaConnection.metadata, metaConnection.externalAccountId),
  );
  if (setupIssues.length > 0) {
    return NextResponse.json({ error: setupIssues[0] }, { status: 422 });
  }

  const serviceSupabase = createSupabaseServiceClient();
  const tokens = await loadStoredProviderTokens(serviceSupabase, metaConnection.id);
  if (!tokens.accessToken) {
    return NextResponse.json({ error: "Reconnect Meta before requesting Meta's own preview." }, { status: 422 });
  }

  const params = new URLSearchParams({
    creative: JSON.stringify(body.creative),
    ad_format: adFormat,
  });
  const response = await fetch(
    `https://graph.facebook.com/${DEFAULT_META_GRAPH_VERSION}/${metaConnection.externalAccountId}/generatepreviews?${params}`,
    { headers: { authorization: `Bearer ${tokens.accessToken}` } },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    data?: Array<{ body?: string }>;
    error?: { message?: string };
  };

  if (!response.ok || !payload.data?.[0]?.body) {
    return NextResponse.json(
      { error: payload.error?.message ?? "Meta could not build that preview right now." },
      { status: 502 },
    );
  }

  return NextResponse.json({ html: payload.data[0].body });
}
