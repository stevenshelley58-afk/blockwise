/** Hermes-only customer operations projection drain. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, dirname, resolve } from "node:path";
import type { createSupabaseServiceClient } from "../src/lib/supabase/service.ts";
import { buildProjectionEnvelope, mapProjectionForAdapter, type AdapterMapping, type BlockwiseProjectionEnvelope } from "../src/lib/ops/projection-contract.ts";
import { publishOpsBundle } from "./ops-bundle.ts";

type Supabase = ReturnType<typeof createSupabaseServiceClient>;
type Fetcher = typeof fetch;
type Row = { id: string; workspace_id: string; provider: "mautic" | "chatwoot"; aggregate_type: "contact" | "lifecycle" | "enquiry" | "support"; aggregate_id: string; operation: "upsert"; source_event_id: string; source_version: number; payload: Record<string, unknown>; attempts: number; max_attempts: number; lease_token: string };
type GlobalRow = { id: string; enquiry_id: string; source_version: number; operation: "upsert"; lease_token: string };
type ProviderResult = { providerId?: string; providerRecordSuffix?: string; status?: string; stage?: string; subject?: string; channel?: string; deliveryStatus?: string; occurredAt?: string; lastActivityAt?: string; safeData?: Record<string, unknown> };
type Ledger = { provider_id_ciphertext?: string | null };
const LEASE_SECONDS = 600;
const REQUEST_TIMEOUT_MS = 15_000;

export async function runOpsProjectionOnce(supabase: Supabase, fetchImpl: Fetcher = fetch): Promise<boolean> {
  const provider = process.env.BLOCKWISE_OPS_PROJECTION_PROVIDER?.trim() || null;
  const claimed = await Promise.resolve(supabase.rpc("claim_ops_projection", { p_provider: provider, p_lease_seconds: LEASE_SECONDS }));
  if (claimed.error) throw new Error(`claim_ops_projection failed: ${redact(claimed.error.message)}`);
  const row = ((claimed.data ?? []) as Row[])[0];
  if (!row) return false;
  let leaseLost = false; let heartbeatInFlight: Promise<unknown> | null = null;
  const heartbeat = setInterval(() => { heartbeatInFlight = Promise.resolve(supabase.rpc("heartbeat_ops_projection", { p_workspace_id: row.workspace_id, p_id: row.id, p_lease_token: row.lease_token, p_lease_seconds: LEASE_SECONDS })).then((result: { data: unknown; error: { message: string } | null }) => { if (result.error || result.data !== true) leaseLost = true; }); }, 60_000);
  try {
    await processProjection(supabase, row, fetchImpl);
    if (leaseLost) throw new Error("projection lease was lost during provider delivery");
    await publishFrankBundleIfConfigured(supabase);
    const settled = await Promise.resolve(supabase.rpc("complete_ops_projection", { p_workspace_id: row.workspace_id, p_id: row.id, p_lease_token: row.lease_token }));
    if (settled.error || settled.data !== true) throw new Error("projection lease was lost before completion");
  } catch (cause) {
    const failed = await Promise.resolve(supabase.rpc("fail_ops_projection", { p_workspace_id: row.workspace_id, p_id: row.id, p_lease_token: row.lease_token, p_error: redact(cause instanceof Error ? cause.message : String(cause)) }));
    if (failed.error) throw new Error(`fail_ops_projection failed: ${redact(failed.error.message)}`);
  } finally { clearInterval(heartbeat); if (heartbeatInFlight) await heartbeatInFlight; }
  return true;
}

async function publishFrankBundleIfConfigured(supabase: Supabase): Promise<void> {
  const root = process.env.HERMES_OPS_PROJECTION_ROOT?.trim();
  if (!root) return;
  const result = await Promise.resolve(supabase.rpc("resolve_ops_frank_bundle"));
  if (result.error || !result.data || typeof result.data !== "object") throw new Error("Frank operations bundle resolution failed");
  publishOpsBundle(root, result.data as Parameters<typeof publishOpsBundle>[1]);
}

/** Global website leads use a dedicated queue and are never assigned to a customer. */
export async function runGlobalProjectionOnce(supabase: Supabase, fetchImpl: Fetcher = fetch): Promise<boolean> {
  const claimed = await Promise.resolve(supabase.rpc("claim_ops_global_projection", { p_lease_seconds: LEASE_SECONDS }));
  if (claimed.error) throw new Error(`claim_ops_global_projection failed: ${redact(claimed.error.message)}`);
  const row = ((claimed.data ?? []) as GlobalRow[])[0]; if (!row) return false;
  let leaseLost = false; let heartbeatInFlight: Promise<unknown> | null = null;
  const heartbeat = setInterval(() => { heartbeatInFlight = Promise.resolve(supabase.rpc("heartbeat_ops_global_projection", { p_id: row.id, p_lease_token: row.lease_token, p_lease_seconds: LEASE_SECONDS })).then((result: { data: unknown; error: { message: string } | null }) => { if (result.error || result.data !== true) leaseLost = true; }); }, 60_000);
  try {
    const resolved = await Promise.resolve(supabase.rpc("resolve_global_ops_enquiry", { p_enquiry_id: row.enquiry_id }));
    if (resolved.error || !resolved.data || typeof resolved.data !== "object") throw new Error("global enquiry resolution failed");
    const data = resolved.data as Record<string, unknown>;
    const leadId = stringId(data.id);
    if (!leadId) throw new Error("global enquiry lacks exact lead id");
    const operationKey = `chatwoot:global:${leadId}:${row.source_version}`;
    const intent = await Promise.resolve(supabase.rpc("begin_ops_provider_operation", { p_operation_key: operationKey, p_workspace_id: null, p_provider: "chatwoot", p_aggregate_type: "global_enquiry", p_aggregate_id: leadId, p_source_version: row.source_version, p_intent: { resource: "global_enquiry", externalId: `blockwise:global:${leadId}` } }));
    if (intent.error) throw new Error(`global provider operation ledger failed: ${redact(intent.error.message)}`);
    const priorId = decryptProviderId((intent.data as Ledger | null)?.provider_id_ciphertext);
    const conversationId = await deliverGlobalChatwoot(data, operationKey, priorId, fetchImpl);
    const recorded = await Promise.resolve(supabase.rpc("record_ops_provider_operation", { p_operation_key: operationKey, p_provider_id_ciphertext: encryptProviderId(conversationId), p_provider_id_digest: digestProviderId(conversationId), p_status: "remote_succeeded" }));
    if (recorded.error || recorded.data !== true) throw new Error("global provider operation result could not be recorded");
    const ledgerSettled = await Promise.resolve(supabase.rpc("settle_ops_provider_operation", { p_operation_key: operationKey, p_source_version: row.source_version }));
    if (ledgerSettled.error || ledgerSettled.data !== true) throw new Error("global provider operation ledger could not settle");
    if (leaseLost) throw new Error("global projection lease was lost during provider delivery");
    const settled = await Promise.resolve(supabase.rpc("complete_ops_global_projection", { p_id: row.id, p_lease_token: row.lease_token }));
    if (settled.error || settled.data !== true) throw new Error("global projection lease was lost before completion");
  } catch (cause) {
    const failed = await Promise.resolve(supabase.rpc("fail_ops_global_projection", { p_id: row.id, p_lease_token: row.lease_token, p_error: redact(cause instanceof Error ? cause.message : String(cause)) }));
    if (failed.error) throw new Error(`fail_ops_global_projection failed: ${redact(failed.error.message)}`);
  } finally { clearInterval(heartbeat); if (heartbeatInFlight) await heartbeatInFlight; }
  return true;
}

