import { recordCustomerActivationMilestone } from "../activation/customer-activation.ts";
import { createBookingInvitation, getLatestOnboardingBooking } from "../booking/service.ts";
import { normalizeBookingMarket } from "../booking/provider.ts";
import { sendOperatorEmail, getOperatorMailboxConfig } from "./email-service.ts";
import { recordAuditLog } from "../supabase/audit.ts";
import { createSupabaseServiceClient } from "../supabase/service.ts";
import { MANUAL_REQUEST_ACTION, MANUAL_REQUEST_TARGET, MANUAL_STATUS_ACTION } from "../adstudio/manual-publish.ts";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export const CUSTOMER_QUEUE_KEYS = [
  "all",
  "verified_no_website",
  "brand_scan_failed",
  "generated_no_meta",
  "meta_help_needed",
  "checkout_incomplete",
  "paid_no_booking",
  "publish_failed",
  "payment_failed",
  "low_credits",
  "managed_work",
] as const;

export type CustomerQueueKey = (typeof CUSTOMER_QUEUE_KEYS)[number];

export const CUSTOMER_QUEUE_LABELS: Record<CustomerQueueKey, string> = {
  all: "All customers",
  verified_no_website: "Verified, no website",
  brand_scan_failed: "Brand Pack failed",
  generated_no_meta: "Generated, no Meta",
  meta_help_needed: "Meta help needed",
  checkout_incomplete: "Checkout incomplete",
  paid_no_booking: "Paid, no booking",
  publish_failed: "Publish failed",
  payment_failed: "Payment failed",
  low_credits: "Low credits",
  managed_work: "Managed work",
};

export type OperatorCustomerRow = {
  workspaceId: string;
  workspaceName: string;
  customerName: string;
  customerEmail: string;
  country: "US" | "AU";
  lifecycleStage: string;
  nextAction: string;
  plan: string;
  billingState: string;
  creditsRemaining: number | null;
  brandPackState: string;
  metaState: string;
  freeLiveState: string;
  bookingState: string;
  lastActivityAt: string | null;
  riskState: string;
  queues: CustomerQueueKey[];
};

export type OperatorCustomerDetail = {
  summary: OperatorCustomerRow;
  activation: Record<string, unknown> | null;
  workspace: Record<string, unknown>;
  wallets: Record<string, unknown>[];
  creditLedger: Record<string, unknown>[];
  brandPacks: Record<string, unknown>[];
  providerConnections: Record<string, unknown>[];
  publishPlans: Record<string, unknown>[];
  campaigns: Record<string, unknown>[];
  members: Record<string, unknown>[];
  bookings: Record<string, unknown>[];
  audit: Record<string, unknown>[];
};

