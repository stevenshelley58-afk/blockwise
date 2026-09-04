import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "../supabase/service.ts";
import { redactString, redactValue } from "../redact.ts";

type ServiceClient = SupabaseClient;
type Row = Record<string, unknown>;

const SUMMARY_FIELDS = ["id", "name", "mode", "region", "country_code", "managed_service_enabled", "billing_access_state", "billing_email", "stripe_subscription_status", "stripe_latest_invoice_status", "created_at", "updated_at"] as const;
const PROFILE_FIELDS = ["id", "email", "full_name", "created_at", "updated_at"] as const;
const ACTIVATION_FIELDS = ["workspace_id", "email_verified_at", "country_confirmed_at", "website_submitted_at", "brand_pack_approved_at", "first_ad_pack_generated_at", "meta_connected_at", "checkout_completed_at", "first_campaign_live_at", "intro_invoice_paid_at", "onboarding_booked_at", "onboarding_completed_at", "activation_completed_at", "updated_at"] as const;
const BOOKING_FIELDS = ["id", "workspace_id", "provider", "status", "scheduled_start_at", "scheduled_end_at", "booked_at", "cancelled_at", "completed_at", "created_at", "updated_at"] as const;
const ENQUIRY_FIELDS = ["id", "workspace_id", "source_system", "source_id", "enquiry_type", "external_id", "status", "subject", "requester_email", "requester_name", "created_at", "updated_at"] as const;
const PROJECTION_FIELDS = ["id", "workspace_id", "provider", "aggregate_type", "aggregate_id", "operation", "source_event_id", "source_version", "status", "attempts", "max_attempts", "run_after", "completed_at", "created_at", "updated_at"] as const;

export async function loadCustomerSummaries(input: { cursor?: string; limit?: number; page?: number; pageSize?: number; query?: string; serviceSupabase?: ServiceClient } = {}) {
  const client = input.serviceSupabase ?? createSupabaseServiceClient();
  const pageSize = boundedLimit(input.limit ?? input.pageSize ?? 50);
  const cursor = decodeCursor(input.cursor);
  let workspaces = client.from("workspaces").select(SUMMARY_FIELDS.join(","), { count: "exact" }).order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(pageSize + 1);
  if (cursor) workspaces = workspaces.or(`updated_at.lt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.lt.${cursor.id})`);
  if (input.query?.trim()) workspaces = workspaces.ilike("name", `%${escapeLike(input.query.trim())}%`);
  const result = await workspaces;
  if (result.error) throw new Error(`ops customers query failed: ${result.error.message}`);
  const fetched = (result.data ?? []) as unknown as Row[];
  const hasMore = fetched.length > pageSize;
  const rows = hasMore ? fetched.slice(0, pageSize) : fetched;
  const ids = rows.map((row) => String(row.id));
  const [members, activations, bookings] = await Promise.all([
    related(client, "workspace_members", ids, "workspace_id,profile_id,role,created_at"),
    related(client, "customer_activations", ids, ACTIVATION_FIELDS.join(",")),
    related(client, "workspace_onboarding_bookings", ids, BOOKING_FIELDS.join(",")),
  ]);
  const profiles = await profilesForMembers(client, members);
  const last = rows.at(-1);
  return { limit: pageSize, total: result.count ?? rows.length, nextCursor: hasMore && last ? encodeCursor({ updatedAt: String(last.updated_at), id: String(last.id) }) : null, rows: rows.map((row) => summarize(row, members, profiles, activations, bookings)) };
}

export async function loadCustomerDetail(workspaceId: string, serviceSupabase?: ServiceClient) {
  const client = serviceSupabase ?? createSupabaseServiceClient();
  const { data: workspace, error } = await client.from("workspaces").select(SUMMARY_FIELDS.join(",")).eq("id", workspaceId).maybeSingle();
  if (error) throw new Error(`ops customer query failed: ${error.message}`);
  if (!workspace) return null;
  const [members, profiles, activation, bookings, leads, billing, audit, email, projections] = await Promise.all([
    related(client, "workspace_members", [workspaceId], "workspace_id,profile_id,role,created_at"),
    relatedProfiles(client, workspaceId),
    one(client, "customer_activations", "workspace_id", workspaceId, ACTIVATION_FIELDS.join(",")),
    related(client, "workspace_onboarding_bookings", [workspaceId], BOOKING_FIELDS.join(",")),
    related(client, "ops_enquiry_associations", [workspaceId], ENQUIRY_FIELDS.join(",")),
    loadBilling(client, workspaceId),
    related(client, "audit_logs", [workspaceId], "id,workspace_id,action,target_type,target_id,created_at"),
    loadCustomerEmailStatus(client, workspaceId),
    related(client, "ops_projection_outbox", [workspaceId], PROJECTION_FIELDS.join(",")),
  ]);
  return { workspace: redact(workspace as unknown as Row, SUMMARY_FIELDS), members: members.map((row) => redact(row, ["workspace_id", "profile_id", "role", "created_at"])), profiles, activation: activation ? redact(activation, ACTIVATION_FIELDS) : null, bookings: bookings.map((row) => redact(row, BOOKING_FIELDS)), enquiries: leads.map((row) => redact(row, ENQUIRY_FIELDS)), billing, email, projections: projections.map((row) => redactProjection(row)), activity: audit.map((row) => redactActivity(row)) };
}

