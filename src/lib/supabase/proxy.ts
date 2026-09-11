import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { accessTokenExpirySeconds } from "./access-token.ts";

type CookieToSet = { name: string; value: string; options: CookieOptions };

function clean(value?: string): string {
  return value?.replace(/^\uFEFF/, "").trim() ?? "";
}

/** Refresh this long before the token actually expires. */
const REFRESH_MARGIN_SECONDS = 300;

export async function refreshSupabaseSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = clean(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );

  if (!url || !key) return { response, authenticated: false };
  const hasSupabaseAuthCookie = request.cookies
    .getAll()
    .some(({ name }) => name.startsWith("sb-") && name.includes("auth-token"));
  if (!hasSupabaseAuthCookie) return { response, authenticated: false };

  // This project signs tokens with the legacy HS256 secret, and auth-js can
  // only verify an HS256 token by asking the Auth server. Calling getClaims()
  // on every matched request therefore put a full Auth round trip in front of
  // every page render and every API call (measured ~219ms per authenticated
  // request, through the public edge). The proxy's actual job is keeping the
  // session cookie fresh, so do that only when the token is near expiry and
  // let the verifying surfaces below decide identity.
  const expiry = accessTokenExpirySeconds(request.cookies);
  if (expiry !== null && expiry - REFRESH_MARGIN_SECONDS > Date.now() / 1000) {
    return { response, authenticated: true };
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet: CookieToSet[], headersToSet?: Record<string, string>) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headersToSet ?? {}).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });

  // getClaims() throws on an expired or malformed token rather than returning
  // an error result, so this refresh used to fail the whole request with a 500
  // instead of letting it continue unauthenticated and reach /login.
  try {
    const { data, error } = await supabase.auth.getClaims();
    return { response, authenticated: !error && Boolean(data?.claims?.sub) };
  } catch {
    return { response, authenticated: false };
  }
}