export async function reapOpsProjections(supabase: Supabase): Promise<number> { const result = await Promise.resolve(supabase.rpc("reap_ops_projections", { p_lease_seconds: LEASE_SECONDS })); if (result.error) throw new Error(`reap_ops_projections failed: ${redact(result.error.message)}`); const global = await Promise.resolve(supabase.rpc("reap_ops_global_projection", { p_lease_seconds: LEASE_SECONDS })); if (global.error) throw new Error(`reap_ops_global_projection failed: ${redact(global.error.message)}`); return Number(result.data ?? 0) + Number(global.data ?? 0); }

async function processProjection(supabase: Supabase, row: Row, fetchImpl: Fetcher): Promise<void> {
  const resolved = await Promise.resolve(supabase.rpc("resolve_ops_projection_data", { p_workspace_id: row.workspace_id, p_provider: row.provider, p_aggregate_type: row.aggregate_type, p_aggregate_id: row.aggregate_id }));
  if (resolved.error) throw new Error(`projection data resolution failed: ${redact(resolved.error.message)}`);
  if (!resolved.data || typeof resolved.data !== "object") throw new Error("projection data is unavailable; refusing provider call");
  const sourcePayload = { ...(resolved.data as Record<string, unknown>), workspaceId: row.workspace_id };
  const envelope = buildProjectionEnvelope({ workspaceId: row.workspace_id, provider: row.provider, aggregate: { type: row.aggregate_type, id: row.aggregate_id }, operation: row.operation, source: { eventId: row.source_event_id, version: row.source_version }, payload: sourcePayload as BlockwiseProjectionEnvelope["payload"] });
  const mapping = mapProjectionForAdapter(envelope); const operationKey = `${row.provider}:${row.workspace_id}:${row.aggregate_type}:${row.aggregate_id}:${row.source_version}`;
  const intent = await Promise.resolve(supabase.rpc("begin_ops_provider_operation", { p_operation_key: operationKey, p_workspace_id: row.workspace_id, p_provider: row.provider, p_aggregate_type: row.aggregate_type, p_aggregate_id: row.aggregate_id, p_source_version: row.source_version, p_intent: { resource: mapping.resource, externalId: mapping.fields.externalId } }));
  if (intent.error) throw new Error(`provider operation ledger failed: ${redact(intent.error.message)}`);
  const priorId = decryptProviderId((intent.data as Ledger | null)?.provider_id_ciphertext);
  const result = await providerCall(row.provider, mapping, row.aggregate_type, operationKey, priorId, fetchImpl);
  if (!result.providerId) throw new Error("provider returned no durable identifier");
  const recorded = await Promise.resolve(supabase.rpc("record_ops_provider_operation", { p_operation_key: operationKey, p_provider_id_ciphertext: encryptProviderId(result.providerId), p_provider_id_digest: digestProviderId(result.providerId), p_status: "remote_succeeded" }));
  if (recorded.error || recorded.data !== true) throw new Error("provider operation result could not be recorded");
  const saved = await Promise.resolve(supabase.rpc("upsert_ops_provider_snapshot", { p_workspace_id: row.workspace_id, p_provider: row.provider, p_snapshot_kind: snapshotKind(row.aggregate_type), p_aggregate_type: row.aggregate_type, p_aggregate_id: row.aggregate_id, p_status: result.status ?? null, p_stage: result.stage ?? null, p_subject: result.subject ?? null, p_channel: result.channel ?? null, p_delivery_status: result.deliveryStatus ?? null, p_provider_record_suffix: maskedSuffix(result.providerId), p_occurred_at: result.occurredAt ?? null, p_last_activity_at: result.lastActivityAt ?? null, p_source_event_id: row.source_event_id, p_source_version: row.source_version, p_safe_data: result.safeData ?? {} }));
  if (saved.error) throw new Error(`provider snapshot write failed: ${redact(saved.error.message)}`);
  const settled = await Promise.resolve(supabase.rpc("settle_ops_provider_operation", { p_operation_key: operationKey, p_source_version: row.source_version }));
  if (settled.error || settled.data !== true) throw new Error("provider operation ledger could not settle");
}

