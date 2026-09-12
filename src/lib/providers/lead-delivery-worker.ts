import type { createSupabaseServiceClient } from "../supabase/service.ts";
import type { ApprovalStatus } from "../publishing/readiness.ts";
import { createWorkspaceCrm } from "../crm/index.ts";
import { isCrmError } from "../crm/errors.ts";
import { CrmSiteNotProvisionedError } from "../crm/site-resolution.ts";
import { produceNewLeadNotices, resolveNewLeadRecipients } from "../notifications/lead-notices.ts";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

function providerWritesEnabled() {
  return process.env.BLOCKWISE_ENABLE_PROVIDER_WRITES === "true";
}

type LeadDeliveryDestinationType = "webhook" | "crm" | "manual";
type StoredLeadDeliveryDestinationType = LeadDeliveryDestinationType | "email";

type LeadDeliveryAttemptRow = {
  id: string;
  workspace_id: string;
  lead_id: string;
  destination_type: StoredLeadDeliveryDestinationType;
  destination_label: string;
  status: "queued" | "delivered" | "failed" | "manual_review";
  approval_request_id: string | null;
  request_json: Record<string, unknown>;
  response_json: Record<string, unknown>;
};

type LeadRow = {
  id: string;
  email: string | null;
  phone: string | null;
  full_name: string | null;
  suburb: string | null;
  external_id: string | null;
  provider: string | null;
  created_at: string | null;
  raw_payload: Record<string, unknown>;
};

type LeadCrmDeliveryJob = {
  id: string;
  command_id: string;
  state: "pending" | "delivered" | "error";
  backfill: boolean;
};

/** Result of a CRM delivery pass. `pending` means the CRM is unreachable and
 * the captured lead is retained; the UI shows it as waiting for the CRM. */
export type LeadCrmDeliveryOutcome =
  | { status: "delivered"; crmLead: string; commandId: string; backfill: boolean }
  | { status: "pending"; commandId: string; reason: "crm_unavailable" }
  | { status: "error"; commandId: string; reason: "crm_site_not_provisioned" | "crm_rejected" };

export async function executeLeadDeliveryAttemptById(input: {
  serviceSupabase: SupabaseServiceClient;
  workspaceId: string;
  attemptId: string;
  fetchImpl?: typeof fetch;
}) {
  const attempt = await loadDeliveryAttempt(input.serviceSupabase, input.workspaceId, input.attemptId);

  if (!providerWritesEnabled()) {
    await updateAttempt(input.serviceSupabase, input.workspaceId, attempt.id, "failed", {
      message: "Provider writes are disabled by BLOCKWISE_ENABLE_PROVIDER_WRITES.",
    });
    await persistLeadDeliveryAudit(input.serviceSupabase, {
      ...attempt,
      status: "failed",
    });

    return { status: "failed" as const };
  }

  const approvalStatus = attempt.approval_request_id
    ? await loadApprovalStatus(input.serviceSupabase, input.workspaceId, attempt.approval_request_id)
    : "approved";

  if (approvalStatus !== "approved") {
    throw new Error("Lead delivery requires an approved approval request.");
  }

  const lead = await loadLead(input.serviceSupabase, input.workspaceId, attempt.lead_id);
  const endpoint = typeof attempt.request_json.endpoint === "string" ? attempt.request_json.endpoint : null;

  const destination = normalizeDeliveryDestination(attempt);

  // CRM destinations never use a caller-supplied endpoint and never forward a
  // raw capture payload: the enquiry is rebuilt from typed lead fields only.
  if (destination.type === "crm") {
    const outcome = await deliverLeadToCrm({
      serviceSupabase: input.serviceSupabase,
      workspaceId: input.workspaceId,
      attempt,
      lead,
      fetchImpl: input.fetchImpl,
    });

    await updateAttempt(
      input.serviceSupabase,
      input.workspaceId,
      attempt.id,
      outcome.status === "delivered" ? "delivered" : outcome.status === "pending" ? "queued" : "failed",
      { delivery: outcome },
    );
    await persistLeadDeliveryAudit(input.serviceSupabase, {
      ...attempt,
      status: outcome.status === "delivered" ? "delivered" : "failed",
    });

    if (outcome.status === "pending") {
      // Retain the captured lead, leave the job pending, and let the queue
      // retry. The retry reuses the original submission id, so a recovered CRM
      // replays the same command_id instead of creating a second enquiry.
      throw new Error("CRM is unavailable; the captured lead is retained and delivery stays pending.");
    }
    if (outcome.status === "error") {
      throw new Error(`Lead CRM delivery failed: ${outcome.reason}.`);
    }

    return { status: "delivered" as const, crmLead: outcome.crmLead };
  }

  if (!endpoint || destination.type === "manual") {
    await updateAttempt(input.serviceSupabase, input.workspaceId, attempt.id, "manual_review", {
      message: "No webhook or CRM endpoint configured.",
    });
    await persistLeadDeliveryAudit(input.serviceSupabase, {
      ...attempt,
      status: "manual_review",
    });

    return { status: "manual_review" as const };
  }

  try {
    const fetchImpl = input.fetchImpl ?? fetch;
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deliveryType: destination.type,
        destination: destination.label,
        leadId: lead.id,
        email: lead.email,
        phone: lead.phone,
        fullName: lead.full_name,
        suburb: lead.suburb,
        rawPayload: lead.raw_payload,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const status = response.ok ? "delivered" : "failed";

    await updateAttempt(input.serviceSupabase, input.workspaceId, attempt.id, status, {
      status: response.status,
      payload,
    });
    await persistLeadDeliveryAudit(input.serviceSupabase, {
      ...attempt,
      status,
    });

    return { status, responseStatus: response.status };
  } catch (error) {
    await updateAttempt(input.serviceSupabase, input.workspaceId, attempt.id, "failed", {
      message: error instanceof Error ? error.message : "Lead webhook delivery worker failed.",
    });
    await persistLeadDeliveryAudit(input.serviceSupabase, {
      ...attempt,
      status: "failed",
    });
    throw error;
  }
}

