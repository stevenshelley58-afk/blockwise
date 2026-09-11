import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

import { cleanSupabaseEnv, resolveSupabaseServerUrl, supabaseAuthCookieName } from "./credentials.ts";

type CookieToSet = {
  name: string;
  value: string;
  options: CookieOptions;
};

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const cookieName = supabaseAuthCookieName();

  return createServerClient(
    // Server-side reads and writes go to the internal Supabase router when the
    // runtime provides one; see resolveSupabaseServerUrl. Auth redirect targets
    // are built from the browser origin and NEXT_PUBLIC_APP_URL, never from
    // this base URL, so the internal origin cannot leak into an email link.
    resolveSupabaseServerUrl(),
    cleanSupabaseEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    {
      auth: { flowType: "pkce" },
      // Pin the auth cookie to the public project ref: the client would
      // otherwise derive it from the internal hostname and lose the session.
      ...(cookieName ? { cookieOptions: { name: cookieName } } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components cannot set cookies; route handlers and actions can.
          }
        },
      },
    },
  );
}