export async function loadCustomerSubresource(workspaceId: string, resource: string, serviceSupabase?: ServiceClient): Promise<unknown> {
  const client = serviceSupabase ?? createSupabaseServiceClient();
  const exists = await client.from("workspaces").select("id").eq("id", workspaceId).maybeSingle();
  if (exists.error) throw new Error(`ops workspace query failed: ${exists.error.message}`);
  if (!exists.data) return null;
  if (resource === "lifecycle") return { workspaceId, activation: await one(client, "customer_activations", "workspace_id", workspaceId, ACTIVATION_FIELDS.join(",")) };
  if (resource === "activity") {
    const [audit, leadEvents] = await Promise.all([
      related(client, "audit_logs", [workspaceId], "id,workspace_id,action,target_type,target_id,created_at"),
      related(client, "lead_events", [workspaceId], "id,workspace_id,lead_id,event_type,metadata,created_at"),
    ]);
    return { workspaceId, items: [...audit, ...leadEvents].map((row) => redactActivity(row)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) };
  }
  if (resource === "bookings") return { workspaceId, items: await related(client, "workspace_onboarding_bookings", [workspaceId], BOOKING_FIELDS.join(",")) };
  if (resource === "billing") return { workspaceId, ...(await loadBilling(client, workspaceId)) };
  if (resource === "email") return { workspaceId, ...(await loadCustomerEmailStatus(client, workspaceId)) };
  if (resource === "enquiries") return { workspaceId, items: (await related(client, "ops_enquiry_associations", [workspaceId], ENQUIRY_FIELDS.join(","))).map((row) => redact(row, ENQUIRY_FIELDS)) };
  if (resource === "projections") return { workspaceId, items: (await related(client, "ops_projection_outbox", [workspaceId], PROJECTION_FIELDS.join(","))).map((row) => redactProjection(row)) };
  throw new OpsNotFoundError();
}

export class OpsNotFoundError extends Error {}

async function loadBilling(client: ServiceClient, workspaceId: string) {
  const [workspace, acceptances] = await Promise.all([
    one(client, "workspaces", "id", workspaceId, "id,billing_access_state,billing_email,billing_currency,billing_offer_key,billing_offer_version,stripe_customer_id,stripe_subscription_id,stripe_subscription_status,stripe_current_period_start,stripe_current_period_end,stripe_cancel_at_period_end,stripe_latest_invoice_status,stripe_latest_invoice_amount_paid,billing_payment_recovery_required,billing_reconciliation_required"),
    related(client, "billing_offer_acceptances", [workspaceId], "id,workspace_id,offer_key,offer_version,accepted_at,market,currency,first_invoice_amount,renewal_amount"),
  ]);
  return { workspace, acceptances };
}

async function related(client: ServiceClient, table: string, ids: string[], fields: string): Promise<Row[]> {
  if (ids.length === 0) return [];
  const result = await client.from(table).select(fields).in("workspace_id", ids);
  if (result.error) throw new Error(`ops ${table} query failed: ${result.error.message}`);
  return (result.data ?? []) as unknown as Row[];
}
async function one(client: ServiceClient, table: string, field: string, value: string, fields: string): Promise<Row | null> {
  const result = await client.from(table).select(fields).eq(field, value).maybeSingle();
  if (result.error) throw new Error(`ops ${table} query failed: ${result.error.message}`);
  return (result.data as unknown as Row | null) ?? null;
}
async function relatedProfiles(client: ServiceClient, workspaceId: string): Promise<Row[]> {
  const members = await related(client, "workspace_members", [workspaceId], "profile_id,role");
  return profilesForMembers(client, members);
}
async function loadCustomerEmailStatus(client: ServiceClient, workspaceId: string) {
  const [preferences, owners] = await Promise.all([
    related(client, "customer_communication_preferences", [workspaceId], "id,workspace_id,profile_id,email,marketing_consent,topics,unsubscribed_at,suppressed,suppression_reason,consent_source,consent_recorded_at,updated_at"),
    related(client, "workspace_members", [workspaceId], "profile_id,role"),
  ]);
  const owner = owners.find((row) => row.role === "owner");
  let email: string | null = null;
  if (owner?.profile_id) {
    const profile = await one(client, "profiles", "id", String(owner.profile_id), "email");
    email = typeof profile?.email === "string" ? profile.email : null;
  }
  let suppressions: Row[] = [];
  if (email) {
    const result = await client.from("email_suppressions").select("email,reason,source,created_at").eq("email", email.toLowerCase().trim()).limit(20);
    if (result.error) throw new Error(`ops email suppressions query failed: ${result.error.message}`);
    suppressions = (result.data ?? []) as unknown as Row[];
  }
  return { address: email, preferences, suppressions, deliveries: [] };
}

