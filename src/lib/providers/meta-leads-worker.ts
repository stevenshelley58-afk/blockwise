import { randomUUID } from "node:crypto";

import type { createSupabaseServiceClient } from "../supabase/service.ts";
import { buildLeadDedupeKey } from "../leads/dedupe.ts";
import {
  crmDeliveryEnabled,
  ensureLeadCrmDeliveryJob,
  queueLeadCrmDelivery,
} from "../crm/delivery.ts";
import { loadMetaPublishPlan } from "./meta-execution.ts";
import { syncMetaLeads, type LeadDeliveryAction, type MetaLeadRepository, type NormalizedMetaLead } from "./meta-leads.ts";
import { assertProviderConnectionActive, loadStoredProviderTokens } from "./provider-connections.ts";
import { fireEvent, formatLeadsSummary } from "../mautic/flows.ts";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export async function syncMetaLeadsForPlanById(input: {
  serviceSupabase: SupabaseServiceClient;
  workspaceId: string;
  planId: string;
  since?: string | null;
  fetchImpl?: typeof fetch;
  fireEventImpl?: typeof fireEvent;
}) {
  const plan = await loadMetaPublishPlan(input.serviceSupabase, {
    workspaceId: input.workspaceId,
    planId: input.planId,
  });
  await assertProviderConnectionActive(input.serviceSupabase, {
    connectionId: plan.providerConnectionId,
    workspaceId: input.workspaceId,
    provider: "meta",
  });
  const tokens = await loadStoredProviderTokens(input.serviceSupabase, plan.providerConnectionId);
  const formIds = Object.values(plan.reconciledObjects.leadFormIds);

  if (!tokens.accessToken) {
    throw new Error("Meta lead sync cannot run without a stored Meta access token.");
  }

  if (formIds.length === 0) {
    return { fetched: 0, inserted: 0, duplicate: 0 };
  }

  const result = await syncMetaLeads({
    workspaceId: input.workspaceId,
    accessToken: tokens.accessToken,
    formIds,
    leadDestination: plan.setup.leadDestination,
    repository: createSupabaseMetaLeadRepository(input.serviceSupabase, plan.legacyCampaignId, input.planId),
    since: input.since,
    fetchImpl: input.fetchImpl,
  });
  await queuePendingNewLeadsEvent({
    serviceSupabase: input.serviceSupabase,
    workspaceId: input.workspaceId,
    planId: input.planId,
    campaignName: plan.campaign.name,
    fireEventImpl: input.fireEventImpl,
  });
  return result;
}

type NewLeadEventItem = Pick<NormalizedMetaLead, "externalId" | "fullName" | "suburb" | "phone">;

export async function fireNewLeadsEvent(input: {
  serviceSupabase: SupabaseServiceClient;
  workspaceId: string;
  planId: string;
  campaignName: string;
  leads: NewLeadEventItem[];
  fireEventImpl?: typeof fireEvent;
}): Promise<boolean> {
  if (input.leads.length === 0) return false;

  const { data: workspace, error } = await input.serviceSupabase
    .from("workspaces")
    .select("billing_email")
    .eq("id", input.workspaceId)
    .maybeSingle();
  if (error) throw new Error(`New-leads contact lookup failed: ${error.message}`);

  const email = (workspace as { billing_email?: string | null } | null)?.billing_email?.trim();
  if (!email) return false;

  await (input.fireEventImpl ?? fireEvent)({
    email,
    workspaceId: input.workspaceId,
    event: "new_leads",
    subjectId: `${input.planId}:${input.leads.map((lead) => lead.externalId).sort().join(",")}`,
    campaignName: input.campaignName,
    leadsCount: input.leads.length,
    leadsSummary: formatLeadsSummary(input.leads.map((lead) => ({
      name: lead.fullName,
      suburb: lead.suburb,
      phone: lead.phone,
    }))),
  });
  return true;
}

