import { NextResponse } from "next/server";

import { hasOperatorAccessFromRows } from "../auth/workspace-access.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";

/**
 * Operator-only guard for /api/operator/* routes.
 *
 * Returns the supabase client if the caller is a logged-in operator through
 * profile, workspace role, or legacy OPERATOR_EMAILS fallback. Returns a
 * NextResponse 401/403 otherwise.
 */
export async function requireOperator(): Promise<
  | { ok: true; supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>; email: string }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return { ok: false, response: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  }
  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from("profiles").select("is_operator").eq("id", user.id).maybeSingle(),
    supabase.from("workspace_members").select("role").eq("profile_id", user.id),
  ]);
  const allowed = (process.env.OPERATOR_EMAILS ?? "stevenshelley58@gmail.com")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const isAllowedEmail = allowed.includes(user.email.toLowerCase());
  const isOperator = hasOperatorAccessFromRows(profile, memberships);
  if (!isOperator && !isAllowedEmail) {
    return { ok: false, response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { ok: true, supabase, email: user.email };
}
