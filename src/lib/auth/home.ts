import type { createSupabaseServerClient } from "@/lib/supabase/server";

import { hasOperatorAccessFromRows } from "./workspace-access.ts";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type HomeMembershipRow = {
  role: string;
  workspaces: { mode: string; onboarding_status?: string | null } | Array<{ mode: string; onboarding_status?: string | null }> | null;
};

/**
 * Resolves where a signed-in user should land based on the profile they signed
 * up for: operators -> /operator, self-serve workspaces -> /self-serve (the
 * self-serve home page), everyone else -> /monitor. Mirrors the variant logic
 * in AppShell so the landing page always matches the sidebar the user sees.
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

  const firstWorkspace = Array.isArray(rows[0]?.workspaces) ? rows[0]?.workspaces[0] : rows[0]?.workspaces;
  const onboardingStatus = firstWorkspace?.onboarding_status ?? "complete";
  if (
    firstWorkspace?.mode === "self_serve" &&
    (onboardingStatus === "not_started" || onboardingStatus === "full_setup")
  ) {
    return "/start";
  }

  return firstWorkspace?.mode === "self_serve" ? "/self-serve" : "/monitor";
}
