/** Hermes-only provider action lane. Unlike projections, these operations are
 * action-owned: the action is completed only after the exact provider step and
 * its receipt are durable. The web/control edge never receives provider creds.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { createSupabaseServiceClient } from "../src/lib/supabase/service.ts";

type Supabase = ReturnType<typeof createSupabaseServiceClient>;
type Action = { id: string; action_id: string; workspace_id: string; action_type: string; target_id: string; expected_version: number; payload: Record<string, unknown>; lease_token: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
class ProviderActionError extends Error { constructor(message: string, readonly retryable: boolean) { super(message); } }

export async function runOpsActionOnce(supabase: Supabase, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const claimed = await Promise.resolve(supabase.rpc("claim_ops_provider_action", { p_lease_seconds: 600 }));
  if (claimed.error) throw new Error("customer operations action claim failed");
  const action = ((claimed.data ?? []) as Action[])[0];
  if (!action) return false;
  try {
    if (!UUID.test(action.workspace_id) || !UUID.test(action.target_id)) throw new Error("invalid action target");
    const result = await executeChatwootAction(supabase, action, fetchImpl);
    const completed = await Promise.resolve(supabase.rpc("complete_ops_action", { p_id: action.id, p_lease_token: action.lease_token, p_safe_result: result }));
    if (completed.error || completed.data !== true) throw new Error("action completion lease lost");
  } catch (error) {
    await Promise.resolve(supabase.rpc("fail_ops_action", { p_id: action.id, p_lease_token: action.lease_token, p_error: redact(error instanceof Error ? error.message : String(error)), p_retryable: error instanceof ProviderActionError ? error.retryable : true }));
  }
  return true;
}

async function executeChatwootAction(supabase: Supabase, action: Action, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  if (!["enquiry_close", "enquiry_reply", "enquiry_reopen"].includes(action.action_type)) throw new Error("action provider capability unavailable");
  const base = httpsEnv("CHATWOOT_BASE_URL"); const token = secretFile("CHATWOOT_API_TOKEN_FILE"); const account = env("CHATWOOT_ACCOUNT_ID");
  const lookup = await supabase.rpc("resolve_ops_provider_action_identity", { p_workspace_id: action.workspace_id, p_enquiry_id: action.target_id });
  if (lookup.error || !lookup.data || typeof lookup.data !== "object") throw new ProviderActionError("chatwoot conversation identity unavailable", false);
  const identity = lookup.data as { ciphertext?: unknown; digest?: unknown };
  const conversationId = decryptId(identity.ciphertext);
  if (!conversationId || identity.digest !== digest(conversationId)) throw new ProviderActionError("chatwoot conversation identity invalid", false);
  const operationKey = `chatwoot:action:${action.action_id}`;
  const begun = await supabase.rpc("begin_ops_provider_operation", { p_operation_key: operationKey, p_workspace_id: action.workspace_id, p_provider: "chatwoot", p_aggregate_type: "enquiry_action", p_aggregate_id: action.target_id, p_source_version: action.expected_version, p_intent: { actionId: action.action_id, action: action.action_type, conversationIdDigest: digest(conversationId) } });
  if (begun.error) throw new ProviderActionError("chatwoot action ledger unavailable", true);
  const state = typeof begun.data === "object" && begun.data ? String((begun.data as Record<string, unknown>).state ?? "prepared") : "prepared";
  if (state === "settled") return { provider: "chatwoot", status: "settled", replay: true };
  if (state === "failed") throw new ProviderActionError("chatwoot action ledger is failed", false);
  const reconcileOnly = state === "remote_succeeded";
  const verify = await call(base, `/api/v1/accounts/${encodeURIComponent(account)}/conversations/${encodeURIComponent(conversationId)}`, "GET", token, operationKey + ":verify", undefined, fetchImpl);
  const expectedExternalId = `${action.workspace_id}:${action.target_id}`;
  if (String(verify.body?.custom_attributes?.blockwise_external_id ?? "") !== expectedExternalId) throw new Error("chatwoot conversation tenant binding failed");
  if (action.action_type === "enquiry_reply") {
    const body = typeof action.payload.body === "string" ? action.payload.body.trim() : ""; if (!body) throw new ProviderActionError("reply body unavailable", false);
    const savedMessage = await supabase.rpc("record_ops_enquiry_action_message", { p_action_id: action.action_id, p_workspace_id: action.workspace_id, p_enquiry_id: action.target_id, p_body: body });
    if (savedMessage.error || savedMessage.data !== true) throw new ProviderActionError("reply intent could not be recorded", false);
  }
  let status = String(verify.body?.status ?? "open");
  let messageId: string | null = null;
  if (action.action_type === "enquiry_reply") {
    const body = typeof action.payload.body === "string" ? action.payload.body.trim() : ""; if (!body) throw new Error("reply body unavailable");
    const messages = await call(base, `/api/v1/accounts/${encodeURIComponent(account)}/conversations/${encodeURIComponent(conversationId)}/messages`, "GET", token, operationKey + ":message-lookup", undefined, fetchImpl);
    const found = Array.isArray(messages.body?.payload) && messages.body.payload.find((m: any) => m?.content_attributes?.blockwise_action_id === action.action_id);
    if (found) messageId = safeId(found.id);
    if (!messageId && !reconcileOnly) { const sent = await call(base, `/api/v1/accounts/${encodeURIComponent(account)}/conversations/${encodeURIComponent(conversationId)}/messages`, "POST", token, operationKey + ":message", { content: body, message_type: "outgoing", private: false, content_attributes: { blockwise_action_id: action.action_id } }, fetchImpl); messageId = safeId(sent.body?.id ?? sent.body?.payload?.id); if (!messageId) throw new ProviderActionError("chatwoot reply receipt missing", true); }
    if (!messageId) throw new ProviderActionError("chatwoot reply receipt not reconciled", true);
    await step(supabase, operationKey, "message.reply", messageId);
  } else {
    status = action.action_type === "enquiry_close" ? "resolved" : "open";
    const remoteStatus = String(verify.body?.status ?? "");
    if (reconcileOnly && remoteStatus !== status) throw new ProviderActionError("chatwoot status receipt not reconciled", true);
    if (!reconcileOnly && remoteStatus !== status) await call(base, `/api/v1/accounts/${encodeURIComponent(account)}/conversations/${encodeURIComponent(conversationId)}`, "PATCH", token, operationKey + ":status", { status }, fetchImpl);
    await step(supabase, operationKey, "conversation.status", conversationId);
  }
  if (action.action_type !== "enquiry_reply") {
    const applied = await supabase.rpc("apply_ops_chatwoot_action_result", { p_action_id: action.action_id, p_workspace_id: action.workspace_id, p_enquiry_id: action.target_id, p_expected_version: action.expected_version, p_status: status });
    if (applied.error || applied.data !== true) throw new ProviderActionError("local enquiry CAS could not settle", false);
  }
  await snapshot(supabase, action, status, messageId);
  const settled = await supabase.rpc("settle_ops_provider_operation", { p_operation_key: operationKey, p_source_version: action.expected_version });
  if (settled.error || settled.data !== true) throw new Error("chatwoot action receipt could not settle");
  return { provider: "chatwoot", status, ...(messageId ? { messageIdSuffix: `****${messageId.slice(-4)}` } : {}) };
}

async function step(supabase: Supabase, key: string, name: string, providerId: string): Promise<void> { const r = await supabase.rpc("record_ops_provider_step", { p_operation_key: key, p_step: name, p_resource: name.startsWith("message") ? null : "conversation", p_provider_id_ciphertext: encryptId(providerId), p_provider_id_digest: digest(providerId) }); if (r.error || r.data !== true) throw new Error("provider action step could not be recorded"); }
async function snapshot(supabase: Supabase, action: Action, status: string, messageId: string | null): Promise<void> { const r = await supabase.rpc("upsert_ops_provider_snapshot", { p_workspace_id: action.workspace_id, p_provider: "chatwoot", p_snapshot_kind: "conversation", p_aggregate_type: "enquiry", p_aggregate_id: action.target_id, p_status: status, p_stage: null, p_subject: null, p_channel: "web", p_delivery_status: messageId ? "accepted" : null, p_provider_record_suffix: null, p_occurred_at: new Date().toISOString(), p_last_activity_at: new Date().toISOString(), p_source_event_id: action.action_id, p_source_version: action.expected_version, p_safe_data: { action: action.action_type, messageRecorded: Boolean(messageId) } }); if (r.error) throw new Error("provider action snapshot failed"); }
async function call(base: URL, path: string, method: string, token: string, key: string, body: unknown, fetchImpl: typeof fetch): Promise<{ body: Record<string, any> }> { const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),15_000); try { const response = await fetchImpl(new URL(path, base), { method, redirect: "error", headers: { api_access_token: token, "content-type": "application/json", "idempotency-key": key, "x-blockwise-correlation": key }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal }); if (response.status===429 || response.status>=500) throw new ProviderActionError(`chatwoot temporary failure (${response.status})`,true); if (!response.ok) throw new ProviderActionError(`chatwoot provider rejected action (${response.status})`,false); const parsed = await response.json().catch(() => ({})); return { body: parsed && typeof parsed === "object" ? parsed : {} }; } catch (error) { if (error instanceof ProviderActionError) throw error; throw new ProviderActionError("chatwoot request timed out",true); } finally { clearTimeout(timer); } }
function env(name: string): string { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name} is not configured`); return value; }
function httpsEnv(name: string): URL { const value = new URL(env(name)); if (value.protocol !== "https:") throw new Error(`${name} must use HTTPS`); return value; }
function secretFile(name: string): string { const path = env(name); if (!isAbsolute(path)) throw new Error(`${name} must be absolute`); const file = lstatSync(resolve(path)); if (!file.isFile() || file.isSymbolicLink()) throw new Error(`${name} is not a regular file`); if (process.platform !== "win32" && (file.mode & 0o777) !== 0o600) throw new Error(`${name} has unsafe permissions`); return readFileSync(resolve(path), "utf8").trim(); }
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function decryptId(value: unknown): string | null { if (typeof value !== "string" || !value.startsWith("v1:")) return null; try { const [, iv, tag, encrypted] = value.split(":"); const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(secretFile("BLOCKWISE_OPS_CORRELATION_KEY_FILE")).digest(), Buffer.from(iv, "base64url")); decipher.setAuthTag(Buffer.from(tag, "base64url")); return safeId(Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8")); } catch { return null; } }
function encryptId(value: string): string { const iv=randomBytes(12); const cipher=createCipheriv("aes-256-gcm",createHash("sha256").update(secretFile("BLOCKWISE_OPS_CORRELATION_KEY_FILE")).digest(),iv); const encrypted=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]); return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`; }
function safeId(value: unknown): string | null { return typeof value === "string" && /^[A-Za-z0-9._:-]{1,256}$/u.test(value) ? value : null; }
function redact(value: string): string { return value.replace(/(bearer\s+)[^\s]+/giu, "$1[redacted]").slice(0, 512); }
