import { NextResponse, type NextRequest } from "next/server";

import { canManageProviderConnections, requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { buildProviderAuthorizationUrl } from "@/lib/providers/oauth-handlers";
import { createOAuthStatePayload, signOAuthState } from "@/lib/api-control/oauth-state";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
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
      provider: "meta",
      workspaceId: access.access.workspaceId,
      userId: access.access.userId,
      returnPath: "/monitor",
    }),
  );
  const authorizationUrl = buildProviderAuthorizationUrl("meta", request, state);

  if (!authorizationUrl) {
    return NextResponse.redirect(new URL("/monitor?integration=meta&error=missing_config", request.nextUrl.origin));
  }

  return NextResponse.redirect(authorizationUrl);
}
