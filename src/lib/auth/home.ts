import type { createSupabaseServerClient } from "@/lib/supabase/server";

import { acceptVerifiedWorkspaceInvitations } from "./verified-workspace-invitations.ts";
import { bootstrapVerifiedTrialWorkspace } from "./verified-workspace-bootstrap.ts";
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
 *
 * A verified user with NO workspace is almost always a signup whose
 * confirmation redirect never reached /auth/confirm (redirect allow-list miss,
 * stripped query string, cross-domain hop) — the only other place bootstrap
 * runs. Repair it here instead of bouncing them to a dead-end sign-out page.
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

  let rows = (memberships ?? []) as HomeMembershipRow[];

  if (hasOperatorAccessFromRows(profile, rows)) {
    return "/operator";
  }

  if (rows.length === 0 && (user.email_confirmed_at || user.confirmed_at)) {
    try {
      await acceptVerifiedWorkspaceInvitations({ user });
      const bootstrap = await bootstrapVerifiedTrialWorkspace({ user });
      if (bootstrap.workspaceId || bootstrap.eligible) {
        const { data: repaired } = await supabase
          .from("workspace_members")
          .select("role, workspaces(mode)")
          .eq("profile_id", user.id)
          .order("created_at", { ascending: true });
        rows = (repaired ?? []) as HomeMembershipRow[];
      }
    } catch (error) {
      console.error("home: workspace bootstrap repair failed", error);
    }

    if (rows.length === 0) {
      // Nothing to bootstrap (ineligible or repair failed) — land on the
      // terminal explainer directly instead of a /self-serve redirect loop.
      return "/access-unavailable?reason=no_workspace";
    }
  }

  const firstWorkspace = rows[0]?.workspaces;
  const mode = Array.isArray(firstWorkspace) ? firstWorkspace[0]?.mode : firstWorkspace?.mode;
  return mode === "monitor" ? "/results" : "/self-serve";
}
