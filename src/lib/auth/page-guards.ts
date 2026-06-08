import { redirect } from "next/navigation";

import type { ProductSurface } from "@/lib/auth/access-control";
import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function requirePageSurfaceAccess(surface: ProductSurface, requestedWorkspaceId?: string | null) {
  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, {
    surface,
    requestedWorkspaceId,
  });

  if (!access.ok) {
    redirect(access.status === 401 ? "/login" : "/results?error=access_denied");
  }

  return {
    supabase,
    access: access.access,
  };
}
