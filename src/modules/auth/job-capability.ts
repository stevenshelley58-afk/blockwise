import type { SupabaseClient } from "@supabase/supabase-js";

import type { WorkspaceMode, WorkspaceRole } from "./access-control.ts";
import { hasCapability, type Capability, type CapabilityContext } from "./capabilities.ts";

type ServiceClient = Pick<SupabaseClient, "from">;

type MembershipRow = {
  role: WorkspaceRole;
  workspaces:
    | { mode: WorkspaceMode | string | null }
    | Array<{ mode: WorkspaceMode | string | null }>
    | null;
};

/**
 * Capability gate for Trigger.dev jobs.
 *
 * Jobs run with the service-role key and BYPASS RLS, so this in-code check is
 * the only enforcement layer for sensitive task logic. Loads the actor's
 * operator flag and workspace role via the service client and throws if the
 * required {@link Capability} is not held.
 */
export async function assertJobCapability(
  service: ServiceClient,
  actorProfileId: string | null,
  workspaceId: string,
  capability: Capability,
): Promise<void> {
  if (!actorProfileId) {
    throw new Error(`Job requires capability "${capability}" but no actor profile was provided.`);
  }

  const [{ data: profile }, { data: membership }] = await Promise.all([
    service.from("profiles").select("is_operator").eq("id", actorProfileId).maybeSingle(),
    service
      .from("workspace_members")
      .select("role, workspaces(mode)")
      .eq("profile_id", actorProfileId)
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
  ]);

  const isOperator = Boolean((profile as { is_operator?: boolean } | null)?.is_operator);

  if (!isOperator && !membership) {
    throw new Error(
      `Actor ${actorProfileId} has no membership in workspace ${workspaceId} and is not an operator.`,
    );
  }

  const row = membership as MembershipRow | null;
  const workspace = row ? (Array.isArray(row.workspaces) ? row.workspaces[0] : row.workspaces) : null;
  const ctx: CapabilityContext = {
    role: row?.role ?? "operator",
    workspaceMode: workspace?.mode === "self_serve" ? "self_serve" : "monitor",
    isOperator,
  };

  if (!hasCapability(ctx, capability)) {
    throw new Error(
      `Actor ${actorProfileId} lacks capability "${capability}" in workspace ${workspaceId}.`,
    );
  }
}
