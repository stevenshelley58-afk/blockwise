import { NextResponse, type NextRequest } from "next/server";

import { canManageProviderConnections, requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { resolveMonitorDateRange } from "@/lib/monitor/dashboard-data";
import { exchangeProviderCode } from "@/lib/providers/oauth-handlers";
import { upsertProviderConnectionWithTokens } from "@/lib/providers/provider-connections";
import { syncProviderWorkspace } from "@/lib/providers/provider-sync";
import { verifyOAuthState } from "@/lib/providers/oauth-state";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  return handleCallback(request);
}

async function handleCallback(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const origin = request.nextUrl.origin;

  if (!code || !state) {
    return NextResponse.redirect(new URL("/monitor?integration=meta&error=missing_code", origin));
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  const verified = verifyOAuthState(state, {
    expectedProvider: "meta",
    expectedUserId: user.id,
  });

  if (!verified.ok) {
    return NextResponse.redirect(new URL("/monitor?integration=meta&error=invalid_state", origin));
  }

  const access = await requireWorkspaceAccess(supabase, {
    surface: "monitor",
    requestedWorkspaceId: verified.payload.workspaceId,
  });

  if (!access.ok || !canManageProviderConnections(access.access)) {
    return NextResponse.redirect(new URL("/monitor?integration=meta&error=forbidden", origin));
  }

  const serviceSupabase = createSupabaseServiceClient();

  try {
    const exchanged = await exchangeProviderCode("meta", request, code);
    await upsertProviderConnectionWithTokens({
      serviceSupabase,
      workspaceId: verified.payload.workspaceId,
      userId: user.id,
      provider: "meta",
      status: exchanged.status,
      scopes: exchanged.scopes,
      externalAccountId: exchanged.externalAccountId,
      externalAccountName: exchanged.externalAccountName,
      accessToken: exchanged.accessToken,
      refreshToken: exchanged.refreshToken,
      metadata: exchanged.metadata,
      tokenExpiresAt: exchanged.tokenExpiresAt,
    });
  } catch (error) {
    const message = encodeURIComponent(error instanceof Error ? error.message : "Meta connection failed.");
    return NextResponse.redirect(new URL(`/monitor?integration=meta&error=${message}`, origin));
  }

  // Best-effort first sync so the dashboard shows real data immediately after
  // connecting. A sync failure must NOT fail the connection itself.
  try {
    await syncProviderWorkspace({
      supabase,
      serviceSupabase,
      workspaceId: verified.payload.workspaceId,
      provider: "meta",
      range: resolveMonitorDateRange("last_30"),
      jobKey: "connect-auto-sync",
    });
  } catch {
    // Connection is already saved; the first sync can be retried later.
  }

  return NextResponse.redirect(new URL("/monitor?integration=meta&connected=1", origin));
}