export async function loadPublicEnquiries(input: { cursor?: string; limit?: number; serviceSupabase?: ServiceClient } = {}) {
  const client = input.serviceSupabase ?? createSupabaseServiceClient();
  const limit = boundedLimit(input.limit ?? 50);
  const cursor = decodeCursor(input.cursor);
  let query = client.from("ops_enquiry_associations").select(ENQUIRY_FIELDS.join(","), { count: "exact" }).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
  if (cursor) query = query.or(`created_at.lt.${cursor.updatedAt},and(created_at.eq.${cursor.updatedAt},id.lt.${cursor.id})`);
  const result = await query;
  if (result.error) throw new Error(`ops enquiries query failed: ${result.error.message}`);
  const fetched = ((result.data ?? []) as unknown as Row[]);
  const hasMore = fetched.length > limit;
  const rows = hasMore ? fetched.slice(0, limit) : fetched;
  const last = rows.at(-1);
  return { limit, total: result.count ?? rows.length, nextCursor: hasMore && last ? encodeCursor({ updatedAt: String(last.created_at), id: String(last.id) }) : null, rows: rows.map((row) => redact(row, ENQUIRY_FIELDS)) };
}
async function profilesForMembers(client: ServiceClient, members: Row[]): Promise<Row[]> {
  const ids = members.map((row) => String(row.profile_id)).filter(Boolean);
  if (!ids.length) return [];
  const result = await client.from("profiles").select(PROFILE_FIELDS.join(",")).in("id", ids);
  if (result.error) throw new Error(`ops profiles query failed: ${result.error.message}`);
  return ((result.data ?? []) as unknown as Row[]).map((row) => redact(row, PROFILE_FIELDS));
}
function summarize(workspace: Row, members: Row[], profiles: Row[], activations: Row[], bookings: Row[]) {
  const owner = members.find((row) => row.workspace_id === workspace.id && row.role === "owner");
  const profile = profiles.find((row) => row.id === owner?.profile_id);
  const activation = activations.find((row) => row.workspace_id === workspace.id);
  const booking = bookings.filter((row) => row.workspace_id === workspace.id).sort((a, b) => String(b.updated_at ?? b.created_at).localeCompare(String(a.updated_at ?? a.created_at)))[0];
  return { ...redact(workspace, SUMMARY_FIELDS), owner: profile ?? null, lifecycle: lifecycleStage(activation), booking: booking ? redact(booking, BOOKING_FIELDS) : null };
}
function lifecycleStage(row: Row | undefined) {
  if (!row?.email_verified_at) return { stage: "email_pending", nextAction: "verify_email" };
  if (!row.website_submitted_at) return { stage: "brand_setup", nextAction: "add_website" };
  if (!row.brand_pack_approved_at) return { stage: "brand_review", nextAction: "approve_brand_pack" };
  if (!row.first_ad_pack_generated_at) return { stage: "first_value", nextAction: "generate_first_ad" };
  if (!row.meta_connected_at) return { stage: "meta_setup", nextAction: "connect_meta" };
  if (!row.checkout_completed_at) return { stage: "conversion", nextAction: "complete_checkout" };
  if (!row.onboarding_completed_at) return { stage: "activated", nextAction: "complete_onboarding" };
  return { stage: "active", nextAction: "operate_workspace" };
}
function redact(row: Row, fields: readonly string[]): Row { return Object.fromEntries(fields.filter((field) => field in row).map((field) => [field, redactValue(row[field])])); }
function redactActivity(row: Row): Row { return redact(row, Object.keys(row).filter((key) => key !== "metadata")); }
function redactProjection(row: Row): Row {
  const safe = redact(row, PROJECTION_FIELDS);
  if ("last_error" in row) safe.last_error = redactString(String(row.last_error ?? "")).slice(0, 512);
  return safe;
}
function escapeLike(value: string): string { return value.replace(/[\\%_]/g, "\\$&"); }
function boundedLimit(value: number): number { return Math.min(100, Math.max(1, Math.floor(Number.isFinite(value) ? value : 50))); }
function encodeCursor(cursor: { updatedAt: string; id: string }): string { return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url"); }
function decodeCursor(value: string | undefined): { updatedAt: string; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { updatedAt?: unknown; id?: unknown };
    if (typeof parsed.updatedAt !== "string" || typeof parsed.id !== "string" || parsed.updatedAt.length > 64 || parsed.id.length > 64) return null;
    return { updatedAt: parsed.updatedAt, id: parsed.id };
  } catch { return null; }
}
