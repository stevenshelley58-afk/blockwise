import * as Sentry from "@sentry/nextjs";
import { cache } from "react";

import type { WorkspaceMode, WorkspaceRole } from "./access-control.ts";
import { createSupabaseServerClient } from "../supabase/server.ts";

export type RequestAuthClaims = {
  sub: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
};

export type RequestAuthProfile = {
  full_name: string | null;
  email: string | null;
  is_operator: boolean | null;
};

export type RequestAuthMembershipRow = {
  role: WorkspaceRole;
  workspaces:
    | {
        id: string;
        name: string;
        mode: WorkspaceMode;
        region: string | null;
      }
    | Array<{
        id: string;
        name: string;
        mode: WorkspaceMode;
        region: string | null;
      }>
    | null;
};

export type RequestAuthContext = {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  claims: RequestAuthClaims | null;
  profile: RequestAuthProfile | null;
  memberships: RequestAuthMembershipRow[];
};

type SupabaseServerClient = RequestAuthContext["supabase"];

export async function loadRequestAuthContext(supabase: SupabaseServerClient): Promise<RequestAuthContext> {
  return Sentry.startSpan(
    {
      name: "Resolve request authentication context",
      op: "auth.resolve",
    },
    async (span) => {
      const claimsResult = await Sentry.startSpan(
        {
          name: "Verify Supabase JWT claims",
          op: "auth.claims",
        },
        () => supabase.auth.getClaims(),
      );
      const claims = (claimsResult.data?.claims ?? null) as RequestAuthClaims | null;

      span.setAttribute("auth.authenticated", Boolean(claims?.sub));

      if (!claims?.sub) {
        return {
          supabase,
          claims: null,
          profile: null,
          memberships: [],
        };
      }

      const [{ data: profile }, { data: memberships }] = await Sentry.startSpan(
        {
          name: "Load profile and workspace memberships",
          op: "db.workspace_access",
        },
        () =>
          Promise.all([
            supabase.from("profiles").select("full_name,email,is_operator").eq("id", claims.sub).maybeSingle(),
            supabase
              .from("workspace_members")
              .select("role, workspaces(id, name, mode, region)")
              .eq("profile_id", claims.sub)
              .order("created_at", { ascending: true }),
          ]),
      );
      const membershipRows = (memberships ?? []) as RequestAuthMembershipRow[];

      span.setAttribute("auth.membership_count", membershipRows.length);

      return {
        supabase,
        claims,
        profile: (profile as RequestAuthProfile | null) ?? null,
        memberships: membershipRows,
      };
    },
  );
}

/**
 * React cache is request-scoped for Server Components. The shell and page
 * guard therefore share one Supabase client, one claims verification, and one
 * profile/membership read without leaking identity across requests.
 */
export const getRequestAuthContext = cache(async () => {
  const supabase = await createSupabaseServerClient();
  return loadRequestAuthContext(supabase);
});
