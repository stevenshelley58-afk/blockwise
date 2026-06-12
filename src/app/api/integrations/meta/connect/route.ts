import { NextResponse, type NextRequest } from "next/server";

import { canManageProviderConnections, requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { buildProviderAuthorizationUrl } from "@/lib/providers/oauth-handlers";
import { createOAuthStatePayload, sanitizeOAuthReturnPath, signOAuthState } from "@/lib/providers/oauth-state";
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

  const returnPath = sanitizeOAuthReturnPath(request.nextUrl.searchParams.get("returnPath"));
  const state = signOAuthState(
    createOAuthStatePayload({
      provider: "meta",
      workspaceId: access.access.workspaceId,
      userId: access.access.userId,
      returnPath,
    }),
  );
  const authorizationUrl = buildProviderAuthorizationUrl("meta", request, state);

  if (!authorizationUrl) {
    return NextResponse.redirect(providerReturnUrl(returnPath, request.nextUrl.origin, { error: "missing_config" }));
  }

  return NextResponse.redirect(authorizationUrl);
}

function providerReturnUrl(returnPath: string, origin: string, params: Record<string, string>): URL {
  const url = new URL(returnPath, origin);
  url.searchParams.set("integration", "meta");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}
