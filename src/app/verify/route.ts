import { NextResponse, type NextRequest } from "next/server";

import { publicOrigin } from "@/lib/config/public-origin";

// GoTrue's built-in email templates link to `{SITE_URL}/verify?token=...&type=...`
// (the app has no custom GoTrue templates). This route forwards the one-time
// token to the auth server's `/auth/v1/verify` endpoint and lands the browser
// on `/auth/confirm`, which performs the code exchange and workspace bootstrap.
// The emailed `redirect_to` is deliberately ignored: the landing path is
// controlled here so a crafted link cannot redirect users elsewhere.

const ALLOWED_OTP_TYPES = new Set([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

function missingTokenRedirect(requestUrl: URL) {
  return NextResponse.redirect(new URL("/login?error=confirm_failed", requestUrl.origin));
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const token = requestUrl.searchParams.get("token");
  const type = requestUrl.searchParams.get("type") ?? "signup";

  if (!token || !ALLOWED_OTP_TYPES.has(type)) {
    return missingTokenRedirect(requestUrl);
  }

  const supabaseBase = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!supabaseBase) {
    return missingTokenRedirect(requestUrl);
  }

  const verifyTarget = new URL("/auth/v1/verify", supabaseBase);
  verifyTarget.searchParams.set("token", token);
  verifyTarget.searchParams.set("type", type);

  const confirmUrl = new URL("/auth/confirm", publicOrigin(requestUrl));
  confirmUrl.searchParams.set("flow", type);
  verifyTarget.searchParams.set("redirect_to", confirmUrl.toString());

  return NextResponse.redirect(verifyTarget.toString());
}
