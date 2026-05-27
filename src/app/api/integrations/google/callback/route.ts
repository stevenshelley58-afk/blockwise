import { NextResponse, type NextRequest } from "next/server";

import { canManageProviderConnections, requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { exchangeProviderCode } from "@/lib/providers/oauth-handlers";
import { verifyOAuthState } from "@/lib/providers/oauth-state";
import { upsertProviderConnectionWithTokens } from "@/lib/providers/provider-connections";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const origin = request.nextUrl.origin;

  if (!code || !state) {
    return NextResponse.redirect(new URL("/monitor?integration=google&error=missing_code", origin));
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
    return NextResponse.redirect(new URL("/monitor?integration=google&error=invalid_state", origin));
  }

  const access = await requireWorkspaceAccess(supabase, {
    surface: "monitor",
    requestedWorkspaceId: verified.payload.workspaceId,
  });

  if (!access.ok || !canManageProviderConnections(access.access)) {
    return NextResponse.redirect(new URL("/monitor?integration=google&error=forbidden", origin));
  }

  try {
    const exchanged = await exchangeProviderCode("google", request, code);
    await upsertProviderConnectionWithTokens({
      serviceSupabase: createSupabaseServiceClient(),
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
    return NextResponse.redirect(new URL(`/monitor?integration=google&error=${message}`, origin));
  }

  return NextResponse.redirect(new URL("/monitor?integration=google&connected=1", origin));
}
