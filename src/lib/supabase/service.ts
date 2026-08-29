import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

import {
  cleanSupabaseEnv,
  createSupabaseServerFetch,
  resolveSupabaseServerCredential,
  type SupabaseServerEnv,
} from "./credentials.ts";

export function createSupabaseServiceClient(options: {
  env?: SupabaseServerEnv;
  fetchImpl?: typeof fetch;
} = {}) {
  const env = options.env ?? process.env;
  const supabaseUrl = cleanSupabaseEnv(env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL);
  const credential = resolveSupabaseServerCredential(env);

  if (!supabaseUrl || !credential) {
    throw new Error("Supabase service-role environment is missing.");
  }

  return createClient(supabaseUrl, credential.value, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: createSupabaseServerFetch(credential, options.fetchImpl),
    },
    // Service clients do not subscribe to Realtime, but supabase-js still
    // resolves a transport during construction. Provide the standard server
    // implementation so Vercel and the VPS use the same client contract.
    realtime: {
      transport: WebSocket as unknown as typeof globalThis.WebSocket,
    },
  });
}
