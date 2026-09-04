import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "../supabase/service.ts";

type ServiceClient = SupabaseClient;
type Row = Record<string, unknown>;

const SUMMARY_FIELDS = ["id", "name", "mode", "region", "country_code", "managed_service_enabled", "billing_access_state", "billing_email", "stripe_subscription_status", "stripe_latest_invoice_status", "created_at", "updated_at"] as const;
const PROFILE_FIELDS = ["id", "email", "full_name", "created_at", "updated_at"] as const;
const ACTIVATION_FIELDS = ["workspace_id", "email_verified_at", "country_confirmed_at", "website_submitted_at", "brand_pack_approved_at", "first_ad_pack_generated_at", "meta_connected_at", "checkout_completed_at", "first_campaign_live_at", "intro_invoice_paid_at", "onboarding_booked_at", "onboarding_completed_at", "activation_completed_at", "updated_at"] as const;
const BOOKING_FIELDS = ["id", "workspace_id", "provider", "status", "scheduled_start_at", "scheduled_end_at", "booked_at", "cancelled_at", "completed_at", "created_at", "updated_at"] as const;
const LEAD_FIELDS = ["id", "workspace_id", "provider", "external_id", "email", "phone", "full_name", "suburb", "created_at"] as const;

export async function loadCustomerSummaries(input: { page?: number; pageSize?: number; query?: string; serviceSupabase?: ServiceClient } = {}) {
  const client = input.serviceSupabase ?? createSupabaseServiceClient();
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize ?? 50)));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  let workspaces = client.from("workspaces").select(SUMMARY_FIELDS.join(","), { count: "exact" }).order("updated_at", { ascending: false }).range(from, to);
  if (input.query?.trim()) workspaces = workspaces.ilike("name", `%${escapeLike(input.query.trim())}%`);
  const result = await workspaces;
  if (result.error) throw new Error(`ops customers query failed: ${result.error.message}`);
  const rows = (result.data ?? []) as unknown as Row[];
  const ids = rows.map((row) => String(row.id));
  const [members, activations, bookings] = await Promise.all([
    related(client, "workspace_members", ids, "workspace_id,profile_id,role,created_at"),
    related(client, "customer_activations", ids, ACTIVATION_FIELDS.join(",")),
    related(client, "workspace_onboarding_bookings", ids, BOOKING_FIELDS.join(",")),
  ]);
  const profiles = await profilesForMembers(client, members);
  return { page, pageSize, total: result.count ?? rows.length, rows: rows.map((row) => summarize(row, members, profiles, activations, bookings)) };
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
    related(client, "leads", [workspaceId], LEAD_FIELDS.join(",")),
    loadBilling(client, workspaceId),
    related(client, "audit_logs", [workspaceId], "id,workspace_id,action,target_type,target_id,created_at"),
    loadCustomerEmailStatus(client, workspaceId),
    related(client, "ops_projection_outbox", [workspaceId], "id,workspace_id,provider,aggregate_type,aggregate_id,operation,source_event_id,source_version,status,attempts,max_attempts,run_after,last_error,completed_at,created_at,updated_at"),
  ]);
  return { workspace: redact(workspace as unknown as Row, SUMMARY_FIELDS), members: members.map((row) => redact(row, ["workspace_id", "profile_id", "role", "created_at"])), profiles, activation: activation ? redact(activation, ACTIVATION_FIELDS) : null, bookings: bookings.map((row) => redact(row, BOOKING_FIELDS)), enquiries: leads.map((row) => redact(row, LEAD_FIELDS)), billing, email, projections, activity: audit };
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
    return { workspaceId, items: [...audit, ...leadEvents].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) };
  }
  if (resource === "bookings") return { workspaceId, items: await related(client, "workspace_onboarding_bookings", [workspaceId], BOOKING_FIELDS.join(",")) };
  if (resource === "billing") return { workspaceId, ...(await loadBilling(client, workspaceId)) };
  if (resource === "email") return { workspaceId, ...(await loadCustomerEmailStatus(client, workspaceId)) };
  if (resource === "enquiries") return { workspaceId, items: await related(client, "leads", [workspaceId], LEAD_FIELDS.join(",")) };
  if (resource === "projections") return { workspaceId, items: await related(client, "ops_projection_outbox", [workspaceId], "id,workspace_id,provider,aggregate_type,aggregate_id,operation,source_event_id,source_version,status,attempts,max_attempts,run_after,last_error,completed_at,created_at,updated_at") };
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
  const deliveries: Row[] = [];
  if (email) {
    const [demo, reports] = await Promise.all([
      client.from("demo_requests").select("id,email,customer_email_status,customer_emailed_at,customer_email_error,customer_email_message_id,operator_notification_status,created_at").eq("email", email),
      client.from("report_email_leads").select("id,email,delivery_status,delivered_at,delivery_error,delivery_message_id,created_at").eq("email", email),
    ]);
    if (demo.error) throw new Error(`ops demo_requests query failed: ${demo.error.message}`);
    if (reports.error) throw new Error(`ops report_email_leads query failed: ${reports.error.message}`);
    deliveries.push(...((demo.data ?? []) as unknown as Row[]).map((row) => ({ kind: "demo_request", ...row })));
    deliveries.push(...((reports.data ?? []) as unknown as Row[]).map((row) => ({ kind: "report_email", ...row })));
  }
  return { address: email, preferences, deliveries };
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
function redact(row: Row, fields: readonly string[]): Row { return Object.fromEntries(fields.filter((field) => field in row).map((field) => [field, row[field]])); }
function escapeLike(value: string): string { return value.replace(/[\\%_]/g, "\\$&"); }
