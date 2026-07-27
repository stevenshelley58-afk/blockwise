import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { recordProgressiveFunnelEventBestEffort } from "@/lib/analytics/progressive-funnel";
import { acceptVerifiedWorkspaceInvitations } from "@/lib/auth/verified-workspace-invitations";
import { bootstrapVerifiedTrialWorkspace } from "@/lib/auth/verified-workspace-bootstrap";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const DEFAULT_NEXT_PATH = "/self-serve";
const SAFE_REDIRECT_ORIGIN = "https://blockwise.local";

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

function confirmFailedRedirect(request: NextRequest) {
  return NextResponse.redirect(new URL("/login?error=confirm_failed", request.url));
}

function bootstrapFailedRedirect(request: NextRequest) {
  return NextResponse.redirect(new URL("/login?error=workspace_bootstrap_failed", request.url));
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const token_hash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");
  const next = sanitizeNextPath(requestUrl.searchParams.get("next"));

  if (!token_hash || !type) {
    return confirmFailedRedirect(request);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash,
    type: type as EmailOtpType,
  });

  if (error) {
    return confirmFailedRedirect(request);
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return confirmFailedRedirect(request);
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
    properties: { auth_type: type },
  });

  const redirectPath = type === "signup" ? appendConfirmed(next) : next;
  return NextResponse.redirect(new URL(redirectPath, requestUrl.origin));
}

function appendConfirmed(path: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}confirmed=1`;
}
