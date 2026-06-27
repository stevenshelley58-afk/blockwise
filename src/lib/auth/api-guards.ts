import { NextResponse, type NextRequest } from "next/server";

import type { ProductSurface } from "@/lib/auth/access-control";
import { requireWorkspaceAccess, type WorkspaceAccess } from "@/lib/auth/workspace-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

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
