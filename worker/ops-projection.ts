/**
 * Hermes-side customer-operations projection drain.
 *
 * This module deliberately has no provider SDK dependency. It claims the
 * provider-neutral Blockwise outbox, resolves transient customer data through
 * a service-only RPC, calls the configured OSS provider, then stores only a
 * normalized observation through the snapshot RPC. Frank never runs this code.
 */
import { readFileSync, statSync } from "node:fs";
import type { createSupabaseServiceClient } from "../src/lib/supabase/service.ts";
import { buildProjectionEnvelope, mapProjectionForAdapter, type BlockwiseProjectionEnvelope } from "../src/lib/ops/projection-contract.ts";

type Supabase = ReturnType<typeof createSupabaseServiceClient>;
type Row = { id: string; workspace_id: string; provider: "mautic" | "chatwoot"; aggregate_type: "contact" | "lifecycle" | "enquiry" | "support"; aggregate_id: string; operation: "upsert"; source_event_id: string; source_version: number; payload: Record<string, unknown>; attempts: number; max_attempts: number; lease_token: string };
type Fetcher = typeof fetch;
type ProviderResult = { status?: string; stage?: string; subject?: string; channel?: string; deliveryStatus?: string; occurredAt?: string; lastActivityAt?: string; providerRecordSuffix?: string; safeData?: Record<string, unknown> };

const LEASE_SECONDS = 600;
const REQUEST_TIMEOUT_MS = 15_000;

export async function runOpsProjectionOnce(supabase: Supabase, fetchImpl: Fetcher = fetch): Promise<boolean> {
  const provider = process.env.BLOCKWISE_OPS_PROJECTION_PROVIDER?.trim() || null;
  const { data, error } = await supabase.rpc("claim_ops_projection", { p_provider: provider, p_lease_seconds: LEASE_SECONDS });
  if (error) throw new Error(`claim_ops_projection failed: ${redact(error.message)}`);
  const row = ((data ?? []) as Row[])[0];
  if (!row) return false;
  let leaseLost = false;
  const heartbeat = setInterval(() => {
    void supabase.rpc("heartbeat_ops_projection", { p_workspace_id: row.workspace_id, p_id: row.id, p_lease_token: row.lease_token, p_lease_seconds: LEASE_SECONDS }).then((result: { data: unknown; error: { message: string } | null }) => { if (result.error || result.data !== true) leaseLost = true; });
  }, 60_000);
  try {
    await processProjection(supabase, row, fetchImpl);
    if (leaseLost) throw new Error("projection lease was lost during provider delivery");
    const settled = await supabase.rpc("complete_ops_projection", { p_workspace_id: row.workspace_id, p_id: row.id, p_lease_token: row.lease_token });
    if (settled.error || settled.data !== true) throw new Error("projection lease was lost before completion");
  } catch (cause) {
    const message = redact(cause instanceof Error ? cause.message : String(cause));
    const failed = await supabase.rpc("fail_ops_projection", { p_workspace_id: row.workspace_id, p_id: row.id, p_lease_token: row.lease_token, p_error: message });
    if (failed.error) throw new Error(`fail_ops_projection failed: ${redact(failed.error.message)}`);
  } finally { clearInterval(heartbeat); }
  return true;
}

export async function reapOpsProjections(supabase: Supabase): Promise<number> {
  const { data, error } = await supabase.rpc("reap_ops_projections", { p_lease_seconds: LEASE_SECONDS });
  if (error) throw new Error(`reap_ops_projections failed: ${redact(error.message)}`);
  return Number(data ?? 0);
}