function snapshotKind(type: Row["aggregate_type"]): "delivery" | "flow" | "lifecycle" | "conversation" { return type === "contact" ? "delivery" : type === "lifecycle" ? "lifecycle" : "conversation"; }
async function providerCall(provider: Row["provider"], mapping: AdapterMapping, aggregateType: Row["aggregate_type"], operationKey: string, priorId: string | null, fetchImpl: Fetcher): Promise<ProviderResult> { return provider === "mautic" ? mauticCall(mapping as Extract<AdapterMapping, { provider: "mautic" }>, operationKey, priorId, fetchImpl) : chatwootCall(mapping as Extract<AdapterMapping, { provider: "chatwoot" }>, aggregateType, operationKey, priorId, fetchImpl); }

async function mauticCall(mapping: Extract<AdapterMapping, { provider: "mautic" }>, operationKey: string, priorId: string | null, fetchImpl: Fetcher): Promise<ProviderResult> {
  const base = requiredHttpsEnv("MAUTIC_BASE_URL"); const token = readSecretFile("MAUTIC_TOKEN_FILE");
  if (mapping.resource === "lifecycle") {
    const contact = priorId ?? await mauticFindContact(base, token, mapping.fields.externalId, fetchImpl); if (!contact) throw new Error("Mautic lifecycle contact was not found; refusing synthetic success");
    const stage = mapping.fields.stage ?? "unknown"; const segmentId = mappingForStage("MAUTIC_LIFECYCLE_SEGMENTS_JSON", stage); const campaignId = mappingForStageOptional("MAUTIC_LIFECYCLE_CAMPAIGNS_JSON", stage);
    await request(base, `/api/segments/${encodeURIComponent(segmentId)}/contact/${encodeURIComponent(contact)}/add`, "POST", token, operationKey + ":segment", {}, fetchImpl);
    await request(base, `/api/contacts/${encodeURIComponent(contact)}/edit`, "PATCH", token, operationKey + ":tag", { tags: [requiredEnv("MAUTIC_LIFECYCLE_TAG")] }, fetchImpl);
    if (campaignId) await request(base, `/api/campaigns/${encodeURIComponent(campaignId)}/contact/${encodeURIComponent(contact)}/add`, "POST", token, operationKey + ":campaign", {}, fetchImpl);
    return { providerId: contact, providerRecordSuffix: maskedSuffix(contact), stage, status: "active", safeData: { flow: "lifecycle" } };
  }
  const contact = priorId ?? await mauticFindContact(base, token, mapping.fields.externalId, fetchImpl);
  const fields: Record<string, unknown> = { email: mapping.fields.email, firstname: firstName(mapping.fields.name), lastname: lastName(mapping.fields.name), "fields[core][blockwise_external_id]": mapping.fields.externalId, tags: [requiredEnv("MAUTIC_CONTACT_TAG")] };
  const response = contact ? await request(base, `/api/contacts/${encodeURIComponent(contact)}/edit`, "PATCH", token, operationKey, fields, fetchImpl) : await request(base, "/api/contacts/new", "POST", token, operationKey, fields, fetchImpl);
  const id = stringId(response.body?.contact?.id ?? response.body?.id ?? contact); if (!id) throw new Error("Mautic contact response has no id");
  return { providerId: id, providerRecordSuffix: maskedSuffix(id), status: "active", stage: mapping.fields.activationStage ?? mapping.fields.lifecycle, deliveryStatus: "accepted", safeData: { flow: "contact" } };
}

