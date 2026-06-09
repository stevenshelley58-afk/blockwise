import { NextResponse, type NextRequest } from "next/server";

import { canManageProviderConnections } from "@/lib/auth/access-control";
import { requireApiWorkspace } from "@/lib/auth/api-guards";
import { buildProviderAuthorizationUrl } from "@/lib/providers/oauth-handlers";
import { createOAuthStatePayload, signOAuthState } from "@/lib/providers/oauth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const guard = await requireApiWorkspace(request, "monitor");

  if (!guard.ok) return guard.response;
  const { access } = guard;

  if (!canManageProviderConnections(access)) {
    return NextResponse.json({ error: "Provider connection management requires owner or admin access." }, { status: 403 });
  }

  const state = signOAuthState(
    createOAuthStatePayload({
      provider: "meta",
      workspaceId: access.workspaceId,
      userId: access.userId,
      returnPath: "/results",
    }),
  );
  const authorizationUrl = buildProviderAuthorizationUrl("meta", request, state);

  if (!authorizationUrl) {
    return NextResponse.redirect(new URL("/results?integration=meta&error=missing_config", request.nextUrl.origin));
  }

  return NextResponse.redirect(authorizationUrl);
}
