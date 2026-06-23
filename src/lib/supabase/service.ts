import { createClient } from "@supabase/supabase-js";

import { cleanSupabaseEnv } from "./env.ts";

export function createSupabaseServiceClient() {
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
  });
}
