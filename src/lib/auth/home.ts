import type { createSupabaseServerClient } from "@/lib/supabase/server";

import { hasOperatorAccessFromRows } from "./workspace-access.ts";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type HomeMembershipRow = {
  role: string;
  workspaces: { mode: string; onboarding_status?: string | null } | Array<{ mode: string; onboarding_status?: string | null }> | null;
};

/**
 * Resolves where a signed-in user should land: operators -> /operator,
 * everyone else -> /results. New workspaces see demo data on /results with a
 * guided setup popup until they connect an ad account.
 */
export async function resolveHomePath(supabase: SupabaseServerClient): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return "/login";
  }

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from("profiles").select("is_operator").eq("id", user.id).maybeSingle(),
    supabase
      .from("workspace_members")
      .select("role, workspaces(mode, onboarding_status)")
      .eq("profile_id", user.id)
      .order("created_at", { ascending: true }),
  ]);

  const rows = (memberships ?? []) as HomeMembershipRow[];

  if (hasOperatorAccessFromRows(profile, rows)) {
    return "/operator";
  }

  return "/results";
}
