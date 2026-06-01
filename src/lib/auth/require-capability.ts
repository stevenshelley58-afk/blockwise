import { requireWorkspaceAccess, type WorkspaceAccess } from "@/lib/auth/workspace-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { hasCapability, type Capability, type CapabilityContext } from "./capabilities.ts";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type RequireCapabilityResult =
  | { ok: true; supabase: SupabaseServerClient; access: WorkspaceAccess; ctx: CapabilityContext }
  | { ok: false; status: 401 | 403 | 404; error: string };

/**
 * Server-side capability gate for API route handlers.
 *
 * Resolves the caller's workspace membership (reusing {@link requireWorkspaceAccess}
 * with the universally-readable `monitor` surface so membership resolution never
 * wrongly rejects), then enforces the requested {@link Capability}. UI hiding is
 * cosmetic — this is the real gate for mutations.
 */
export async function requireCapability(
  capability: Capability,
  opts: { requestedWorkspaceId?: string | null } = {},
): Promise<RequireCapabilityResult> {
  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, {
    surface: "monitor",
    requestedWorkspaceId: opts.requestedWorkspaceId,
  });

  if (!access.ok) {
    return access;
  }

  const ctx: CapabilityContext = {
    role: access.access.role,
    workspaceMode: access.access.workspaceMode,
    isOperator: access.access.isOperator,
  };

  if (!hasCapability(ctx, capability)) {
    return {
      ok: false,
      status: 403,
      error: `The "${capability}" capability is required for this workspace.`,
    };
  }

  return { ok: true, supabase, access: access.access, ctx };
}
