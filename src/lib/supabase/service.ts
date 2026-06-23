import { createClient } from "@supabase/supabase-js";

import { getOfflineAuthSessionTemplate, isOfflineAuthEnabled } from "../auth/offline-config.ts";
import { cleanSupabaseEnv } from "./env.ts";
import { createOfflineSupabaseClient } from "./offline.ts";
import type { BlockwiseSupabaseClient } from "./types.ts";

export function createSupabaseServiceClient(): BlockwiseSupabaseClient {
  if (isOfflineAuthEnabled()) {
    return createOfflineSupabaseClient(getOfflineAuthSessionTemplate()) as unknown as BlockwiseSupabaseClient;
  }

  const supabaseUrl = cleanSupabaseEnv(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = cleanSupabaseEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase service-role environment is missing.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }) as BlockwiseSupabaseClient;
}