async function chatwootCall(mapping: Extract<AdapterMapping, { provider: "chatwoot" }>, aggregateType: Row["aggregate_type"], operationKey: string, priorId: string | null, fetchImpl: Fetcher): Promise<ProviderResult> {
  const base = requiredHttpsEnv("CHATWOOT_BASE_URL"); const token = readSecretFile("CHATWOOT_API_TOKEN_FILE"); const account = requiredEnv("CHATWOOT_ACCOUNT_ID"); const inbox = numericId(aggregateType === "enquiry" ? "CHATWOOT_ENQUIRY_INBOX_ID" : "CHATWOOT_SUPPORT_INBOX_ID");
  const contactPayload = { inbox_id: inbox, identifier: mapping.fields.externalId, email: mapping.fields.requesterEmail, name: mapping.fields.requesterName || mapping.fields.externalId, custom_attributes: { blockwise_external_id: mapping.fields.externalId } };
  let contactId = mapping.fields.contactId ?? priorId ?? await chatwootFindContact(base, account, mapping.fields.externalId, token, fetchImpl);
  const contactResponse = contactId ? await request(base, `/api/v1/accounts/${encodeURIComponent(account)}/contacts/${encodeURIComponent(contactId)}`, "PUT", token, operationKey + ":contact", contactPayload, fetchImpl) : await request(base, `/api/v1/accounts/${encodeURIComponent(account)}/contacts`, "POST", token, operationKey + ":contact", contactPayload, fetchImpl);
  contactId = stringId(contactResponse.body?.payload?.id ?? contactResponse.body?.id ?? contactId); if (!contactId) throw new Error("Chatwoot contact response has no id");
  const conversations = await request(base, `/api/v1/accounts/${encodeURIComponent(account)}/conversations?inbox_id=${encodeURIComponent(inbox)}`, "GET", token, operationKey + ":conversation-lookup", undefined, fetchImpl); const existing = findConversation(conversations.body, mapping.fields.externalId);
  const conversation = existing ?? (await request(base, `/api/v1/accounts/${encodeURIComponent(account)}/conversations`, "POST", token, operationKey + ":conversation", { inbox_id: inbox, contact_id: numericValue(contactId, "Chatwoot contact id"), status: chatStatus(mapping.fields.status), custom_attributes: { blockwise_external_id: mapping.fields.externalId, blockwise_aggregate_type: mapping.resource } }, fetchImpl)).body;
  const conversationId = stringId(conversation?.id ?? conversation?.payload?.id); if (!conversationId) throw new Error("Chatwoot conversation response has no id");
  if (mapping.fields.message) {
    const messages = await request(base, `/api/v1/accounts/${encodeURIComponent(account)}/conversations/${encodeURIComponent(conversationId)}/messages`, "GET", token, operationKey + ":message-lookup", undefined, fetchImpl);
    const hasMessage = Array.isArray(messages.body?.payload) && messages.body.payload.some((item: any) => item?.content === mapping.fields.message && item?.content_attributes?.blockwise_operation_key === operationKey);
    if (!hasMessage) await request(base, `/api/v1/accounts/${encodeURIComponent(account)}/conversations/${encodeURIComponent(conversationId)}/messages`, "POST", token, operationKey + ":message", { content: mapping.fields.message, message_type: "incoming", private: false, content_attributes: { blockwise_operation_key: operationKey } }, fetchImpl);
  }
  if (mapping.fields.reply) {
    const replies = await request(base, `/api/v1/accounts/${encodeURIComponent(account)}/conversations/${encodeURIComponent(conversationId)}/messages`, "GET", token, operationKey + ":reply-lookup", undefined, fetchImpl);
    const hasReply = Array.isArray(replies.body?.payload) && replies.body.payload.some((item: any) => item?.content === mapping.fields.reply && item?.content_attributes?.blockwise_operation_key === operationKey);
    if (!hasReply) await request(base, `/api/v1/accounts/${encodeURIComponent(account)}/conversations/${encodeURIComponent(conversationId)}/messages`, "POST", token, operationKey + ":reply", { content: mapping.fields.reply, message_type: "outgoing", private: false, content_attributes: { blockwise_operation_key: operationKey } }, fetchImpl);
  }
  if (mapping.fields.status) await request(base, `/api/v1/accounts/${encodeURIComponent(account)}/conversations/${encodeURIComponent(conversationId)}`, "PATCH", token, operationKey + ":status", { status: chatStatus(mapping.fields.status) }, fetchImpl);
  const assignee = mapping.fields.assigneeId || process.env.CHATWOOT_ASSIGNEE_ID?.trim(); if (assignee) await request(base, `/api/v1/accounts/${encodeURIComponent(account)}/conversations/${encodeURIComponent(conversationId)}/assignments`, "POST", token, operationKey + ":assignment", { assignee_id: numericValue(assignee, "CHATWOOT_ASSIGNEE_ID") }, fetchImpl);
  return { providerId: conversationId, providerRecordSuffix: maskedSuffix(conversationId), status: chatStatus(mapping.fields.status), subject: mapping.fields.subject, channel: "web", lastActivityAt: new Date().toISOString(), safeData: { conversationStatus: chatStatus(mapping.fields.status) } };
}

