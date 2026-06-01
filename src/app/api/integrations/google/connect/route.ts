import { NextResponse, type NextRequest } from "next/server";

import { canManageProviderConnections, requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { GOOGLE_ADS_ENABLED } from "@/lib/config/feature-flags";
import { buildProviderAuthorizationUrl } from "@/lib/providers/oauth-handlers";
import { createOAuthStatePayload, signOAuthState } from "@/lib/providers/oauth-state";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Google Ads is parked for the Meta-only v1. See src/lib/config/feature-flags.ts.
  if (!GOOGLE_ADS_ENABLED) {
    return NextResponse.redirect(new URL("/monitor?integration=google&error=disabled", request.nextUrl.origin));
  }

  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, {
    surface: "monitor",
    requestedWorkspaceId: request.nextUrl.searchParams.get("workspaceId"),
  });

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  if (!canManageProviderConnections(access.access)) {
    return NextResponse.json({ error: "Provider connection management requires owner or admin access." }, { status: 403 });
  }

  const state = signOAuthState(
    createOAuthStatePayload({
      provider: "google",
      workspaceId: access.access.workspaceId,
      userId: access.access.userId,
      returnPath: "/monitor",
    }),
  );
  const authorizationUrl = buildProviderAuthorizationUrl("google", request, state);

  if (!authorizationUrl) {
    return NextResponse.redirect(new URL("/monitor?integration=google&error=missing_config", request.nextUrl.origin));
  }

  return NextResponse.redirect(authorizationUrl);
}
