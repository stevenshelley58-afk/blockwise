import type { createSupabaseServiceClient } from "../supabase/service.ts";
import type { ApprovalStatus } from "../publishing/readiness.ts";

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
  raw_payload: Record<string, unknown>;
};

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
    .select("id,email,phone,full_name,suburb,raw_payload")
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