/**
 * Deliver one captured lead to the agency's Frappe site.
 *
 * Idempotent: the command id is derived from the original source submission
 * id, never generated per attempt, so a retry after an outage replays the
 * stored result. Delivery state is tracked on `lead_crm_delivery_jobs` and is
 * separate from the sales stage and from email delivery.
 *
 * `backfill` marks a historical import. Backfill runs request no first-contact
 * task and produce no notification.
 */
export async function deliverLeadToCrm(input: {
  serviceSupabase: SupabaseServiceClient;
  workspaceId: string;
  attempt: Pick<LeadDeliveryAttemptRow, "id" | "request_json">;
  lead: LeadRow;
  fetchImpl?: typeof fetch;
}): Promise<LeadCrmDeliveryOutcome> {
  const { serviceSupabase, workspaceId, lead } = input;
  const sourceProvider = readSourceProvider(input.attempt.request_json, lead);
  const submissionId = readSubmissionId(input.attempt.request_json, lead);
  const backfill = input.attempt.request_json.backfill === true;
  const commandId = `crm-capture:${workspaceId}:${sourceProvider}:${submissionId}`;

  const job = await ensureDeliveryJob(serviceSupabase, {
    workspaceId,
    leadId: lead.id,
    sourceProvider,
    sourceSubmissionId: submissionId,
    commandId,
    backfill,
  });

  if (job.state === "delivered") {
    return { status: "delivered", crmLead: "", commandId, backfill };
  }

  let commands: Awaited<ReturnType<typeof createWorkspaceCrm>>["commands"];
  try {
    const crm = await createWorkspaceCrm({
      supabase: serviceSupabase,
      workspaceId,
      fetchImpl: input.fetchImpl,
    });
    commands = crm.commands;
  } catch (error) {
    if (error instanceof CrmSiteNotProvisionedError) {
      await markDeliveryJob(serviceSupabase, job.id, "error", "crm_site_not_provisioned");
      return { status: "error", commandId, reason: "crm_site_not_provisioned" };
    }
    await markDeliveryJob(serviceSupabase, job.id, "pending", describeError(error));
    return { status: "pending", commandId, reason: "crm_unavailable" };
  }

  const attribution = await loadAttribution(serviceSupabase, workspaceId, lead.id);

  try {
    const result = await commands.captureEnquiry({
      commandId,
      sourceProvider,
      sourceSubmissionId: submissionId,
      firstName: splitName(lead.full_name).first,
      lastName: splitName(lead.full_name).last,
      email: lead.email,
      phone: lead.phone,
      propertyContext: lead.suburb,
      campaignId: attribution.campaignId,
      adId: attribution.adId,
      formId: attribution.formId,
      receivedAt: lead.created_at,
      captureRecordId: lead.id,
      backfill,
    });

    await markDeliveryJob(serviceSupabase, job.id, "delivered", null, result.lead);

    // A historical import never produces a first-contact reminder.
    if (!backfill) {
      await notifyNewLead({
        serviceSupabase,
        workspaceId,
        commands,
        enquiry: result.lead,
      });
    }

    return { status: "delivered", crmLead: result.lead, commandId, backfill };
  } catch (error) {
    if (isCrmError(error) && error.code === "crm_unavailable") {
      await markDeliveryJob(serviceSupabase, job.id, "pending", error.detail ?? "crm_unavailable");
      return { status: "pending", commandId, reason: "crm_unavailable" };
    }
    await markDeliveryJob(serviceSupabase, job.id, "error", describeError(error));
    return { status: "error", commandId, reason: "crm_rejected" };
  }
}

