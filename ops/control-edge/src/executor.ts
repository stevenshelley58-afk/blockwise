import { randomBytes } from "node:crypto";
import { request } from "node:https";
import type { ClaimedAction, ActionRepository } from "./repository.ts";
import { signRequest } from "./auth.ts";

const AVAILABLE = new Set(["team_invite", "team_resend", "team_cancel", "session_revoke", "enquiry_assign", "billing_reconcile"]);
export class ExecutorError extends Error { readonly retryable: boolean; constructor(message: string, retryable: boolean) { super(message); this.retryable = retryable; } }
export type ExecutorResult = { operationId?: string; status?: string };

export class InternalBlockwiseExecutor {
  private readonly baseUrl: string; private readonly secret: string; private readonly timeoutMs: number;
  constructor(baseUrl: string, secret: string, timeoutMs = 30000) { this.baseUrl = baseUrl; this.secret = secret; this.timeoutMs = timeoutMs; }
  async execute(action: ClaimedAction): Promise<ExecutorResult> {
    if (!AVAILABLE.has(action.action_type)) throw new ExecutorError("action_capability_not_available", false);
    if (!this.baseUrl) throw new ExecutorError("action_executor_not_configured", false);
    const body = JSON.stringify({ schema: "blockwise.ops.action.v1", actionId: action.action_id, workspaceId: action.workspace_id, customerId: action.customer_id, actor: { operatorId: action.actor_operator_id, role: action.actor_role, aal: "aal2" }, action: action.action_type, target: { type: action.target_type, id: action.target_id }, expectedVersion: action.expected_version, reason: action.reason, payload: action.payload });
    const url = new URL("/internal/customer-ops/actions", this.baseUrl);
    const timestamp = Math.floor(Date.now() / 1000).toString(); const nonce = randomBytes(18).toString("base64url");
    const signature = signRequest(this.secret, { timestamp, nonce, scope: "ops.execute", method: "POST", path: `${url.pathname}${url.search}`, body });
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new ExecutorError("executor_timeout", true)), this.timeoutMs);
      const req = request(url, { method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), "x-blockwise-timestamp": timestamp, "x-blockwise-nonce": nonce, "x-blockwise-scope": "ops.execute", "x-blockwise-signature": signature } }, (res) => {
        const chunks: Buffer[] = []; res.on("data", (chunk) => chunks.push(Buffer.from(chunk))); res.on("end", () => { clearTimeout(timer); resolve({ status: res.statusCode ?? 599, body: Buffer.concat(chunks).toString("utf8").slice(0, 8192) }); });
      });
      req.on("error", (error) => { clearTimeout(timer); reject(new ExecutorError(error.message.slice(0, 200), true)); }); req.write(body); req.end();
    });
    if (response.status === 429 || response.status >= 500) throw new ExecutorError(`executor_http_${response.status}`, true);
    if (response.status < 200 || response.status >= 300) throw new ExecutorError(`executor_http_${response.status}`, false);
    try { const parsed = JSON.parse(response.body) as Record<string, unknown>; if (parsed.status && typeof parsed.status !== "string") throw new Error(); return { operationId: typeof parsed.operationId === "string" ? parsed.operationId : undefined, status: typeof parsed.status === "string" ? parsed.status : "accepted" }; } catch { throw new ExecutorError("executor_invalid_response", false); }
  }
}

export async function runOneAction(repo: ActionRepository, executor: InternalBlockwiseExecutor): Promise<boolean> {
  const action = await repo.claim(); if (!action) return false;
  try {
    if (!(await repo.heartbeat(action.id, action.lease_token))) return true;
    const result = await executor.execute(action);
    const settled = await repo.complete(action.id, action.lease_token, { status: result.status ?? "accepted", ...(result.operationId ? { operationId: result.operationId } : {}) });
    if (!settled) return true;
  } catch (error) {
    const typed = error instanceof ExecutorError ? error : new ExecutorError("executor_failed", true);
    try { await repo.fail(action.id, action.lease_token, typed.message, typed.retryable); } catch { /* the lease/reaper owns recovery */ }
  }
  return true;
}
