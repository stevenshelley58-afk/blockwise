import type { createSupabaseServerClient } from "@/lib/supabase/server";

import {
  canAccessSurface,
  type ProductSurface,
  type WorkspaceMode,
  type WorkspaceRole,
} from "./access-control.ts";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type WorkspaceAccessMembership = {
  workspaceId: string;
  workspaceMode: WorkspaceMode;
  role: WorkspaceRole;
  workspaceName?: string;
  region?: string;
};

export type WorkspaceAccess = WorkspaceAccessMembership & {
  userId: string;
  isOperator: boolean;
};

type ResolveWorkspaceInput = {
  isOperator: boolean;
  memberships: WorkspaceAccessMembership[];
  requestedWorkspaceId?: string | null;
  surface: ProductSurface;
};

export type WorkspaceAccessResult =
  | { ok: true; access: Omit<WorkspaceAccess, "userId">; status?: never; error?: never }
  | { ok: false; status: 401 | 403 | 404; error: string };

type MembershipRow = {
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

type WorkspaceAccessAuthContext = {
  supabase: SupabaseServerClient;
  claims: { sub: string } | null;
  profile: { is_operator?: boolean | null } | null;
  memberships: MembershipRow[];
};

export function hasOperatorAccessFromRows(
  profile: { is_operator?: boolean | null } | null | undefined,
  memberships: Array<{ role?: string | null }> | null | undefined,
): boolean {
  return Boolean(profile?.is_operator) || (memberships ?? []).some((membership) => membership.role === "operator");
}

export function resolveRequestedWorkspaceAccess(input: ResolveWorkspaceInput): WorkspaceAccessResult {
  const requestedWorkspaceId = input.requestedWorkspaceId?.trim() || null;

  if (input.isOperator) {
    const operatorMembership = requestedWorkspaceId
      ? input.memberships.find((membership) => membership.workspaceId === requestedWorkspaceId)
      : input.memberships[0];

    return {
      ok: true,
      access: {
        workspaceId: requestedWorkspaceId ?? operatorMembership?.workspaceId ?? "",
        workspaceMode: operatorMembership?.workspaceMode ?? "monitor",
        workspaceName: operatorMembership?.workspaceName,
        region: operatorMembership?.region,
        role: "operator",
        isOperator: true,
      },
    };
  }

  const membership = requestedWorkspaceId
    ? input.memberships.find((item) => item.workspaceId === requestedWorkspaceId)
    : input.memberships[0];

  if (!membership) {
    return {
      ok: false,
      status: requestedWorkspaceId ? 403 : 404,
      error: requestedWorkspaceId ? "Workspace access is not allowed." : "No workspace membership was found.",
    };
  }

  if (!canAccessSurface({ role: membership.role, workspaceMode: membership.workspaceMode }, input.surface)) {
    return {
      ok: false,
      status: 403,
      error: `${input.surface.replace("_", " ")} access is not allowed for this workspace.`,
    };
  }

  return {
    ok: true,
    access: {
      ...membership,
      isOperator: false,
    },
  };
}

export async function requireWorkspaceAccess(
  supabase: SupabaseServerClient,
  input: { surface: ProductSurface; requestedWorkspaceId?: string | null },
): Promise<{ ok: true; access: WorkspaceAccess } | { ok: false; status: 401 | 403 | 404; error: string }> {
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims?.sub ? { sub: data.claims.sub } : null;

  if (!claims) {
    return { ok: false, status: 401, error: "Authentication is required." };
  }

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from("profiles").select("is_operator").eq("id", claims.sub).maybeSingle(),
    supabase
      .from("workspace_members")
      .select("role, workspaces(id, name, mode, region)")
      .eq("profile_id", claims.sub)
      .order("created_at", { ascending: true }),
  ]);

  return requireWorkspaceAccessFromContext(
    {
      supabase,
      claims,
      profile,
      memberships: (memberships ?? []) as MembershipRow[],
    },
    input,
  );
}

export async function requireWorkspaceAccessFromContext(
  context: WorkspaceAccessAuthContext,
  input: { surface: ProductSurface; requestedWorkspaceId?: string | null },
): Promise<{ ok: true; access: WorkspaceAccess } | { ok: false; status: 401 | 403 | 404; error: string }> {
  if (!context.claims) {
    return { ok: false, status: 401, error: "Authentication is required." };
  }

  const normalizedMemberships = context.memberships.flatMap(normalizeMembershipRow);
  const isOperator = hasOperatorAccessFromRows(context.profile, normalizedMemberships);
  let resolved = resolveRequestedWorkspaceAccess({
    isOperator,
    memberships: normalizedMemberships,
    requestedWorkspaceId: input.requestedWorkspaceId,
    surface: input.surface,
  });

  if (isOperator && resolved.ok && !resolved.access.workspaceId) {
    const fallback = await loadOperatorFallbackWorkspace(context.supabase);

    if (fallback) {
      resolved = {
        ok: true,
        access: {
          ...fallback,
          role: "operator",
          isOperator: true,
        },
      };
    }
  }

  if (!resolved.ok) {
    return resolved;
  }

  return {
    ok: true,
    access: {
      ...resolved.access,
      userId: context.claims.sub,
      isOperator,
    },
  };
}

function normalizeMembershipRow(row: MembershipRow): WorkspaceAccessMembership[] {
  const workspace = Array.isArray(row.workspaces) ? row.workspaces[0] : row.workspaces;

  if (!workspace?.id) {
    return [];
  }

  return [
    {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceMode: workspace.mode === "self_serve" ? "self_serve" : "monitor",
      region: workspace.region ?? "AU",
      role: row.role,
    },
  ];
}

async function loadOperatorFallbackWorkspace(supabase: SupabaseServerClient): Promise<WorkspaceAccessMembership | null> {
  const { data } = await supabase
    .from("workspaces")
    .select("id, name, mode, region")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data?.id) {
    return null;
  }

  return {
    workspaceId: data.id,
    workspaceName: data.name,
    workspaceMode: data.mode === "self_serve" ? "self_serve" : "monitor",
    region: data.region ?? "AU",
    role: "operator",
  };
}
