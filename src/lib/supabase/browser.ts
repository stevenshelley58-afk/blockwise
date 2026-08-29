import { createBrowserClient } from "@supabase/ssr";

function cleanSupabaseEnv(value?: string) {
  return value?.replace(/^\uFEFF/, "").trim();
}

export function createSupabaseBrowserClient() {
  const supabaseUrl = cleanSupabaseEnv(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supabaseAnonKey = cleanSupabaseEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (!supabaseUrl || !supabaseAnonKey) {
    if (typeof window === "undefined") {
      // Prerendering without env (e.g. CI build): defer the failure to first use
      // so static auth pages can still be generated.
      return new Proxy({} as ReturnType<typeof createBrowserClient>, {
        get() {
          throw new Error("Supabase browser environment is missing.");
        },
      });
    }
    throw new Error("Supabase browser environment is missing.");
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