async function processProjection(supabase: Supabase, row: Row, fetchImpl: Fetcher): Promise<void> {
  const resolved = await supabase.rpc("resolve_ops_projection_data", { p_workspace_id: row.workspace_id, p_provider: row.provider, p_aggregate_type: row.aggregate_type, p_aggregate_id: row.aggregate_id });
  if (resolved.error) throw new Error(`projection data resolution failed: ${redact(resolved.error.message)}`);
  if (!resolved.data || typeof resolved.data !== "object") throw new Error("projection data is unavailable; refusing provider call");
  const sourcePayload = { ...(resolved.data as Record<string, unknown>), workspaceId: row.workspace_id };
  const envelope = buildProjectionEnvelope({ workspaceId: row.workspace_id, provider: row.provider, aggregate: { type: row.aggregate_type, id: row.aggregate_id }, operation: row.operation, source: { eventId: row.source_event_id, version: row.source_version }, payload: sourcePayload as BlockwiseProjectionEnvelope["payload"] });
  const result = await providerCall(row.provider, mapProjectionForAdapter(envelope), row.id, fetchImpl);
  const snapshot = result ?? { safeData: {} };
  const saved = await supabase.rpc("upsert_ops_provider_snapshot", { p_workspace_id: row.workspace_id, p_provider: row.provider, p_snapshot_kind: snapshotKind(row.aggregate_type), p_aggregate_type: row.aggregate_type, p_aggregate_id: row.aggregate_id, p_status: snapshot.status ?? null, p_stage: snapshot.stage ?? null, p_subject: snapshot.subject ?? null, p_channel: snapshot.channel ?? null, p_delivery_status: snapshot.deliveryStatus ?? null, p_provider_record_suffix: snapshot.providerRecordSuffix ?? null, p_occurred_at: snapshot.occurredAt ?? null, p_last_activity_at: snapshot.lastActivityAt ?? null, p_source_event_id: row.source_event_id, p_source_version: row.source_version, p_safe_data: snapshot.safeData ?? {} });
  if (saved.error) throw new Error(`provider snapshot write failed: ${redact(saved.error.message)}`);
}

function snapshotKind(type: Row["aggregate_type"]): "delivery" | "flow" | "lifecycle" | "conversation" { return type === "contact" ? "delivery" : type === "lifecycle" ? "lifecycle" : "conversation"; }

async function providerCall(provider: Row["provider"], mapping: ReturnType<typeof mapProjectionForAdapter>, idempotencyKey: string, fetchImpl: Fetcher): Promise<ProviderResult> {
  const base = requiredHttpsEnv(provider === "mautic" ? "MAUTIC_BASE_URL" : "CHATWOOT_BASE_URL");
  const token = readSecretFile(provider === "mautic" ? "MAUTIC_TOKEN_FILE" : "CHATWOOT_API_TOKEN_FILE");
  const url = new URL(provider === "mautic" ? "/api/contacts" : "/api/v1/accounts/" + requiredEnv("CHATWOOT_ACCOUNT_ID") + "/conversations", base);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("provider request timed out")), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { method: "POST", redirect: "error", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify(mapping.fields), signal: controller.signal });
    if (response.status === 429 || response.status >= 500) throw new Error(`provider temporary failure (${response.status})`);
    if (!response.ok) throw new Error(`provider rejected projection (${response.status})`);
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { status: string(body.status), stage: string(body.stage), subject: string(body.subject), channel: string(body.channel), deliveryStatus: string(body.delivery_status), providerRecordSuffix: maskedSuffix(body.id), safeData: { detail: "provider acknowledged" } };
  } finally { clearTimeout(timer); }
}

function requiredEnv(name: string): string { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name} is not configured`); return value; }
function requiredHttpsEnv(name: string): URL { const url = new URL(requiredEnv(name)); if (url.protocol !== "https:") throw new Error(`${name} must use HTTPS`); return url; }
function readSecretFile(name: string): string { const path = requiredEnv(name); const mode = statSync(path).mode & 0o777; if (mode & 0o077) throw new Error(`${name} file permissions are too broad`); const value = readFileSync(path, "utf8").trim(); if (!value) throw new Error(`${name} is empty`); return value; }
function string(value: unknown): string | undefined { return typeof value === "string" && value.length < 512 ? value : undefined; }
function maskedSuffix(value: unknown): string | undefined { const raw = string(value); return raw ? `****${raw.slice(-4)}` : undefined; }
function redact(value: string): string { return value.replace(/(bearer\s+)[^\s]+/gi, "$1[redacted]").replace(/[\w.+-]+@[\w.-]+/g, "[email]").slice(0, 512); }
