import { randomUUID } from "node:crypto";

import type { createSupabaseServiceClient } from "../supabase/service.ts";
import { buildLeadDedupeKey } from "../leads/dedupe.ts";
import { loadMetaPublishPlan } from "./meta-execution.ts";
import { syncMetaLeads, type LeadDeliveryAction, type MetaLeadRepository, type NormalizedMetaLead } from "./meta-leads.ts";
import { loadStoredProviderTokens } from "./provider-connections.ts";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export async function syncMetaLeadsForPlanById(input: {
  serviceSupabase: SupabaseServiceClient;
  workspaceId: string;
  planId: string;
  since?: string | null;
}) {
  const plan = await loadMetaPublishPlan(input.serviceSupabase, {
    workspaceId: input.workspaceId,
    planId: input.planId,
  });
  const tokens = await loadStoredProviderTokens(input.serviceSupabase, plan.providerConnectionId);
  const formIds = Object.values(plan.reconciledObjects.leadFormIds);

  if (!tokens.accessToken) {
    throw new Error("Meta lead sync cannot run without a stored Meta access token.");
  }

  if (formIds.length === 0) {
    return { fetched: 0, inserted: 0, duplicate: 0 };
  }

  return syncMetaLeads({
    workspaceId: input.workspaceId,
    accessToken: tokens.accessToken,
    formIds,
    leadDestination: plan.setup.leadDestination,
    repository: createSupabaseMetaLeadRepository(input.serviceSupabase, plan.legacyCampaignId),
    since: input.since,
  });
}

export function createSupabaseMetaLeadRepository(
  serviceSupabase: SupabaseServiceClient,
  campaignId: string | null,
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

    async upsertLead({ workspaceId, lead, duplicateOfLeadId }) {
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

      if (dedupeKey && !duplicateOfLeadId) {
        await serviceSupabase.from("lead_dedupe_records").insert({
          workspace_id: workspaceId,
          lead_id: leadId,
          dedupe_key: dedupeKey,
          duplicate_of_lead_id: null,
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