async function deliverGlobalChatwoot(data: Record<string, unknown>, operationKey: string, priorId: string | null, fetchImpl: Fetcher): Promise<string> { const base = requiredHttpsEnv("CHATWOOT_BASE_URL"); const token = readSecretFile("CHATWOOT_API_TOKEN_FILE"); const account = requiredEnv("CHATWOOT_GLOBAL_ACCOUNT_ID"); const inbox = numericId("CHATWOOT_GLOBAL_INBOX_ID"); const leadId = stringId(data.id); if (!leadId) throw new Error("global enquiry lacks exact lead id"); const externalId = `blockwise:global:${leadId}`; const known = await chatwootFindContact(base, account, externalId, token, fetchImpl); const contact = known ? await request(base, `/api/v1/accounts/${encodeURIComponent(account)}/contacts/${encodeURIComponent(known)}`, "PUT", token, operationKey + ":contact", { inbox_id: inbox, identifier: externalId, email: string(data.requester_email), name: string(data.requester_name) || "Website enquiry", custom_attributes: { blockwise_global_lead_id: leadId } }, fetchImpl) : await request(base, `/api/v1/accounts/${encodeURIComponent(account)}/contacts`, "POST", token, operationKey + ":contact", { inbox_id: inbox, identifier: externalId, email: string(data.requester_email), name: string(data.requester_name) || "Website enquiry", custom_attributes: { blockwise_global_lead_id: leadId } }, fetchImpl); const contactId = stringId(contact.body?.payload?.id ?? contact.body?.id ?? known); if (!contactId) throw new Error("global Chatwoot contact response has no id"); const conversations = await request(base, `/api/v1/accounts/${encodeURIComponent(account)}/conversations?inbox_id=${encodeURIComponent(inbox)}`, "GET", token, operationKey + ":conversation-lookup", undefined, fetchImpl); const existing = findConversation(conversations.body, externalId, priorId ?? undefined); const conversation = existing ?? (await request(base, `/api/v1/accounts/${encodeURIComponent(account)}/conversations`, "POST", token, operationKey + ":conversation", { inbox_id: inbox, contact_id: numericValue(contactId, "Chatwoot global contact id"), status: "open", custom_attributes: { blockwise_global_lead_id: leadId, blockwise_external_id: externalId } }, fetchImpl)).body; const conversationId = stringId(conversation.body?.id ?? conversation.id ?? conversation.payload?.id); if (!conversationId) throw new Error("global Chatwoot conversation response has no id"); const content = string(data.message) || string(data.subject) || "Website enquiry"; const messages = await request(base, `/api/v1/accounts/${encodeURIComponent(account)}/conversations/${encodeURIComponent(conversationId)}/messages`, "GET", token, operationKey + ":message-lookup", undefined, fetchImpl); const hasMessage = Array.isArray(messages.body?.payload) && messages.body.payload.some((item: any) => item?.content === content && item?.content_attributes?.blockwise_operation_key === operationKey); if (!hasMessage) await request(base, `/api/v1/accounts/${encodeURIComponent(account)}/conversations/${encodeURIComponent(conversationId)}/messages`, "POST", token, operationKey + ":message", { content, message_type: "incoming", private: false, content_attributes: { blockwise_operation_key: operationKey } }, fetchImpl); return conversationId; }

