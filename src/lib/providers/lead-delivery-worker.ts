import type { createSupabaseServiceClient } from "../supabase/service.ts";
import type { ApprovalStatus } from "../campaigns/publishing.ts";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

type LeadDeliveryAttemptRow = {
  id: string;
  workspace_id: string;
  lead_id: string;
  destination_type: "webhook" | "crm" | "email" | "manual";
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
  const approvalStatus = attempt.approval_request_id
    ? await loadApprovalStatus(input.serviceSupabase, input.workspaceId, attempt.approval_request_id)
    : "approved";

  if (approvalStatus !== "approved") {
    throw new Error("Lead delivery requires an approved approval request.");
  }

  const lead = await loadLead(input.serviceSupabase, input.workspaceId, attempt.lead_id);
  const endpoint = typeof attempt.request_json.endpoint === "string" ? attempt.request_json.endpoint : null;

  if (!endpoint || attempt.destination_type === "manual") {
    await updateAttempt(input.serviceSupabase, input.workspaceId, attempt.id, "manual_review", {
      message: "No delivery endpoint configured.",
    });
    await persistLeadDeliveryAudit(input.serviceSupabase, {
      ...attempt,
      status: "manual_review",
    });

    return { status: "manual_review" as const };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deliveryType: attempt.destination_type,
      destination: attempt.destination_label,
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
  await serviceSupabase.from("audit_logs").insert({
    workspace_id: attempt.workspace_id,
    actor_profile_id: null,
    action: `lead_delivery_${attempt.status}`,
    target_type: "lead_delivery_attempt",
    target_id: attempt.id,
    metadata: {
      leadId: attempt.lead_id,
      destinationType: attempt.destination_type,
      destinationLabel: attempt.destination_label,
      approvalRequestId: attempt.approval_request_id,
    },
  });
}
