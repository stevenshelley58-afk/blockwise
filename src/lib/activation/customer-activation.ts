import { createSupabaseServiceClient } from "../supabase/service.ts";

type ActivationServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export const ACTIVATION_MILESTONES = [
  "email_verified",
  "country_confirmed",
  "website_submitted",
  "brand_pack_approved",
  "first_template_selected",
  "first_ad_pack_generated",
  "meta_help_selected",
  "meta_connected",
  "checkout_completed",
  "free_live_claim_reserved",
  "free_live_claim_consumed",
  "first_campaign_live",
  "intro_invoice_paid",
  "onboarding_booked",
  "onboarding_completed",
  "activation_completed",
] as const;

export type ActivationMilestone = typeof ACTIVATION_MILESTONES[number];

export type CustomerActivationRecord = {
  workspace_id: string;
  email_verified_at: string | null;
  country_confirmed_at: string | null;
  website_submitted_at: string | null;
  brand_pack_approved_at: string | null;
  first_template_selected_at: string | null;
  first_ad_pack_generated_at: string | null;
  meta_help_selected_at: string | null;
  meta_help_path: string | null;
  meta_connected_at: string | null;
  checkout_completed_at: string | null;
  free_live_claim_reserved_at: string | null;
  free_live_claim_consumed_at: string | null;
  first_campaign_live_at: string | null;
  intro_invoice_paid_at: string | null;
  onboarding_booked_at: string | null;
  onboarding_completed_at: string | null;
  activation_completed_at: string | null;
};

export type ActivationAuthoritativeRows = {
  emailVerifiedAt: string | null;
  workspace: {
    country_code?: string | null;
    updated_at?: string | null;
    billing_checkout_completed_at?: string | null;
    stripe_intro_invoice_paid_at?: string | null;
    billing_access_state?: string | null;
  };
  brandKits: Array<{
    source_url?: string | null;
    review_status?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
  }>;
  campaigns: Array<{
    id?: string | null;
    template_key?: string | null;
    created_at?: string | null;
  }>;
  creatives: Array<{
    campaign_id?: string | null;
    render_status?: string | null;
    created_at?: string | null;
  }>;
  providerConnections: Array<{
    provider?: string | null;
    status?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
  }>;
  publishPlans: Array<{
    status?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
  }>;
  bookings: Array<{
    status?: string | null;
    booked_at?: string | null;
    completed_at?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
  }>;
  sourceBlockers?: string[];
};

export type CustomerActivationStage =
  | "verify_email"
  | "confirm_country"
  | "submit_website"
  | "approve_brand_pack"
  | "select_template"
  | "generate_first_ad"
  | "choose_meta_path"
  | "connect_meta"
  | "complete_checkout"
  | "launch_first_campaign"
  | "confirm_first_invoice"
  | "complete";

export type ResolvedCustomerActivation = {
  workspaceId: string;
  currentStage: CustomerActivationStage;
  nextAction: string;
  allowedActions: string[];
  resumePath: string;
  progress: {
    completed: number;
    total: number;
    milestones: Record<ActivationMilestone, string | null>;
  };
  operatorBlockers: string[];
  repairedMilestones: ActivationMilestone[];
  record: CustomerActivationRecord;
};

const milestoneColumns: Record<ActivationMilestone, keyof CustomerActivationRecord> = {
  email_verified: "email_verified_at",
  country_confirmed: "country_confirmed_at",
  website_submitted: "website_submitted_at",
  brand_pack_approved: "brand_pack_approved_at",
  first_template_selected: "first_template_selected_at",
  first_ad_pack_generated: "first_ad_pack_generated_at",
  meta_help_selected: "meta_help_selected_at",
  meta_connected: "meta_connected_at",
  checkout_completed: "checkout_completed_at",
  free_live_claim_reserved: "free_live_claim_reserved_at",
  free_live_claim_consumed: "free_live_claim_consumed_at",
  first_campaign_live: "first_campaign_live_at",
  intro_invoice_paid: "intro_invoice_paid_at",
  onboarding_booked: "onboarding_booked_at",
  onboarding_completed: "onboarding_completed_at",
  activation_completed: "activation_completed_at",
};

const emptyRecord = (workspaceId: string): CustomerActivationRecord => ({
  workspace_id: workspaceId,
  email_verified_at: null,
  country_confirmed_at: null,
  website_submitted_at: null,
  brand_pack_approved_at: null,
  first_template_selected_at: null,
  first_ad_pack_generated_at: null,
  meta_help_selected_at: null,
  meta_help_path: null,
  meta_connected_at: null,
  checkout_completed_at: null,
  free_live_claim_reserved_at: null,
  free_live_claim_consumed_at: null,
  first_campaign_live_at: null,
  intro_invoice_paid_at: null,
  onboarding_booked_at: null,
  onboarding_completed_at: null,
  activation_completed_at: null,
});

