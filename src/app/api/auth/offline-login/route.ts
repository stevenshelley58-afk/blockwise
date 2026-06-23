import { NextResponse } from "next/server";

import {
  createOfflineAuthCookieValue,
  getOfflineAuthDisabledReason,
  OFFLINE_AUTH_COOKIE,
  verifyOfflineAuthPassword,
} from "@/lib/auth/offline-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const disabledReason = getOfflineAuthDisabledReason();
  if (disabledReason) {
    return NextResponse.json({ error: disabledReason }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { password?: unknown };
  const password = typeof body.password === "string" ? body.password : "";

  if (!verifyOfflineAuthPassword(password)) {
    return NextResponse.json({ error: "Invalid offline login password." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(OFFLINE_AUTH_COOKIE, createOfflineAuthCookieValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  return response;
}
