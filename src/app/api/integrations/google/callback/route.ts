import { NextResponse, type NextRequest } from "next/server";

import { canManageProviderConnections, requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { GOOGLE_ADS_ENABLED } from "@/lib/config/feature-flags";
import { resolveMonitorDateRange } from "@/lib/monitor/dashboard-data";
import { exchangeProviderCode } from "@/lib/providers/oauth-handlers";
import { verifyOAuthState } from "@/lib/providers/oauth-state";
import { upsertProviderConnectionWithTokens } from "@/lib/providers/provider-connections";
import { syncProviderWorkspace } from "@/lib/providers/provider-sync";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;

  // Google Ads is parked for the Meta-only v1. See src/lib/config/feature-flags.ts.
  if (!GOOGLE_ADS_ENABLED) {
    return NextResponse.redirect(new URL("/results?integration=google&error=disabled", origin));
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");

  if (!code || !state) {
    return NextResponse.redirect(new URL("/results?integration=google&error=missing_code", origin));
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  const verified = verifyOAuthState(state, {
    expectedProvider: "google",
    expectedUserId: user.id,
  });

  if (!verified.ok) {
    return NextResponse.redirect(new URL("/results?integration=google&error=invalid_state", origin));
  }

  const access = await requireWorkspaceAccess(supabase, {
    surface: "monitor",
    requestedWorkspaceId: verified.payload.workspaceId,
  });

  if (!access.ok || !canManageProviderConnections(access.access)) {
    return NextResponse.redirect(new URL("/results?integration=google&error=forbidden", origin));
  }

  const serviceSupabase = createSupabaseServiceClient();

  try {
    const exchanged = await exchangeProviderCode("google", request, code);
    await upsertProviderConnectionWithTokens({
      serviceSupabase,
      workspaceId: verified.payload.workspaceId,
      userId: user.id,
      provider: "google",
      status: exchanged.status,
      scopes: exchanged.scopes,
      externalAccountId: exchanged.externalAccountId,
      externalAccountName: exchanged.externalAccountName,
      accessToken: exchanged.accessToken,
      refreshToken: exchanged.refreshToken,
    });
  } catch (error) {
    const message = encodeURIComponent(error instanceof Error ? error.message : "Google connection failed.");
    return NextResponse.redirect(new URL(`/results?integration=google&error=${message}`, origin));
  }

  // Best-effort first sync so the dashboard shows real data immediately after
  // connecting. A sync failure must NOT fail the connection itself.
  try {
    await syncProviderWorkspace({
      supabase,
      serviceSupabase,
      workspaceId: verified.payload.workspaceId,
      provider: "google",
      range: resolveMonitorDateRange("last_30"),
      jobKey: "connect-auto-sync",
    });
  } catch {
    // Connection is already saved; the first sync can be retried later.
  }

  return NextResponse.redirect(new URL("/results?integration=google&connected=1", origin));
}
