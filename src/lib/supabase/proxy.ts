import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  resolveSupabaseAuthCookieName,
  resolveSupabaseServerUrl,
} from "./server-url.ts";

type CookieToSet = { name: string; value: string; options: CookieOptions };

function clean(value?: string): string {
  return value?.replace(/^\uFEFF/, "").trim() ?? "";
}

export async function refreshSupabaseSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = resolveSupabaseServerUrl();
  const key = clean(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );

  if (!url || !key) return { response, authenticated: false };
  const hasSupabaseAuthCookie = request.cookies
    .getAll()
    .some(({ name }) => name.startsWith("sb-") && name.includes("auth-token"));
  if (!hasSupabaseAuthCookie) return { response, authenticated: false };

  const supabase = createServerClient(url, key, {
    cookieOptions: { name: resolveSupabaseAuthCookieName() },
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

  const { data, error } = await supabase.auth.getClaims();
  return { response, authenticated: !error && Boolean(data?.claims?.sub) };
}
