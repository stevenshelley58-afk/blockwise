import type { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * All authenticated users land on the self-serve dashboard.
 * Operator management has moved to frank.fail.
 */
export async function resolveHomePath(supabase: SupabaseServerClient): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return "/login";
  }

  return "/self-serve";
}
