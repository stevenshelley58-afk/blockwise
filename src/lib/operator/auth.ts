import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "../supabase/server.ts";

/**
 * Operator-only guard for /api/operator/* routes.
 *
 * Operator status is sourced exclusively from `profiles.is_operator` — the same
 * source of truth used by {@link requireWorkspaceAccess} and RLS
 * (`public.is_operator()`). The legacy `OPERATOR_EMAILS` env allowlist has been
 * removed to eliminate the dual-source inconsistency.
 *
 * Returns the supabase client + operator identity if the caller is a logged-in
 * operator. Returns a NextResponse 401/403 otherwise.
 */
export async function requireOperator(): Promise<
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
      profileId: string;
      email: string;
    }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_operator")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.is_operator) {
    return { ok: false, response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }

  return { ok: true, supabase, profileId: user.id, email: user.email ?? "" };
}