/**
 * Produce new-lead notices for a freshly delivered enquiry. Notification
 * failures never fail delivery: the enquiry already exists in the CRM.
 */
async function notifyNewLead(input: {
  serviceSupabase: SupabaseServiceClient;
  workspaceId: string;
  commands: Awaited<ReturnType<typeof createWorkspaceCrm>>["commands"];
  enquiry: string;
}) {
  try {
    const lead = await input.commands.getLead(input.enquiry);
    const recipients = await resolveNewLeadRecipients(input.serviceSupabase, {
      workspaceId: input.workspaceId,
      crmOwner: lead.owner,
      leadEmails: lead.email ? [lead.email] : [],
    });

    await produceNewLeadNotices({
      supabase: input.serviceSupabase,
      commands: input.commands,
      workspaceId: input.workspaceId,
      enquiry: input.enquiry,
      recipientProfileIds: recipients.map((recipient) => recipient.profileId),
    });
  } catch (error) {
    console.error("[lead-delivery] new-lead notice failed for " + input.enquiry, describeError(error));
  }
}

async function ensureDeliveryJob(
  serviceSupabase: SupabaseServiceClient,
  input: {
    workspaceId: string;
    leadId: string;
    sourceProvider: string;
    sourceSubmissionId: string;
    commandId: string;
    backfill: boolean;
  },
): Promise<LeadCrmDeliveryJob> {
  const { data, error } = await serviceSupabase.rpc("ensure_lead_crm_delivery_job", {
    p_workspace_id: input.workspaceId,
    p_lead_id: input.leadId,
    p_source_provider: input.sourceProvider,
    p_source_submission_id: input.sourceSubmissionId,
    p_command_id: input.commandId,
    p_backfill: input.backfill,
  });

  if (error) {
    throw new Error(`ensure_lead_crm_delivery_job failed: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.command_id) {
    throw new Error("ensure_lead_crm_delivery_job returned no delivery job.");
  }

  return {
    id: row.id as string,
    command_id: row.command_id as string,
    state: (row.state ?? "pending") as LeadCrmDeliveryJob["state"],
    backfill: row.backfill === true,
  };
}

async function markDeliveryJob(
  serviceSupabase: SupabaseServiceClient,
  jobId: string,
  state: LeadCrmDeliveryJob["state"],
  lastError: string | null,
  crmLead?: string,
) {
  const { error } = await serviceSupabase
    .from("lead_crm_delivery_jobs")
    .update({
      state,
      last_error: lastError,
      ...(crmLead ? { crm_lead: crmLead } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`lead_crm_delivery_jobs update failed: ${error.message}`);
  }
}

function readSourceProvider(request: Record<string, unknown>, lead: LeadRow): string {
  const explicit = typeof request.sourceProvider === "string" ? request.sourceProvider.trim() : "";
  if (explicit) return explicit;
  return lead.provider?.trim() || "manual";
}

/**
 * The submission id is always taken from the stored lead or the persisted
 * attempt, never from a request body, so every retry replays the original id.
 */
function readSubmissionId(request: Record<string, unknown>, lead: LeadRow): string {
  const explicit = typeof request.sourceSubmissionId === "string" ? request.sourceSubmissionId.trim() : "";
  if (explicit) return explicit;
  const external = lead.external_id?.trim();
  if (external) return external;
  return `lead:${lead.id}`;
}

function splitName(fullName: string | null): { first: string | null; last: string | null } {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

type AttributionRow = { source?: Record<string, unknown> | null; campaign_id?: string | null };

async function loadAttribution(
  serviceSupabase: SupabaseServiceClient,
  workspaceId: string,
  leadId: string,
): Promise<{ campaignId: string | null; adId: string | null; formId: string | null }> {
  const { data } = await serviceSupabase
    .from("lead_source_attribution")
    .select("campaign_id,source")
    .eq("workspace_id", workspaceId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = (data ?? null) as AttributionRow | null;
  const source = row?.source ?? {};
  return {
    campaignId: stringOrNull(row?.campaign_id ?? source.campaignId ?? source.campaign_id),
    adId: stringOrNull(source.adId ?? source.ad_id),
    formId: stringOrNull(source.formId ?? source.form_id),
  };
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function describeError(error: unknown): string {
  if (isCrmError(error)) return error.detail ?? error.code;
  return error instanceof Error ? error.message.slice(0, 300) : "unknown_error";
}

async function loadDeliveryAttempt(
  serviceSupabase: SupabaseServiceClient,
  workspaceId: string,
  attemptId: string,
): Promise<LeadDeliveryAttemptRow> {
  const { data, error } = await serviceSupabase
    .from("lead_delivery_attempts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", attemptId)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Lead delivery attempt was not found.");
  }

  return data as LeadDeliveryAttemptRow;
}

async function loadLead(serviceSupabase: SupabaseServiceClient, workspaceId: string, leadId: string): Promise<LeadRow> {
  const { data, error } = await serviceSupabase
    .from("leads")
    .select("id,email,phone,full_name,suburb,external_id,provider,created_at,raw_payload")
    .eq("workspace_id", workspaceId)
    .eq("id", leadId)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Lead was not found.");
  }

  return data as LeadRow;
}

async function loadApprovalStatus(
  serviceSupabase: SupabaseServiceClient,
  workspaceId: string,
  approvalRequestId: string,
): Promise<ApprovalStatus> {
  const { data } = await serviceSupabase
    .from("approval_requests")
    .select("status")
    .eq("workspace_id", workspaceId)
    .eq("id", approvalRequestId)
    .maybeSingle();

  return data?.status === "approved" ||
    data?.status === "rejected" ||
    data?.status === "cancelled" ||
    data?.status === "requested"
    ? data.status
    : "draft";
}

async function updateAttempt(
  serviceSupabase: SupabaseServiceClient,
  workspaceId: string,
  attemptId: string,
  status: LeadDeliveryAttemptRow["status"],
  response: Record<string, unknown>,
) {
  const { error } = await serviceSupabase
    .from("lead_delivery_attempts")
    .update({
      status,
      response_json: response,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", attemptId);

  if (error) {
    throw new Error(error.message);
  }
}

async function persistLeadDeliveryAudit(
  serviceSupabase: SupabaseServiceClient,
  attempt: Pick<
    LeadDeliveryAttemptRow,
    "id" | "workspace_id" | "lead_id" | "destination_type" | "destination_label" | "status" | "approval_request_id"
  >,
) {
  const destination = normalizeDeliveryDestination(attempt);

  await serviceSupabase.from("audit_logs").insert({
    workspace_id: attempt.workspace_id,
    actor_profile_id: null,
    action: `lead_delivery_${attempt.status}`,
    target_type: "lead_delivery_attempt",
    target_id: attempt.id,
    metadata: {
      leadId: attempt.lead_id,
      destinationType: destination.type,
      destinationLabel: destination.label,
      approvalRequestId: attempt.approval_request_id,
    },
  });
}

function normalizeDeliveryDestination(
  attempt: Pick<LeadDeliveryAttemptRow, "destination_type" | "destination_label">,
): { type: LeadDeliveryDestinationType; label: string } {
  if (attempt.destination_type !== "email") {
    return { type: attempt.destination_type, label: attempt.destination_label };
  }

  const label = attempt.destination_label.trim();
  return {
    type: "webhook",
    label: !label || /^e-?mail$/i.test(label) ? "Webhook endpoint" : label,
  };
}
