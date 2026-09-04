import type { SupabaseClient } from "@supabase/supabase-js";
import type { OpsActionEnvelope } from "../../../src/lib/ops/action-contract.ts";
import type { NonceStore } from "./auth.ts";

export type ClaimedAction = {
  id: string; action_id: string; idempotency_key: string; created_at: string; workspace_id: string; customer_id: string; actor_operator_id: string; actor_role: string;
  action_type: string; target_type: string; target_id: string; expected_version: number; reason: string; payload: Record<string, unknown>;
  attempts: number; max_attempts: number; expires_at: string; lease_token: string;
};
export type ActionStatus = { actionId: string; workspaceId: string; status: string; receiptIds: string[]; latestReceipt: Record<string, unknown> | null };

export interface ActionRepository extends NonceStore {
  ready(): Promise<boolean>;
  reap(): Promise<number>;
  enqueue(action: OpsActionEnvelope): Promise<{ id: string; actionId: string; status: string }>;
  status(actionId: string, workspaceId: string): Promise<ActionStatus | null>;
  claim(): Promise<ClaimedAction | null>;
  heartbeat(id: string, leaseToken: string): Promise<boolean>;
  complete(id: string, leaseToken: string, safeResult: Record<string, unknown>): Promise<boolean>;
  fail(id: string, leaseToken: string, error: string, retryable: boolean): Promise<string | null>;
}

export class SupabaseActionRepository implements ActionRepository {
  private readonly db: SupabaseClient;
  constructor(db: SupabaseClient) { this.db = db; }
  async ready(): Promise<boolean> { const { error } = await this.db.from("ops_action_capabilities").select("action_type").limit(1); return !error; }
  async reap(): Promise<number> { const value = await this.rpcScalar("reap_ops_actions", {}); return Number(value ?? 0); }
  async consume(nonce: string, expiresAt: Date): Promise<boolean> {
    await this.db.from("internal_request_nonces").delete().lt("expires_at", new Date(Date.now() - 600000).toISOString());
    const { data, error } = await this.db.from("internal_request_nonces").upsert({ nonce, expires_at: expiresAt.toISOString() }, { onConflict: "nonce", ignoreDuplicates: true }).select("nonce");
    if (error) throw new Error("nonce_store_unavailable");
    return Array.isArray(data) && data.length > 0;
  }
  async enqueue(action: OpsActionEnvelope): Promise<{ id: string; actionId: string; status: string }> {
    const { data, error } = await this.db.rpc("enqueue_ops_action", {
      p_action_id: action.actionId, p_idempotency_key: action.idempotencyKey, p_workspace_id: action.workspaceId, p_customer_id: action.customerId,
      p_action_type: action.action, p_target_type: action.target.type, p_target_id: action.target.id, p_actor_operator_id: action.actor.operatorId,
      p_actor_role: action.actor.role, p_actor_aal: action.actor.aal, p_expected_version: action.expectedVersion, p_reason: action.reason,
      p_created_at: action.createdAt, p_expires_at: action.expiresAt, p_payload: action.payload,
    });
    if (error) throw new Error(error.message);
    const id = typeof data === "string" ? data : (data as { id?: string })?.id;
    if (!id) throw new Error("enqueue returned no action id");
    const result = await this.db.from("ops_action_outbox").select("id,action_id,status").eq("action_id", action.actionId).single();
    if (result.error || !result.data) throw new Error("action status unavailable");
    return { id: String(result.data.id), actionId: String(result.data.action_id), status: String(result.data.status) };
  }
  async status(actionId: string, workspaceId: string): Promise<ActionStatus | null> {
    const row = await this.db.from("ops_action_outbox").select("action_id,workspace_id,status").eq("action_id", actionId).eq("workspace_id", workspaceId).maybeSingle();
    if (row.error) throw new Error("action status unavailable");
    if (!row.data) return null;
    const receipts = await this.db.from("ops_action_receipts").select("receipt_id,status,transition_seq,created_at,safe_result,safe_error").eq("action_id", actionId).order("transition_seq", { ascending: true });
    if (receipts.error) throw new Error("action receipts unavailable");
    const values = (receipts.data ?? []) as Array<Record<string, unknown>>;
    return { actionId, workspaceId, status: String(row.data.status), receiptIds: values.map((x) => String(x.receipt_id)), latestReceipt: values.at(-1) ?? null };
  }
  async claim(): Promise<ClaimedAction | null> {
    const row = await this.rpcOne("claim_ops_action", { p_lease_seconds: 600 });
    if (!row) return null;
    const detail = await this.db.from("ops_action_outbox").select("idempotency_key,created_at").eq("id", row.id).single();
    if (detail.error || !detail.data) throw new Error("claimed action identity unavailable");
    return { ...row, idempotency_key: String(detail.data.idempotency_key), created_at: String(detail.data.created_at) };
  }
  async heartbeat(id: string, leaseToken: string): Promise<boolean> { return Boolean(await this.rpcScalar("heartbeat_ops_action", { p_id: id, p_lease_token: leaseToken, p_lease_seconds: 600 })); }
  async complete(id: string, leaseToken: string, safeResult: Record<string, unknown>): Promise<boolean> { return Boolean(await this.rpcScalar("complete_ops_action", { p_id: id, p_lease_token: leaseToken, p_safe_result: safeResult })); }
  async fail(id: string, leaseToken: string, error: string, retryable: boolean): Promise<string | null> { const value = await this.rpcScalar("fail_ops_action", { p_id: id, p_lease_token: leaseToken, p_error: error.slice(0, 500), p_retryable: retryable }); return value == null ? null : String(value); }
  private async rpcScalar(fn: string, args: Record<string, unknown>): Promise<unknown> { const { data, error } = await this.db.rpc(fn, args); if (error) throw new Error(error.message); return data; }
  private async rpcOne(fn: string, args: Record<string, unknown>): Promise<ClaimedAction | null> { const { data, error } = await this.db.rpc(fn, args); if (error) throw new Error(error.message); const row = Array.isArray(data) ? data[0] : data; return row ? row as ClaimedAction : null; }
}

export async function createSupabaseRepository(url: string, serviceRoleKey: string): Promise<SupabaseActionRepository> {
  const { createClient } = await import("@supabase/supabase-js");
  return new SupabaseActionRepository(createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } }));
}
