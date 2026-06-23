import { NextResponse, type NextRequest } from "next/server";

const OFFLINE_AUTH_COOKIE = "blockwise_offline_auth";
const OFFLINE_AUTH_TOKEN_SALT = "blockwise-offline-auth-v1";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected =
    pathname.startsWith("/api/adstudio/") || pathname.startsWith("/api/operator/");

  if (!isProtected) return NextResponse.next();

  // Check for Supabase auth cookie (sb-*-auth-token)
  const hasCookie = [...request.cookies.getAll()].some(
    (c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token"),
  );

  const hasOfflineCookie = await hasValidOfflineCookie(request);

  if (!hasCookie && !hasOfflineCookie) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  return NextResponse.next();
}

async function hasValidOfflineCookie(request: NextRequest): Promise<boolean> {
  const password = process.env.BLOCKWISE_DEV_PASSWORD?.trim() ?? "";
  if (process.env.BLOCKWISE_OFFLINE_AUTH_ENABLED !== "true" || password.length < 16) {
    return false;
  }

  const token = request.cookies.get(OFFLINE_AUTH_COOKIE)?.value;
  if (!token) return false;

  const expected = await sha256Hex(`${OFFLINE_AUTH_TOKEN_SALT}:${password}`);
  return token === expected;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const config = {
  matcher: ["/api/adstudio/:path*", "/api/operator/:path*"],
};