async function mauticFindContact(base: URL, token: string, externalId: string, fetchImpl: Fetcher): Promise<string | null> { const result = await request(base, `/api/contacts?search=${encodeURIComponent(`blockwise_external_id:${externalId}`)}`, "GET", token, "lookup", undefined, fetchImpl); const contacts = result.body?.contacts; if (!contacts || typeof contacts !== "object") return null; const first = Object.values(contacts as Record<string, unknown>)[0] as Record<string, unknown> | undefined; return stringId(first?.id ?? Object.keys(contacts as Record<string, unknown>)[0]); }
async function chatwootFindContact(base: URL, account: string, externalId: string, token: string, fetchImpl: Fetcher): Promise<string | null> { const result = await request(base, `/api/v1/accounts/${encodeURIComponent(account)}/contacts/search?q=${encodeURIComponent(externalId)}`, "GET", token, "lookup", undefined, fetchImpl); const payload = result.body?.payload; const first = Array.isArray(payload) ? payload[0] : null; return stringId((first as Record<string, unknown> | null)?.id); }
function findConversation(body: Record<string, any> | null, externalId: string, priorId?: string): Record<string, any> | null { const values = Array.isArray(body?.data?.payload) ? body?.data?.payload : Array.isArray(body?.payload) ? body.payload : []; return (values as Record<string, any>[]).find((item) => item.custom_attributes?.blockwise_external_id === externalId || (priorId !== undefined && String(item.id) === priorId)) ?? null; }
async function request(base: URL, path: string, method: string, token: string, idempotencyKey: string, body: unknown, fetchImpl: Fetcher): Promise<{ body: Record<string, any> }> { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(new Error("provider request timed out")), REQUEST_TIMEOUT_MS); try { const response = await fetchImpl(new URL(path, base), { method, redirect: "error", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": idempotencyKey, "x-blockwise-correlation": idempotencyKey }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal }); if (response.status === 429 || response.status >= 500) throw new Error(`provider temporary failure (${response.status})`); if (!response.ok) throw new Error(`provider rejected projection (${response.status})`); const parsed = await response.json().catch(() => ({})); if (!parsed || typeof parsed !== "object") throw new Error("provider returned an invalid response"); return { body: parsed as Record<string, any> }; } finally { clearTimeout(timer); } }
function mappingForStage(name: string, stage: string): string { const result = mappingForStageOptional(name, stage); if (!result) throw new Error(`${name} has no mapping for lifecycle stage`); return result; }
function mappingForStageOptional(name: string, stage: string): string | null { const raw = process.env[name]?.trim(); if (!raw) return null; let value: unknown; try { value = JSON.parse(raw); } catch { throw new Error(`${name} is not valid JSON`); } const id = value && typeof value === "object" ? (value as Record<string, unknown>)[stage] : null; return typeof id === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(id) ? id : null; }
function chatStatus(value: string | undefined): string { return value === "closed" || value === "resolved" ? "resolved" : value === "pending" ? "pending" : "open"; }
function firstName(name: string | undefined): string | undefined { return name?.trim().split(/\s+/u)[0] || undefined; }
function lastName(name: string | undefined): string | undefined { const values = name?.trim().split(/\s+/u) ?? []; return values.length > 1 ? values.slice(1).join(" ") : undefined; }
function requiredEnv(name: string): string { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name} is not configured`); return value; }
function numericId(name: string): number { return numericValue(requiredEnv(name), name); }
function numericValue(value: string, name: string): number { if (!/^[1-9][0-9]{0,18}$/u.test(value)) throw new Error(`${name} must be a numeric provider id`); return Number(value); }
function requiredHttpsEnv(name: string): URL { const url = new URL(requiredEnv(name)); if (url.protocol !== "https:") throw new Error(`${name} must use HTTPS`); return url; }
function readSecretFile(name: string): string { const path = requiredEnv(name); if (!isAbsolute(path)) throw new Error(`${name} must be an absolute path`); const resolved = resolve(path); const file = lstatSync(resolved); if (!file.isFile() || file.isSymbolicLink()) throw new Error(`${name} must be a regular non-symlink file`); if (process.platform !== "win32") { if ((file.mode & 0o777) !== 0o600) throw new Error(`${name} must be mode 0600`); if (typeof process.getuid === "function" && file.uid !== process.getuid()) throw new Error(`${name} has an unexpected owner`); let part = dirname(resolved); while (part && part !== dirname(part)) { const stat = lstatSync(part); if (stat.isSymbolicLink() || (stat.mode & 0o022)) throw new Error(`${name} has an unsafe path component`); part = dirname(part); } } const value = readFileSync(resolved, "utf8").trim(); if (!value) throw new Error(`${name} is empty`); return value; }
function stringId(value: unknown): string | null { return typeof value === "string" || typeof value === "number" ? String(value).match(/^[A-Za-z0-9._:-]{1,256}$/u)?.[0] ?? null : null; }
function string(value: unknown): string | undefined { return typeof value === "string" && value.length < 2048 ? value : undefined; }
function maskedSuffix(value: string): string { return `****${value.slice(-4)}`; }
function redact(value: string): string { return value.replace(/(bearer\s+)[^\s]+/giu, "$1[redacted]").replace(/[\w.+-]+@[\w.-]+/gu, "[email]").slice(0, 512); }
function digestProviderId(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function cryptoKey(): Buffer { return createHash("sha256").update(readSecretFile("BLOCKWISE_OPS_CORRELATION_KEY_FILE")).digest(); }
function encryptProviderId(value: string): string { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", cryptoKey(), iv); const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`; }
function decryptProviderId(value: unknown): string | null { if (typeof value !== "string" || !value.startsWith("v1:")) return null; try { const [, iv, tag, encrypted] = value.split(":"); const decipher = createDecipheriv("aes-256-gcm", cryptoKey(), Buffer.from(iv, "base64url")); decipher.setAuthTag(Buffer.from(tag, "base64url")); return stringId(Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8")); } catch { return null; } }
