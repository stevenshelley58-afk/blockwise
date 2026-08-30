import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

import {
  createSupabaseServerFetch,
  resolveSupabaseServerCredential,
  type SupabaseServerEnv,
} from "./credentials.ts";
import { resolveSupabaseServerUrl } from "./server-url.ts";

export function createSupabaseServiceClient(options: {
  env?: SupabaseServerEnv;
  fetchImpl?: typeof fetch;
} = {}) {
  const env = options.env ?? process.env;
  const supabaseUrl = resolveSupabaseServerUrl(env);
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
