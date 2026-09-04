/** Pure checks shared by the internal executor and focused contract tests. */
export function sameQueuedEnvelope(body: Record<string, unknown>, row: Record<string, unknown>): boolean {
  const actor = record(body.actor);
  const target = record(body.target);
  return body.schema === "blockwise.ops.action.v1"
    && body.actionId === row.action_id
    && body.idempotencyKey === row.idempotency_key
    && body.workspaceId === row.workspace_id
    && body.customerId === row.customer_id
    && body.action === row.action_type
    && body.expectedVersion === Number(row.expected_version)
    && body.reason === row.reason
    && actor?.operatorId === row.actor_operator_id
    && actor?.role === row.actor_role
    && actor?.aal === row.actor_aal
    && target?.type === row.target_type
    && target?.id === row.target_id
    && stableJson(body.payload) === stableJson(row.payload)
    && normalizeTime(body.createdAt) === normalizeTime(row.created_at)
    && normalizeTime(body.expiresAt) === normalizeTime(row.expires_at);
}

export function isSubscriptionBound(subscription: Record<string, unknown>, storedSubscriptionId: string, workspaceId: string): boolean {
  const metadata = record(subscription.metadata);
  return subscription.id === storedSubscriptionId && metadata?.workspace_id === workspaceId;
}

export function normalizeTime(value: unknown): string {
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
