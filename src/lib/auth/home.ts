import type { createSupabaseServerClient } from "@/lib/supabase/server";

import { hasOperatorAccessFromRows } from "./workspace-access.ts";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type HomeMembershipRow = {
  role: string;
  workspaces: { mode: string } | Array<{ mode: string }> | null;
};

/**
 * Resolves where a signed-in user should land from the workspace they actually
 * belong to. Operators use the operator console, self-serve customers use the
 * builder, and monitor-only customers use reporting.
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
      .select("role, workspaces(mode)")
      .eq("profile_id", user.id)
      .order("created_at", { ascending: true }),
  ]);

  const rows = (memberships ?? []) as HomeMembershipRow[];

  if (hasOperatorAccessFromRows(profile, rows)) {
    return "/operator";
  }

  const firstWorkspace = rows[0]?.workspaces;
  const mode = Array.isArray(firstWorkspace) ? firstWorkspace[0]?.mode : firstWorkspace?.mode;
  return mode === "monitor" ? "/results" : "/self-serve";
}
