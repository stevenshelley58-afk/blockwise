import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getOfflineAuthSession } from "../auth/offline.ts";
import { cleanSupabaseEnv } from "./env.ts";
import { createOfflineSupabaseClient } from "./offline.ts";
import type { BlockwiseSupabaseClient } from "./types.ts";

type CookieToSet = {
  name: string;
  value: string;
  options: CookieOptions;
};

export async function createSupabaseServerClient(): Promise<BlockwiseSupabaseClient> {
  const offlineSession = await getOfflineAuthSession();
  if (offlineSession) {
    return createOfflineSupabaseClient(offlineSession) as unknown as BlockwiseSupabaseClient;
  }

  const cookieStore = await cookies();

  return createServerClient(
    cleanSupabaseEnv(process.env.NEXT_PUBLIC_SUPABASE_URL),
    cleanSupabaseEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    {
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
  ) as BlockwiseSupabaseClient;
}
