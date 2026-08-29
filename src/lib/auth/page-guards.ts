import { redirect } from "next/navigation";

import type { ProductSurface } from "@/lib/auth/access-control";
import { getRequestAuthContext } from "@/lib/auth/request-context";
import { requireWorkspaceAccessFromContext } from "@/lib/auth/workspace-access";

export async function requirePageSurfaceAccess(surface: ProductSurface, requestedWorkspaceId?: string | null) {
  const auth = await getRequestAuthContext();
  const access = await requireWorkspaceAccessFromContext(auth, {
    surface,
    requestedWorkspaceId,
  });

  if (!access.ok) {
    redirect(access.status === 401 ? "/login" : `/access-unavailable?reason=${access.status === 404 ? "no_workspace" : "access_denied"}`);
  }

  return {
    supabase: auth.supabase,
    access: access.access,
    auth,
  };
}
