import { NextResponse, type NextRequest } from "next/server";

import { canManageProviderConnections } from "@/lib/auth/access-control";
import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { GOOGLE_ADS_ENABLED } from "@/lib/config/feature-flags";
import { buildProviderAuthorizationUrl } from "@/lib/providers/oauth-handlers";
import { createOAuthStatePayload, signOAuthState } from "@/lib/providers/oauth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Google Ads is parked for the Meta-only v1. See src/lib/config/feature-flags.ts.
  if (!GOOGLE_ADS_ENABLED) {
    return NextResponse.redirect(new URL("/results?integration=google&error=disabled", request.nextUrl.origin));
  }

  const guard = await requireApiWorkspace(request, "monitor");

  if (!guard.ok) return guard.response;
  const { access } = guard;

  if (!canManageProviderConnections(access)) {
    return NextResponse.json({ error: "Provider connection management requires owner or admin access." }, { status: 403 });
  }

  const state = signOAuthState(
    createOAuthStatePayload({
      provider: "google",
      workspaceId: access.workspaceId,
      userId: access.userId,
      returnPath: "/results",
    }),
  );
  const authorizationUrl = buildProviderAuthorizationUrl("google", request, state);

  if (!authorizationUrl) {
    return NextResponse.redirect(new URL("/results?integration=google&error=missing_config", request.nextUrl.origin));
  }

  return NextResponse.redirect(authorizationUrl);
}