export async function recordCustomerActivationMilestone(input: {
  workspaceId: string;
  milestone: ActivationMilestone;
  occurredAt?: string;
  choice?: string;
  serviceSupabase?: ActivationServiceClient;
}): Promise<CustomerActivationRecord> {
  const service = input.serviceSupabase ?? createSupabaseServiceClient();
  const { data, error } = await service.rpc("record_customer_activation_milestone", {
    p_workspace_id: input.workspaceId,
    p_milestone: input.milestone,
    p_occurred_at: input.occurredAt ?? new Date().toISOString(),
    p_choice: input.choice ?? null,
  });
  if (error) throw new Error(`Activation milestone could not be recorded: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error("Activation milestone returned no activation record.");
  }
  return row as CustomerActivationRecord;
}

export async function resolveCustomerActivation(input: {
  workspaceId: string;
  serviceSupabase?: ActivationServiceClient;
  authoritativeRows?: ActivationAuthoritativeRows;
  repair?: boolean;
}): Promise<ResolvedCustomerActivation> {
  const service = input.serviceSupabase ?? createSupabaseServiceClient();
  let record: CustomerActivationRecord | null;
  let sources: ActivationAuthoritativeRows;
  try {
    [record, sources] = await Promise.all([
      loadActivationRecord(service, input.workspaceId),
      input.authoritativeRows
        ? Promise.resolve(input.authoritativeRows)
        : loadAuthoritativeRows(service, input.workspaceId),
    ]);
  } catch (error) {
    if (error instanceof ActivationSourceUnavailableError) {
      return unavailableActivation(input.workspaceId, "activation_foundation_unavailable");
    }
    throw error;
  }
  const current = { ...(record ?? emptyRecord(input.workspaceId)) };
  const derived = deriveAuthoritativeMilestones(sources);
  const repairedMilestones: ActivationMilestone[] = [];

  if (input.repair !== false) {
    for (const milestone of ACTIVATION_MILESTONES) {
      const column = milestoneColumns[milestone];
      const authoritativeTimestamp = derived[milestone];
      if (current[column] || !authoritativeTimestamp) continue;
      const repaired = await recordCustomerActivationMilestone({
        workspaceId: input.workspaceId,
        milestone,
        occurredAt: authoritativeTimestamp,
        serviceSupabase: service,
      });
      Object.assign(current, repaired);
      repairedMilestones.push(milestone);
    }
  }

  return buildResolvedActivation(current, sources, repairedMilestones);
}

export function deriveAuthoritativeMilestones(
  sources: ActivationAuthoritativeRows,
): Partial<Record<ActivationMilestone, string>> {
  const approvedBrand = sources.brandKits
    .filter((row) => row.review_status === "approved")
    .map((row) => row.updated_at ?? row.created_at)
    .filter(isString);
  const website = sources.brandKits
    .filter((row) => Boolean(row.source_url?.trim()))
    .map((row) => row.created_at)
    .filter(isString);
  const templatedCampaignIds = new Set(
    sources.campaigns
      .filter((row) => Boolean(row.template_key))
      .flatMap((row) => row.id ? [row.id] : []),
  );
  const templateSelected = sources.campaigns
    .filter((row) => Boolean(row.template_key))
    .map((row) => row.created_at)
    .filter(isString);
  const rendered = sources.creatives
    .filter((row) => row.render_status === "rendered" && (!row.campaign_id || templatedCampaignIds.has(row.campaign_id)))
    .map((row) => row.created_at)
    .filter(isString);
  const metaConnected = sources.providerConnections
    .filter((row) => row.provider === "meta" && row.status === "connected")
    .map((row) => row.updated_at ?? row.created_at)
    .filter(isString);
  const liveCampaign = sources.publishPlans
    .filter((row) => row.status === "paused_live")
    .map((row) => row.updated_at ?? row.created_at)
    .filter(isString);
  const booked = sources.bookings
    .filter((row) => !["cancelled", "failed"].includes(row.status ?? ""))
    .map((row) => row.booked_at ?? row.created_at)
    .filter(isString);
  const completedBooking = sources.bookings
    .filter((row) => row.status === "completed")
    .map((row) => row.completed_at ?? row.updated_at ?? row.created_at)
    .filter(isString);

  return compactMilestones({
    email_verified: sources.emailVerifiedAt,
    country_confirmed: ["US", "AU"].includes(sources.workspace.country_code ?? "")
      ? sources.workspace.updated_at ?? sources.workspace.billing_checkout_completed_at
      : null,
    website_submitted: earliest(website),
    brand_pack_approved: earliest(approvedBrand),
    first_template_selected: earliest(templateSelected),
    first_ad_pack_generated: earliest(rendered),
    meta_connected: earliest(metaConnected),
    checkout_completed: sources.workspace.billing_checkout_completed_at ?? null,
    first_campaign_live: earliest(liveCampaign),
    intro_invoice_paid: sources.workspace.stripe_intro_invoice_paid_at ?? null,
    onboarding_booked: earliest(booked),
    onboarding_completed: earliest(completedBooking),
  });
}

function buildResolvedActivation(
  record: CustomerActivationRecord,
  sources: ActivationAuthoritativeRows,
  repairedMilestones: ActivationMilestone[],
): ResolvedCustomerActivation {
  const milestones = Object.fromEntries(
    ACTIVATION_MILESTONES.map((milestone) => [milestone, record[milestoneColumns[milestone]] as string | null]),
  ) as Record<ActivationMilestone, string | null>;
  const stage = resolveStage(record);
  const operatorBlockers = [...(sources.sourceBlockers ?? [])];
  if (stage === "approve_brand_pack" && sources.brandKits.length > 0) {
    operatorBlockers.push("brand_pack_requires_customer_review");
  }
  if (stage === "connect_meta" && sources.providerConnections.some((row) => row.provider === "meta" && row.status === "needs_attention")) {
    operatorBlockers.push("meta_connection_needs_attention");
  }
  if (sources.workspace.billing_access_state === "payment_recovery") {
    operatorBlockers.push("payment_recovery_required");
  }

  const config = stageConfiguration(stage, record);
  return {
    workspaceId: record.workspace_id,
    currentStage: stage,
    nextAction: config.nextAction,
    allowedActions: config.allowedActions,
    resumePath: config.resumePath,
    progress: {
      completed: Object.values(milestones).filter(Boolean).length,
      total: ACTIVATION_MILESTONES.length,
      milestones,
    },
    operatorBlockers: [...new Set(operatorBlockers)],
    repairedMilestones,
    record,
  };
}

function resolveStage(record: CustomerActivationRecord): CustomerActivationStage {
  if (!record.email_verified_at) return "verify_email";
  if (!record.country_confirmed_at) return "confirm_country";
  if (!record.website_submitted_at) return "submit_website";
  if (!record.brand_pack_approved_at) return "approve_brand_pack";
  if (!record.first_template_selected_at) return "select_template";
  if (!record.first_ad_pack_generated_at) return "generate_first_ad";
  if (!record.meta_connected_at && !record.meta_help_selected_at) return "choose_meta_path";
  if (!record.meta_connected_at) return "connect_meta";
  if (!record.checkout_completed_at) return "complete_checkout";
  if (!record.first_campaign_live_at) return "launch_first_campaign";
  if (!record.intro_invoice_paid_at) return "confirm_first_invoice";
  return "complete";
}

function stageConfiguration(
  stage: CustomerActivationStage,
  record: CustomerActivationRecord,
): { nextAction: string; allowedActions: string[]; resumePath: string } {
  const map: Record<CustomerActivationStage, { nextAction: string; allowedActions: string[]; resumePath: string }> = {
    verify_email: { nextAction: "Verify your email", allowedActions: ["resend_verification"], resumePath: "/signup" },
    confirm_country: { nextAction: "Confirm your country", allowedActions: ["confirm_country"], resumePath: "/onboarding" },
    submit_website: { nextAction: "Add your business website", allowedActions: ["submit_website"], resumePath: "/onboarding" },
    approve_brand_pack: { nextAction: "Review your Brand Pack", allowedActions: ["approve_brand_pack", "retry_brand_scan"], resumePath: "/ad-studio/brand" },
    select_template: { nextAction: "Choose an ad template", allowedActions: ["select_template"], resumePath: "/ad-studio" },
    generate_first_ad: { nextAction: "Create your first ad", allowedActions: ["generate"], resumePath: "/ad-studio" },
    choose_meta_path: { nextAction: "Choose how to run your ad", allowedActions: ["connect_meta", "request_meta_help"], resumePath: "/ad-studio" },
    connect_meta: {
      nextAction: record.meta_help_path === "setup_guide" ? "Finish setting up Meta" : "Connect Meta",
      allowedActions: ["connect_meta", "book_onboarding"],
      resumePath: "/settings#connections",
    },
    complete_checkout: { nextAction: "Add a payment method", allowedActions: ["start_checkout"], resumePath: "/settings#billing" },
    launch_first_campaign: { nextAction: "Run your first ad", allowedActions: ["publish"], resumePath: "/ad-studio" },
    confirm_first_invoice: { nextAction: "Confirming your subscription", allowedActions: ["reconcile_billing"], resumePath: "/settings#billing" },
    complete: { nextAction: "Open your workspace", allowedActions: ["generate", "publish", "invite_team", "book_onboarding"], resumePath: "/self-serve" },
  };
  return map[stage];
}

async function loadActivationRecord(
  service: ActivationServiceClient,
  workspaceId: string,
): Promise<CustomerActivationRecord | null> {
  const { data, error } = await service
    .from("customer_activations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) {
    if (isUnavailablePostgrestError(error)) {
      throw new ActivationSourceUnavailableError(error.message);
    }
    throw new Error(`Activation record could not be loaded: ${error.message}`);
  }
  return data as CustomerActivationRecord | null;
}

class ActivationSourceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActivationSourceUnavailableError";
  }
}

function unavailableActivation(workspaceId: string, blocker: string): ResolvedCustomerActivation {
  const record = emptyRecord(workspaceId);
  return {
    workspaceId,
    currentStage: "complete",
    nextAction: "Open your workspace",
    allowedActions: [],
    resumePath: "/self-serve",
    progress: {
      completed: 0,
      total: ACTIVATION_MILESTONES.length,
      milestones: Object.fromEntries(
        ACTIVATION_MILESTONES.map((milestone) => [milestone, null]),
      ) as Record<ActivationMilestone, string | null>,
    },
    operatorBlockers: [blocker],
    repairedMilestones: [],
    record,
  };
}

async function loadAuthoritativeRows(
  service: ActivationServiceClient,
  workspaceId: string,
): Promise<ActivationAuthoritativeRows> {
  const [workspace, brands, campaigns, creatives, connections, plans, bookings] = await Promise.all([
    service
      .from("workspaces")
      .select("created_by,country_code,updated_at,billing_checkout_completed_at,stripe_intro_invoice_paid_at,billing_access_state")
      .eq("id", workspaceId)
      .single(),
    service
      .from("adstudio_brand_kits")
      .select("source_url,review_status,created_at,updated_at")
      .eq("workspace_id", workspaceId),
    service
      .from("adstudio_campaigns")
      .select("id,template_key,created_at")
      .eq("workspace_id", workspaceId),
    service
      .from("adstudio_creatives")
      .select("campaign_id,render_status,created_at")
      .eq("workspace_id", workspaceId),
    service
      .from("provider_connections")
      .select("provider,status,created_at,updated_at")
      .eq("workspace_id", workspaceId),
    service
      .from("meta_publish_plans")
      .select("status,created_at,updated_at")
      .eq("workspace_id", workspaceId),
    service
      .from("workspace_onboarding_bookings")
      .select("status,booked_at,completed_at,created_at,updated_at")
      .eq("workspace_id", workspaceId),
  ]);
  for (const result of [workspace, brands, campaigns, creatives, connections, plans]) {
    if (result.error) {
      if (isUnavailablePostgrestError(result.error)) {
        throw new ActivationSourceUnavailableError(result.error.message);
      }
      throw new Error(`Activation source could not be loaded: ${result.error.message}`);
    }
  }

  const workspaceRow = (workspace.data ?? {}) as ActivationAuthoritativeRows["workspace"] & { created_by?: string | null };
  let emailVerifiedAt: string | null = null;
  if (workspaceRow.created_by) {
    const { data, error } = await service.auth.admin.getUserById(workspaceRow.created_by);
    if (error) throw new Error(`Activation identity source could not be loaded: ${error.message}`);
    emailVerifiedAt = data.user?.email_confirmed_at ?? data.user?.confirmed_at ?? null;
  }

  const sourceBlockers: string[] = [];
  if (bookings.error && ["42P01", "PGRST205"].includes(bookings.error.code ?? "")) {
    sourceBlockers.push("booking_source_unavailable");
  } else if (bookings.error) {
    throw new Error(`Activation booking source could not be loaded: ${bookings.error.message}`);
  }

  return {
    emailVerifiedAt,
    workspace: workspaceRow,
    brandKits: (brands.data ?? []) as ActivationAuthoritativeRows["brandKits"],
    campaigns: (campaigns.data ?? []) as ActivationAuthoritativeRows["campaigns"],
    creatives: (creatives.data ?? []) as ActivationAuthoritativeRows["creatives"],
    providerConnections: (connections.data ?? []) as ActivationAuthoritativeRows["providerConnections"],
    publishPlans: (plans.data ?? []) as ActivationAuthoritativeRows["publishPlans"],
    bookings: (bookings.data ?? []) as ActivationAuthoritativeRows["bookings"],
    sourceBlockers,
  };
}

function compactMilestones(
  values: Partial<Record<ActivationMilestone, string | null>>,
): Partial<Record<ActivationMilestone, string>> {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [ActivationMilestone, string] => Boolean(entry[1])),
  );
}

function earliest(values: string[]): string | null {
  return values.length ? [...values].sort()[0] : null;
}

function isString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function isUnavailablePostgrestError(error: { code?: string | null }): boolean {
  return ["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code ?? "");
}
