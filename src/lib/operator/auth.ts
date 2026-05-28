import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "../supabase/server.ts";

/**
 * Operator-only guard for /api/operator/* routes.
 *
 * Returns the supabase client if the caller is a logged-in operator (email
 * present in OPERATOR_EMAILS). Returns a NextResponse 401/403 otherwise.
 */
export async function requireOperator(): Promise<
  | { ok: true; supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>; email: string }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return { ok: false, response: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  }
  const allowed = (process.env.OPERATOR_EMAILS ?? "stevenshelley58@gmail.com")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.includes(user.email.toLowerCase())) {
    return { ok: false, response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { ok: true, supabase, email: user.email };
}
