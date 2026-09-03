import { cache } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Per-request auth context, deduped with React cache().
 *
 * Before this existed, every customer page ran the full auth stack twice per
 * request: AppShell (layout) called getUser + profiles + workspace_members,
 * then the page's requirePageSurfaceAccess repeated the exact same three
 * round-trips. cache() memoizes within a single server render pass, so the
 * layout and page now share one auth resolution.
 */

export type RequestAuthProfile = {
  full_name?: string | null;
  is_operator?: boolean | null;
  operator_role?: string | null;
} | null;

export type RequestAuthMembershipRow = {
  role: string;
  workspaces:
    | { id: string; name: string; mode: string; region: string | null }
    | Array<{ id: string; name: string; mode: string; region: string | null }>
    | null;
};

export const getRequestSupabase = cache(createSupabaseServerClient);

export const getRequestAuthContext = cache(async () => {
  const supabase = await getRequestSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, user: null, profile: null as RequestAuthProfile, membershipRows: [] as RequestAuthMembershipRow[] };
  }

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from("profiles").select("full_name, is_operator, operator_role").eq("id", user.id).maybeSingle(),
    supabase
      .from("workspace_members")
      .select("role, workspaces(id, name, mode, region)")
      .eq("profile_id", user.id)
      .order("created_at", { ascending: true }),
  ]);

  return {
    supabase,
    user,
    profile: (profile ?? null) as RequestAuthProfile,
    membershipRows: (memberships ?? []) as RequestAuthMembershipRow[],
  };
});
