type AuditClient = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
  };
};

export type AuditLogEntry = {
  /** null for platform-level actions not scoped to a workspace (e.g. research jobs). */
  workspaceId: string | null;
  /** null for system actors (trigger.dev tasks, workers running service-role). */
  actorProfileId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Single write path for audit_logs. Audit failures are logged but never
 * thrown — an audit miss must not fail the underlying action.
 */
export async function recordAuditLog(client: AuditClient, entry: AuditLogEntry): Promise<void> {
  const { error } = await client.from("audit_logs").insert({
    workspace_id: entry.workspaceId,
    actor_profile_id: entry.actorProfileId,
    action: entry.action,
    target_type: entry.targetType,
    target_id: entry.targetId ?? null,
    correlation_id: entry.correlationId ?? null,
    metadata: entry.metadata ?? {},
  });

  if (error) {
    console.error(`[audit] failed to record ${entry.action}`, error.message);
  }
}