export async function queuePendingNewLeadsEvent(input: {
  serviceSupabase: SupabaseServiceClient;
  workspaceId: string;
  planId: string;
  campaignName: string;
  fireEventImpl?: typeof fireEvent;
}): Promise<boolean> {
  const { data: pendingRows, error: pendingError } = await input.serviceSupabase
    .from("meta_leads")
    .select("meta_lead_id,lead_id,mautic_batch_key")
    .eq("workspace_id", input.workspaceId)
    .eq("mautic_plan_id", input.planId)
    .is("mautic_new_leads_queued_at", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (pendingError) throw new Error(`Pending new-leads batch lookup failed: ${pendingError.message}`);

  const pending = (pendingRows ?? []) as Array<{
    meta_lead_id: string;
    lead_id: string | null;
    mautic_batch_key: string | null;
  }>;
  if (pending.length === 0) return false;
  const leadIds = pending.flatMap((row) => row.lead_id ? [row.lead_id] : []);
  const { data: leadRows, error: leadsError } = await input.serviceSupabase
    .from("leads")
    .select("id,full_name,suburb,phone")
    .eq("workspace_id", input.workspaceId)
    .in("id", leadIds);
  if (leadsError) throw new Error(`Pending new-leads details lookup failed: ${leadsError.message}`);

  const leadsById = new Map(
    ((leadRows ?? []) as Array<{ id: string; full_name: string | null; suburb: string | null; phone: string | null }>)
      .map((row) => [row.id, row] as const),
  );
  const batches = new Map<string, typeof pending>();
  for (const row of pending) {
    const batchKey = row.mautic_batch_key?.trim() || `unbatched:${row.meta_lead_id}`;
    batches.set(batchKey, [...(batches.get(batchKey) ?? []), row]);
  }

  let queuedAny = false;
  for (const batch of batches.values()) {
    const leads: NewLeadEventItem[] = batch.map((row) => {
      const lead = row.lead_id ? leadsById.get(row.lead_id) : undefined;
      return {
        externalId: row.meta_lead_id,
        fullName: lead?.full_name ?? null,
        suburb: lead?.suburb ?? null,
        phone: lead?.phone ?? null,
      };
    });

    const queued = await fireNewLeadsEvent({
      serviceSupabase: input.serviceSupabase,
      workspaceId: input.workspaceId,
      planId: input.planId,
      campaignName: input.campaignName,
      leads,
      fireEventImpl: input.fireEventImpl,
    });
    if (!queued) return queuedAny;

    const { error: markerError } = await input.serviceSupabase
      .from("meta_leads")
      .update({ mautic_new_leads_queued_at: new Date().toISOString() })
      .eq("workspace_id", input.workspaceId)
      .in("meta_lead_id", batch.map((row) => row.meta_lead_id))
      .is("mautic_new_leads_queued_at", null);
    if (markerError) throw new Error(`New-leads batch marker update failed: ${markerError.message}`);
    queuedAny = true;
  }
  return queuedAny;
}

export function createSupabaseMetaLeadRepository(
  serviceSupabase: SupabaseServiceClient,
  campaignId: string | null,
  planId: string,
): MetaLeadRepository {
  return {
    async listExistingLeads(workspaceId) {
      const { data, error } = await serviceSupabase
        .from("leads")
        .select("id,email,phone")
        .eq("workspace_id", workspaceId);

      if (error) throw new Error(error.message);

      return ((data ?? []) as Array<{ id: string; email: string | null; phone: string | null }>);
    },

    async upsertLead({ workspaceId, lead, duplicateOfLeadId, batchKey }) {
      const { data: existingMetaLead } = await serviceSupabase
        .from("meta_leads")
        .select("lead_id")
        .eq("workspace_id", workspaceId)
        .eq("meta_lead_id", lead.externalId)
        .maybeSingle();

      if (existingMetaLead?.lead_id) {
        return { leadId: existingMetaLead.lead_id as string, inserted: false };
      }

      const { data: insertedLead, error: leadError } = await serviceSupabase
        .from("leads")
        .insert({
          workspace_id: workspaceId,
          provider: "meta",
          external_id: lead.externalId,
          email: lead.email,
          phone: lead.phone,
          full_name: lead.fullName,
          suburb: lead.suburb,
          raw_payload: lead.rawPayload,
          created_at: lead.createdTime ?? new Date().toISOString(),
        })
        .select("id")
        .single();

      if (leadError || !insertedLead) {
        throw new Error(leadError?.message ?? "Unable to insert Meta lead.");
      }

      const leadId = insertedLead.id as string;
      const dedupeKey = buildLeadDedupeKey({ email: lead.email, phone: lead.phone });

      await Promise.all([
        serviceSupabase.from("meta_leads").insert({
          workspace_id: workspaceId,
          lead_id: leadId,
          meta_lead_id: lead.externalId,
          form_id: lead.formId,
          mautic_batch_key: batchKey,
          mautic_plan_id: planId,
          payload: lead.rawPayload,
          created_at: lead.createdTime ?? new Date().toISOString(),
        }),
        serviceSupabase.from("lead_source_attribution").insert({
          workspace_id: workspaceId,
          lead_id: leadId,
          campaign_id: campaignId,
          provider: "meta",
          source: {
            adId: lead.adId,
            adSetId: lead.adSetId,
            campaignId: lead.campaignId,
            formId: lead.formId,
          },
        }),
        serviceSupabase.from("lead_events").insert({
          workspace_id: workspaceId,
          lead_id: leadId,
          event_type: duplicateOfLeadId ? "duplicate_candidate" : "created_from_meta",
          metadata: { duplicateOfLeadId, dedupeKey },
        }),
      ]);

      if (dedupeKey) {
        await serviceSupabase.from("lead_dedupe_records").upsert({
          workspace_id: workspaceId,
          lead_id: leadId,
          dedupe_key: dedupeKey,
          duplicate_of_lead_id: duplicateOfLeadId ?? null,
        }, {
          onConflict: "workspace_id,lead_id",
        });
      }

      return { leadId, inserted: true };
    },

    async recordDeliveryAttempt({ workspaceId, leadId, action, status, response }) {
      await insertDeliveryAttempt(serviceSupabase, {
        workspaceId,
        leadId,
        action,
        status,
        response,
      });
    },

    async ensureCrmDelivery({ workspaceId, leadId, sourceProvider, sourceSubmissionId, backfill }) {
      // Delivery is off unless explicitly enabled. Registering nothing while it
      // is off is deliberate: a pending row would show the customer a "waiting
      // for CRM" state that nothing is going to resolve.
      if (!crmDeliveryEnabled()) return;

      // A CRM that is slow or down must never fail the capture, or block the
      // rest of the batch. The job row is durable, so a delivery missed here can
      // be picked up by a backfill instead of being lost.
      try {
        const job = await ensureLeadCrmDeliveryJob({
          serviceSupabase,
          workspaceId,
          leadId,
          sourceProvider,
          sourceSubmissionId,
          backfill,
        });
        await queueLeadCrmDelivery({ workspaceId, jobId: job.id });
      } catch (error) {
        console.error(
          `[crm-delivery] could not register CRM delivery for lead ${leadId}:`,
          error instanceof Error ? error.message : error,
        );
      }
    },
  };
}

async function insertDeliveryAttempt(
  serviceSupabase: SupabaseServiceClient,
  input: {
    workspaceId: string;
    leadId: string;
    action: LeadDeliveryAction;
    status: "queued" | "delivered" | "failed" | "manual_review";
    response?: Record<string, unknown>;
  },
) {
  const attemptId = randomUUID();
  let approvalRequestId: string | null = null;

  if (input.action.requiresApproval) {
    const { data: approval, error: approvalError } = await serviceSupabase
      .from("approval_requests")
      .insert({
        workspace_id: input.workspaceId,
        target_type: "lead_delivery_attempt",
        target_id: attemptId,
        status: "requested",
        risk_summary: `Export lead PII to ${input.action.destination}.`,
      })
      .select("id")
      .single();

    if (approvalError || !approval) {
      throw new Error(approvalError?.message ?? "Unable to create lead delivery approval request.");
    }

    approvalRequestId = approval.id as string;
  }

  const { error } = await serviceSupabase.from("lead_delivery_attempts").insert({
    id: attemptId,
    workspace_id: input.workspaceId,
    lead_id: input.leadId,
    provider: "meta",
    destination_type: input.action.type,
    destination_label: input.action.destination,
    status: input.status,
    approval_request_id: approvalRequestId,
    request_json: input.action,
    response_json: input.response ?? {},
  });

  if (error) {
    throw new Error(error.message);
  }
}
