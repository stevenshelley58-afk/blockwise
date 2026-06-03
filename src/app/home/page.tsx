import { redirect } from "next/navigation";

import { resolveHomePath } from "@/lib/auth/home";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Profile-aware landing route. After sign-in we send users here and resolve the
// correct home server-side, so each profile lands on what it signed up for.
export default async function HomeRedirectPage() {
  const supabase = await createSupabaseServerClient();
  const destination = await resolveHomePath(supabase);
  redirect(destination);
}