type WorkspaceRow = Record<string, unknown> & {
  id: string;
  name?: string | null;
  mode?: string | null;
  region?: string | null;
  country_code?: string | null;
  managed_service_enabled?: boolean | null;
  stripe_subscription_status?: string | null;
  stripe_latest_invoice_status?: string | null;
  billing_access_state?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

export async function loadOperatorCustomers(input: {
  query?: string;
  queue?: string;
  serviceSupabase?: ServiceClient;
} = {}): Promise<{ rows: OperatorCustomerRow[]; queueCounts: Record<CustomerQueueKey, number> }> {
  const service = input.serviceSupabase ?? createSupabaseServiceClient();
  const { data: workspaceData, error } = await service
    .from("workspaces")
    .select("*, workspace_plans(name,key)")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Customers could not be loaded: ${error.message}`);
  const workspaces = (workspaceData ?? []) as WorkspaceRow[];
  const workspaceIds = workspaces.map((workspace) => workspace.id);
  const related = await loadCustomerRelations(service, workspaceIds);
  const rows = workspaces.map((workspace) => buildCustomerRow(workspace, related));
  const queueCounts = Object.fromEntries(
    CUSTOMER_QUEUE_KEYS.map((queue) => [
      queue,
      queue === "all" ? rows.length : rows.filter((row) => row.queues.includes(queue)).length,
    ]),
  ) as Record<CustomerQueueKey, number>;
  const queue = isCustomerQueueKey(input.queue) ? input.queue : "all";
  const query = input.query?.trim().toLocaleLowerCase() ?? "";
  return {
    rows: rows.filter((row) => {
      if (queue !== "all" && !row.queues.includes(queue)) return false;
      if (!query) return true;
      return [row.workspaceName, row.customerName, row.customerEmail]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query);
    }),
    queueCounts,
  };
}

export async function loadOperatorCustomerDetail(input: {
  workspaceId: string;
  serviceSupabase?: ServiceClient;
}): Promise<OperatorCustomerDetail | null> {
  const service = input.serviceSupabase ?? createSupabaseServiceClient();
  const { data: workspace, error } = await service
    .from("workspaces")
    .select("*, workspace_plans(name,key)")
    .eq("id", input.workspaceId)
    .maybeSingle();
  if (error) throw new Error(`Customer could not be loaded: ${error.message}`);
  if (!workspace) return null;
  const related = await loadCustomerRelations(service, [input.workspaceId], true);
  return {
    summary: buildCustomerRow(workspace as WorkspaceRow, related),
    activation: related.activations[0] ?? null,
    workspace: workspace as Record<string, unknown>,
    wallets: related.wallets,
    creditLedger: related.creditLedger,
    brandPacks: related.brandPacks,
    providerConnections: related.connections,
    publishPlans: related.publishPlans,
    campaigns: related.campaigns,
    members: related.members,
    bookings: related.bookings,
    audit: related.audit,
  };
}

export async function runOperatorCustomerAction(input: {
  workspaceId: string;
  operatorProfileId: string;
  action: "adjust_credits" | "resend_booking" | "complete_onboarding";
  mutationId: string;
  reason: string;
  creditDelta?: number;
  serviceSupabase?: ServiceClient;
}): Promise<Record<string, unknown>> {
  const service = input.serviceSupabase ?? createSupabaseServiceClient();
  const mutationKey = `operator:${input.operatorProfileId}:${input.mutationId.trim()}`;
  const reason = input.reason.trim();
  if (!reason) throw new OperatorCustomerActionError("A reason is required.", 400);

  let result: Record<string, unknown>;
  if (input.action === "adjust_credits") {
    const delta = Number(input.creditDelta);
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 10_000) {
      throw new OperatorCustomerActionError("Credit adjustment must be a non-zero whole number.", 400);
    }
    const rpc = await service.rpc("adjust_workspace_credits", {
      p_workspace_id: input.workspaceId,
      p_delta: delta,
      p_mutation_key: mutationKey,
      p_reason: reason,
      p_actor_profile_id: input.operatorProfileId,
      p_metadata: { source: "operator_customer_operations" },
    });
    if (rpc.error) throw new Error(`Credits could not be adjusted: ${rpc.error.message}`);
    result = { action: input.action, adjustment: Array.isArray(rpc.data) ? rpc.data[0] : rpc.data };
  } else if (input.action === "resend_booking") {
    const customer = await loadBookingRecipient(service, input.workspaceId);
    const booking = await createBookingInvitation({
      workspaceId: input.workspaceId,
      market: customer.market,
      customerEmail: customer.email,
      customerName: customer.name,
      mutationKey,
      serviceSupabase: service,
    });
    let delivery: "email" | "manual" = "manual";
    if (customer.email && getOperatorMailboxConfig().configured) {
      await sendOperatorEmail({
        to: [customer.email],
        subject: "Book your Blockwise onboarding call",
        text: `Choose a convenient onboarding time with the Blockwise team:\n\n${booking.hostedBookingUrl}\n\nYour product access is not affected if you book later.`,
      });
      delivery = "email";
    }
    result = { action: input.action, bookingUrl: booking.hostedBookingUrl, delivery };
  } else {
    const latest = await getLatestOnboardingBooking({
      workspaceId: input.workspaceId,
      serviceSupabase: service,
    });
    if (latest) {
      const update = await service
        .from("workspace_onboarding_bookings")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", latest.id);
      if (update.error) throw new Error(`Booking could not be completed: ${update.error.message}`);
    }
    await recordCustomerActivationMilestone({
      workspaceId: input.workspaceId,
      milestone: "onboarding_completed",
      serviceSupabase: service,
    });
    result = { action: input.action, bookingId: latest?.id ?? null };
  }

  await recordAuditLog(service, {
    workspaceId: input.workspaceId,
    actorProfileId: input.operatorProfileId,
    action: `operator.customer.${input.action}`,
    targetType: "workspace",
    targetId: input.workspaceId,
    correlationId: mutationKey,
    metadata: { reason, ...result },
  });
  return result;
}

export class OperatorCustomerActionError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "OperatorCustomerActionError";
    this.status = status;
  }
}

type CustomerRelations = Awaited<ReturnType<typeof loadCustomerRelations>>;

async function loadCustomerRelations(service: ServiceClient, workspaceIds: string[], detail = false) {
  if (workspaceIds.length === 0) {
    return {
      activations: [], wallets: [], creditLedger: [], brandPacks: [], connections: [],
      publishPlans: [], campaigns: [], members: [], bookings: [], freeLiveClaims: [], audit: [],
    } satisfies Record<string, Record<string, unknown>[]>;
  }
  const table = (name: string, columns = "*") =>
    service.from(name).select(columns).in("workspace_id", workspaceIds);
  const [
    activations, wallets, brandPacks, connections, publishPlans, campaigns,
    members, bookings, freeLiveClaims, creditLedger, audit,
  ] = await Promise.all([
    table("customer_activations"),
    table("workspace_credit_wallets"),
    table("adstudio_brand_kits"),
    table("provider_connections"),
    table("meta_publish_plans"),
    table("adstudio_campaigns"),
    table("workspace_members", "*, profiles(full_name,email,is_operator)"),
    table("workspace_onboarding_bookings"),
    table("meta_free_live_claims"),
    detail ? table("workspace_credit_ledger") : Promise.resolve({ data: [], error: null }),
    detail
      ? table("audit_logs")
      : service
          .from("audit_logs")
          .select("workspace_id,action,target_type,correlation_id,metadata,created_at")
          .in("workspace_id", workspaceIds)
          .eq("target_type", MANUAL_REQUEST_TARGET),
  ]);
  const results = {
    activations, wallets, brandPacks, connections, publishPlans, campaigns,
    members, bookings, freeLiveClaims, creditLedger, audit,
  };
  for (const [name, result] of Object.entries(results)) {
    if (result.error && !["42P01", "42703", "PGRST204", "PGRST205"].includes(result.error.code ?? "")) {
      throw new Error(`Customer ${name} could not be loaded: ${result.error.message}`);
    }
  }
  return Object.fromEntries(
    Object.entries(results).map(([name, result]) => [
      name,
      (result.data ?? []) as unknown as Record<string, unknown>[],
    ]),
  ) as {
    activations: Record<string, unknown>[];
    wallets: Record<string, unknown>[];
    creditLedger: Record<string, unknown>[];
    brandPacks: Record<string, unknown>[];
    connections: Record<string, unknown>[];
    publishPlans: Record<string, unknown>[];
    campaigns: Record<string, unknown>[];
    members: Record<string, unknown>[];
    bookings: Record<string, unknown>[];
    freeLiveClaims: Record<string, unknown>[];
    audit: Record<string, unknown>[];
  };
}

function buildCustomerRow(workspace: WorkspaceRow, related: CustomerRelations): OperatorCustomerRow {
  const workspaceId = workspace.id;
  const activation = latest(related.activations, workspaceId);
  const wallet = latest(related.wallets, workspaceId, "period_end");
  const brand = latest(related.brandPacks, workspaceId);
  const meta = related.connections.find((row) => row.workspace_id === workspaceId && row.provider === "meta");
  const booking = latest(related.bookings, workspaceId);
  const owner = related.members.find((row) => row.workspace_id === workspaceId && row.role === "owner");
  const profile = oneRecord(owner?.profiles);
  const freeLive = related.freeLiveClaims.find((row) => row.workspace_id === workspaceId);
  const publishes = related.publishPlans.filter((row) => row.workspace_id === workspaceId);
  const campaigns = related.campaigns.filter((row) => row.workspace_id === workspaceId);
  const manualPublishPending = hasOpenManualPublishRequest(related.audit, workspaceId);
  const stage = activationStage(activation, manualPublishPending);
  const queues: CustomerQueueKey[] = [];
  if (activation?.email_verified_at && !activation.website_submitted_at) queues.push("verified_no_website");
  if (["failed", "error"].includes(String(brand?.review_status ?? ""))) queues.push("brand_scan_failed");
  if (activation?.first_ad_pack_generated_at && meta?.status !== "connected") queues.push("generated_no_meta");
  if ((activation?.meta_help_selected_at || manualPublishPending) && meta?.status !== "connected") queues.push("meta_help_needed");
  if (activation?.meta_connected_at && !activation.checkout_completed_at) queues.push("checkout_incomplete");
  if (activation?.intro_invoice_paid_at && !["booked", "rescheduled", "completed"].includes(String(booking?.status ?? ""))) queues.push("paid_no_booking");
  if (publishes.some((row) => ["failed", "error"].includes(String(row.status ?? "")))) queues.push("publish_failed");
  if (workspace.billing_access_state === "payment_recovery" || workspace.stripe_latest_invoice_status === "payment_failed") queues.push("payment_failed");
  const creditsRemaining = wallet
    ? Math.max(0, number(wallet.credits_granted) - number(wallet.credits_reserved) - number(wallet.credits_consumed) - number(wallet.credits_expired))
    : null;
  if (creditsRemaining !== null && creditsRemaining <= 10 && number(wallet.credits_consumed) > 0) queues.push("low_credits");
  if (workspace.managed_service_enabled) queues.push("managed_work");

  return {
    workspaceId,
    workspaceName: workspace.name ?? "Unnamed workspace",
    customerName: string(profile?.full_name) ?? string(profile?.email) ?? "Workspace owner",
    customerEmail: string(profile?.email) ?? "",
    country: normalizeBookingMarket(workspace.country_code ?? workspace.region),
    lifecycleStage: stage.label,
    nextAction: stage.nextAction,
    plan: workspace.managed_service_enabled
      ? "Managed"
      : string(oneRecord(workspace.workspace_plans)?.name) ?? "Self serve",
    billingState: workspace.billing_access_state ?? workspace.stripe_subscription_status ?? "Unbilled",
    creditsRemaining,
    brandPackState: string(brand?.review_status) ?? "Not started",
    metaState: string(meta?.status) ?? "Not connected",
    freeLiveState: string(freeLive?.status) ?? "Available",
    bookingState: string(booking?.status) ?? "Not booked",
    lastActivityAt: latestDate([
      workspace.updated_at, workspace.created_at, string(activation?.updated_at),
      string(brand?.updated_at), string(meta?.updated_at), string(booking?.updated_at),
      ...campaigns.map((row) => string(row.updated_at)),
    ]),
    riskState: queues.some((queue) => ["payment_failed", "publish_failed", "brand_scan_failed"].includes(queue))
      ? "Needs review"
      : "Normal",
    queues,
  };
}

function activationStage(row: Record<string, unknown> | null, manualPublishPending = false): { label: string; nextAction: string } {
  if (!row?.email_verified_at) return { label: "Email pending", nextAction: "Verify email" };
  if (!row.country_confirmed_at) return { label: "Market setup", nextAction: "Confirm country" };
  if (!row.website_submitted_at) return { label: "Brand setup", nextAction: "Add website" };
  if (!row.brand_pack_approved_at) return { label: "Brand review", nextAction: "Approve Brand Pack" };
  if (!row.first_ad_pack_generated_at) return { label: "First value", nextAction: "Generate first ad" };
  if (manualPublishPending) return { label: "Manual publishing", nextAction: "Process publish request" };
  if (!row.meta_connected_at) return { label: "Meta setup", nextAction: "Connect Meta" };
  if (!row.checkout_completed_at) return { label: "Conversion", nextAction: "Complete Checkout" };
  if (!row.first_campaign_live_at) return { label: "Launch", nextAction: "Launch first campaign" };
  if (!row.intro_invoice_paid_at) return { label: "Billing", nextAction: "Confirm first invoice" };
  if (!row.onboarding_completed_at) return { label: "Activated", nextAction: "Complete onboarding" };
  return { label: "Active", nextAction: "Operate workspace" };
}

function hasOpenManualPublishRequest(audit: Record<string, unknown>[], workspaceId: string): boolean {
  const statuses = new Map<string, string>();
  const ordered = audit
    .filter((row) => row.workspace_id === workspaceId && row.target_type === MANUAL_REQUEST_TARGET)
    .sort((left, right) => String(left.created_at ?? "").localeCompare(String(right.created_at ?? "")));
  for (const row of ordered) {
    const requestId = string(row.correlation_id);
    if (!requestId) continue;
    if (row.action === MANUAL_REQUEST_ACTION) statuses.set(requestId, "requested");
    if (row.action === MANUAL_STATUS_ACTION) {
      const metadata = oneRecord(row.metadata);
      const status = string(metadata?.status);
      if (status) statuses.set(requestId, status);
    }
  }
  return [...statuses.values()].some((status) => status === "requested" || status === "in_progress");
}

async function loadBookingRecipient(service: ServiceClient, workspaceId: string) {
  const [{ data: workspace, error: workspaceError }, { data: owner, error: ownerError }] = await Promise.all([
    service.from("workspaces").select("country_code,region").eq("id", workspaceId).single(),
    service
      .from("workspace_members")
      .select("profiles(full_name,email)")
      .eq("workspace_id", workspaceId)
      .eq("role", "owner")
      .limit(1)
      .maybeSingle(),
  ]);
  if (workspaceError) throw new Error(`Workspace could not be loaded: ${workspaceError.message}`);
  if (ownerError) throw new Error(`Workspace owner could not be loaded: ${ownerError.message}`);
  const profile = oneRecord(owner?.profiles);
  return {
    market: normalizeBookingMarket(workspace.country_code ?? workspace.region),
    name: string(profile?.full_name),
    email: string(profile?.email),
  };
}

function isCustomerQueueKey(value: string | undefined): value is CustomerQueueKey {
  return CUSTOMER_QUEUE_KEYS.includes(value as CustomerQueueKey);
}

function latest(rows: Record<string, unknown>[], workspaceId: string, column = "updated_at") {
  return rows
    .filter((row) => row.workspace_id === workspaceId)
    .sort((left, right) => String(right[column] ?? right.created_at ?? "").localeCompare(String(left[column] ?? left.created_at ?? "")))[0] ?? null;
}

function oneRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return oneRecord(value[0]);
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestDate(values: Array<string | null | undefined>): string | null {
  return values.filter((value): value is string => Boolean(value)).sort().reverse()[0] ?? null;
}
