import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Well-known, security-sensitive audit actions. `action` accepts any string so
 * existing freeform actions (e.g. `meta_publish_succeeded`) keep working, while
 * this union documents the operator actions that MUST be audited.
 */
export type AuditAction =
  | "run_for_client"
  | "publish_ads"
  | "approve_campaign"
  | "change_api_keys"
  | "change_model_settings"
  | "start_hermes_job"
  | "stop_hermes_job";

// Any audit-capable Supabase client (server-scoped or service-role).
type AuditCapableClient = Pick<SupabaseClient, "from">;

export type AuditEntry = {
  /** The workspace affected by the action. */
  workspaceId: string;
  /** WHO performed the action. Null only for unattributable system events. */
  actorProfileId: string | null;
  action: AuditAction | (string & {});
  targetType: string;
  /** Must be a uuid (audit_logs.target_id is uuid-typed) or null. */
  targetId?: string | null;
  /** Set when an operator acts on behalf of a client workspace. */
  onBehalfOf?: boolean;
  viaCapability?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Typed wrapper over the `audit_logs` insert. Captures the run-for-client
 * envelope (operator identity + affected workspace) in `metadata`, since
 * `audit_logs.target_id` is uuid-typed and cannot hold arbitrary strings.
 *
 * Audit failures are logged but never throw — recording an audit log must not
 * fail the underlying business operation.
 */
export async function recordAudit(client: AuditCapableClient, entry: AuditEntry): Promise<void> {
  const metadata: Record<string, unknown> = { ...(entry.metadata ?? {}) };

  if (entry.onBehalfOf) {
    metadata.onBehalfOf = true;
    metadata.viaCapability = entry.viaCapability ?? "run_for_client";
    metadata.affectedWorkspaceId = entry.workspaceId;
  }

  const { error } = await client.from("audit_logs").insert({
    workspace_id: entry.workspaceId,
    actor_profile_id: entry.actorProfileId,
    action: entry.action,
    target_type: entry.targetType,
    target_id: entry.targetId ?? null,
    metadata,
  });

  if (error) {
    console.warn(`[audit] failed to record "${entry.action}" for workspace ${entry.workspaceId}:`, error.message);
  }
}
