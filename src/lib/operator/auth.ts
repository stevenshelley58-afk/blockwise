import { NextResponse } from "next/server";

import { adRadarDisabledResponse } from "../auth/api-guards.ts";
import { hasOperatorAccessFromRows } from "../auth/workspace-access.ts";
import { recordAuditLog } from "../supabase/audit.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";

export type OperatorRole = "owner" | "support";

type OperatorProfileRow = { is_operator?: boolean | null; operator_role?: string | null } | null | undefined;

export type OperatorAuth =
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
      email: string;
      userId: string;
      role: OperatorRole | "legacy-email";
    }
  | { ok: false; response: NextResponse };

export type RequireOperatorOptions = {
  /**
   * Permission matrix: "owner" restricts the route to owner operators.
   * Owner-only: database row/schema viewers, prompt management (promote,
   * rollback, test), runtime provider credential sync, session revocation.
   * Support: customer views/actions, analytics, user lookups.
   */
  minimumRole?: OperatorRole;
};

/**
 * Operator-only guard for /api/operator/* routes.
 *
 * Returns the supabase client if the caller is a logged-in operator through
 * profile (is_operator + operator_role), workspace role, or the legacy
 * OPERATOR_EMAILS break-glass fallback. A named role NEVER grants access on
 * its own: the platform-operator path requires is_operator = true AND a
 * valid operator_role, and the role columns are protected from client
 * writes by the protect_operator_roles migration (self-elevation raises).
 * Legacy-email access is always audited so the named-role migration is
 * observable. When OPERATOR_MFA_REQUIRED=true, sessions below AAL2 are
 * rejected — enable before adding support staff.
 */
export async function requireOperator(options: RequireOperatorOptions = {}): Promise<OperatorAuth> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return { ok: false, response: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  }

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase
      .from("profiles")
      .select("is_operator, operator_role")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.from("workspace_members").select("role").eq("profile_id", user.id),
  ]);

  const operatorRole = normalizeRole((profile as OperatorProfileRow)?.operator_role);
  const isPlatformOperator =
    (profile as OperatorProfileRow)?.is_operator === true && operatorRole !== null;
  const isOperator = isPlatformOperator || hasOperatorAccessFromRows(profile, memberships);
  const isLegacyEmail = isLegacyOperatorEmail(user.email);
  if (!isOperator && !isLegacyEmail) {
    return { ok: false, response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }

  const effectiveRole: OperatorRole = operatorRole ?? "support";
  if (options.minimumRole === "owner" && effectiveRole !== "owner") {
    return { ok: false, response: NextResponse.json({ error: "owner_role_required" }, { status: 403 }) };
  }

  if (process.env.OPERATOR_MFA_REQUIRED === "true") {
    const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.data?.currentLevel !== "aal2") {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "operator_mfa_required", detail: "Confirm second factor before operator actions." },
          { status: 403 },
        ),
      };
    }
  }

  if (!isOperator && isLegacyEmail) {
    // Break-glass: legacy email allowlist used by a non-profile operator.
    // Audit so the named-role migration can be completed deliberately.
    await recordAuditLog(supabase, {
      workspaceId: null,
      actorProfileId: user.id,
      action: "operator.break_glass_access",
      targetType: "operator_session",
      targetId: user.id,
      metadata: { email: user.email },
    });
  }

  return {
    ok: true,
    supabase,
    email: user.email,
    userId: user.id,
    role: isOperator ? effectiveRole : "legacy-email",
  };
}

/** Owner-scoped operator guard (permission matrix: dangerous routes). */
export async function requireOwnerOperator(): Promise<OperatorAuth> {
  return requireOperator({ minimumRole: "owner" });
}

/** Gate dormant research operations before creating an auth or database client. */
export async function requireAdRadarOperator(): Promise<OperatorAuth> {
  const featureGate = adRadarDisabledResponse();
  if (featureGate) return { ok: false, response: featureGate };
  return requireOperator();
}

export function isOwnerRole(auth: Extract<OperatorAuth, { ok: true }>): boolean {
  return auth.role === "owner";
}

function normalizeRole(role: string | null | undefined): OperatorRole | null {
  return role === "owner" || role === "support" ? role : null;
}

function isLegacyOperatorEmail(email: string): boolean {
  const allowed = (process.env.OPERATOR_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.toLowerCase());
}
