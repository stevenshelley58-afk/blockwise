import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { recordProgressiveFunnelEventBestEffort } from "@/lib/analytics/progressive-funnel";
import { publicOrigin } from "@/lib/config/public-origin";
import { acceptVerifiedWorkspaceInvitations } from "@/lib/auth/verified-workspace-invitations";
import { bootstrapVerifiedTrialWorkspace } from "@/lib/auth/verified-workspace-bootstrap";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const DEFAULT_NEXT_PATH = "/self-serve";
const SAFE_REDIRECT_ORIGIN = "https://blockwise.local";

/**
 * Sent back with a failed confirmation so the sign-in page can say what went
 * wrong. An OAuth hand-off that never started is retryable by pressing the
 * provider button again; an email link needs a fresh email instead.
 */
export type ConfirmFailure = "oauth" | "email";

function sanitizeNextPath(next: string | null) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return DEFAULT_NEXT_PATH;
  }

  try {
    const parsed = new URL(next, SAFE_REDIRECT_ORIGIN);
    if (parsed.origin !== SAFE_REDIRECT_ORIGIN) {
      return DEFAULT_NEXT_PATH;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_NEXT_PATH;
  }
}

function confirmFailedRedirect(request: NextRequest, failure: ConfirmFailure) {
  return NextResponse.redirect(new URL(`/login?error=confirm_failed&flow=${failure}`, publicOrigin(request.url)));
}

function bootstrapFailedRedirect(request: NextRequest) {
  return NextResponse.redirect(new URL("/access-unavailable?reason=workspace_bootstrap_failed", publicOrigin(request.url)));
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const token_hash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");
  const code = requestUrl.searchParams.get("code");
  const flow = requestUrl.searchParams.get("flow");
  const next = sanitizeNextPath(requestUrl.searchParams.get("next"));

  // The app logs no requests, so a provider sign-in that arrives with the wrong
  // parameters, or never arrives, is invisible. Record what this route actually
  // received before doing anything with it.
  console.log(
    `auth/confirm received: mechanism=${code ? "pkce_code" : token_hash ? `otp_${type}` : "no_parameters"} ` +
      `flow=${flow ?? "-"} next=${next} params=${[...requestUrl.searchParams.keys()].join(",") || "-"} ` +
      `referer=${request.headers.get("referer") ?? "-"}`,
  );

  const supabase = await createSupabaseServerClient();
  const authError = code
    ? (await supabase.auth.exchangeCodeForSession(code)).error
    : token_hash && type
      ? (await supabase.auth.verifyOtp({ token_hash, type: type as EmailOtpType })).error
      : new Error("Confirmation parameters are missing.");

  // A failed exchange used to redirect in silence, which left a provider
  // sign-in with no way to tell a missing PKCE verifier from an expired link.
  // Log the mechanism and the provider's own message so the failure is
  // diagnosable from the container log alone.
  const failure: ConfirmFailure = code || flow === "signin" || flow === "signup" ? "oauth" : "email";

  if (authError) {
    console.error(
      `auth/confirm exchange failed (${failure}, mechanism=${code ? "pkce_code" : token_hash ? `otp_${type}` : "no_parameters"}): ${authError.message}`,
    );
    return confirmFailedRedirect(request, failure);
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    console.error(`auth/confirm found no user after a successful exchange: ${userError?.message ?? "no user returned"}`);
    return confirmFailedRedirect(request, failure);
  }

  const isRecovery = flow === "recovery" || type === "recovery";
  const isSignup = flow === "signup" || type === "signup";
  if (isRecovery) {
    return NextResponse.redirect(new URL(next, publicOrigin(requestUrl)));
  }

  const service = createSupabaseServiceClient();
  let workspaceId: string | null = null;
  try {
    await acceptVerifiedWorkspaceInvitations({ user });
    const bootstrap = await bootstrapVerifiedTrialWorkspace({ user, serviceSupabase: service });
    workspaceId = bootstrap.workspaceId;
  } catch (bootstrapError) {
    console.error("Verified workspace bootstrap failed", bootstrapError);
    return bootstrapFailedRedirect(request);
  }

  await recordProgressiveFunnelEventBestEffort(service, {
    eventName: "email_verified",
    workspaceId,
    country: null,
    acquisitionSource: "unattributed",
    idempotencyKey: `auth:verified:${user.id}:${workspaceId ?? "unassigned"}`,
    properties: { auth_type: type ?? flow ?? "pkce" },
  });

  const redirectPath = isSignup ? appendConfirmed(next) : next;
  return NextResponse.redirect(new URL(redirectPath, publicOrigin(requestUrl)));
}

function appendConfirmed(path: string): string {
  const url = new URL(path, SAFE_REDIRECT_ORIGIN);
  url.searchParams.set("confirmed", "1");
  return `${url.pathname}${url.search}${url.hash}`;
}
