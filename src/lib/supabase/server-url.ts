import { cleanSupabaseEnv, type SupabaseServerEnv } from "./credentials.ts";

const INTERNAL_URL_ENV = "BLOCKWISE_SUPABASE_INTERNAL_URL";

/**
 * Resolve the base URL used by server-side Supabase clients.
 *
 * Browser clients deliberately keep using NEXT_PUBLIC_SUPABASE_URL. In the
 * self-hosted product stack, Node must use the private product-network Caddy
 * endpoint instead of making a TLS round trip through the public Frank edge.
 */
export function resolveSupabaseServerUrl(
  env: SupabaseServerEnv = process.env,
): string {
  const internalUrl = cleanSupabaseEnv(env[INTERNAL_URL_ENV]);
  if (internalUrl) return normalizeSupabaseBaseUrl(internalUrl, INTERNAL_URL_ENV);

  if (cleanSupabaseEnv(env.NODE_ENV) === "production") {
    throw new Error(`${INTERNAL_URL_ENV} is required in production.`);
  }

  const developmentUrl = cleanSupabaseEnv(
    env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL,
  );
  if (!developmentUrl) {
    throw new Error("Supabase server URL environment is missing.");
  }

  return normalizeSupabaseBaseUrl(developmentUrl, "Supabase server URL");
}

/** Keep SSR cookie identity aligned with the public browser client URL. */
export function resolveSupabaseAuthCookieName(
  env: SupabaseServerEnv = process.env,
): string {
  const publicUrl = cleanSupabaseEnv(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!publicUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is required for Supabase auth cookies.");
  }
  const url = new URL(normalizeSupabaseBaseUrl(publicUrl, "NEXT_PUBLIC_SUPABASE_URL"));
  return `sb-${url.hostname.split(".")[0]}-auth-token`;
}

function normalizeSupabaseBaseUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTP(S) origin.`);
  }

  if (!/^https?:$/u.test(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${label} must be a clean HTTP(S) origin.`);
  }

  return url.origin;
}
