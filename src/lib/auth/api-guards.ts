import { NextResponse, type NextRequest } from "next/server";

import type { ProductSurface } from "@/lib/auth/access-control";
import { requireWorkspaceAccess, type WorkspaceAccess } from "@/lib/auth/workspace-access";
import { niche } from "@/config/niche";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Returns a 404 response when every named niche feature is disabled, or null
 * when at least one is enabled. Call first in route handlers whose surface is
 * hidden by the niche feature flags so gated APIs behave like the gated pages.
 */
export function featureDisabledResponse(
  ...flags: (keyof typeof niche.features)[]
): NextResponse | null {
  const anyEnabled = flags.some((flag) => niche.features[flag]);
  return anyEnabled
    ? null
    : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export type ApiWorkspaceGuard =
  | { ok: true; supabase: SupabaseServerClient; access: WorkspaceAccess }
  | { ok: false; response: NextResponse };

/**
 * Standard API-route prologue: create the request-scoped Supabase client,
 * resolve workspace access for the surface, and map failures to the JSON
 * error response every route returns. When `workspaceId` is omitted the
 * `workspaceId` query parameter is used; pass an explicit value (or null)
 * for routes that source it from the request body or OAuth state.
 */
export async function requireApiWorkspace(
  request: NextRequest,
  surface: ProductSurface,
  workspaceId?: string | null,
): Promise<ApiWorkspaceGuard> {
  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, {
    surface,
    requestedWorkspaceId: workspaceId !== undefined ? workspaceId : request.nextUrl.searchParams.get("workspaceId"),
  });

  if (!access.ok) {
    return { ok: false, response: NextResponse.json({ error: access.error }, { status: access.status }) };
  }

  return { ok: true, supabase, access: access.access };
}
