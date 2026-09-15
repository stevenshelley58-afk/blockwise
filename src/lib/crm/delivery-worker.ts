/**
 * Execute one CRM delivery job: capture a Blockwise lead in its workspace's
 * Frappe site.
 *
 * Runs on the VPS worker, not in the request path, for the same reason provider
 * work does: the customer's capture must not fail or slow down because a CRM is
 * slow, and a retry must be the queue's job rather than the caller's.
 *
 * Retry safety rests on the command id stored on the job row. `capture_enquiry`
 * replays a stored result for a repeated command id, so an attempt that timed out
 * after the CRM committed does not capture the enquiry twice.
 *
 * Server-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { createWorkspaceCrm } from "./index.ts";
import { isCrmError } from "./errors.ts";
import {
  crmDeliveryEnabled,
  loadLeadCrmDeliveryJob,
  markLeadCrmDeliveryDelivered,
  markLeadCrmDeliveryError,
  type LeadCrmDeliveryJob,
} from "./delivery.ts";

export type LeadCrmDeliveryOutcome = {
  jobId: string;
  state: "delivered";
  crmLead: string;
  created: boolean;
};

type LeadRow = {
  id?: string | null;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  created_at?: string | null;
  raw_payload?: Record<string, unknown> | null;
};

export async function executeLeadCrmDeliveryJobById(input: {
  serviceSupabase: SupabaseClient;
  workspaceId: string;
  jobId: string;
  fetchImpl?: typeof fetch;
  /**
   * Injection point for tests. Production always builds the real adapter, which
   * resolves the site mapping and the vault credential from the workspace.
   */
  createCrm?: typeof createWorkspaceCrm;
}): Promise<LeadCrmDeliveryOutcome> {
  if (!crmDeliveryEnabled()) {
    throw new Error("CRM delivery is disabled by BLOCKWISE_ENABLE_CRM_DELIVERY.");
  }

  const job = await loadLeadCrmDeliveryJob({
    serviceSupabase: input.serviceSupabase,
    workspaceId: input.workspaceId,
    jobId: input.jobId,
  });

  if (!job) {
    throw new Error(`No CRM delivery job ${input.jobId} in workspace ${input.workspaceId}.`);
  }

  // Already captured. Returning early is what keeps a redelivered queue message
  // from re-running a command the CRM has already settled.
  if (job.state === "delivered" && job.crm_lead) {
    return { jobId: job.id, state: "delivered", crmLead: job.crm_lead, created: false };
  }

  try {
    const lead = await loadLead(input.serviceSupabase, input.workspaceId, job);
    const buildCrm = input.createCrm ?? createWorkspaceCrm;
    const crm = await buildCrm({
      supabase: input.serviceSupabase,
      serviceSupabase: input.serviceSupabase,
      workspaceId: input.workspaceId,
      fetchImpl: input.fetchImpl,
    });

    const { firstName, lastName } = splitName(lead?.full_name ?? null);
    const attribution = readAttribution(lead?.raw_payload ?? null);

    const result = await crm.commands.captureEnquiry({
      commandId: job.command_id,
      sourceProvider: job.source_provider,
      sourceSubmissionId: job.source_submission_id,
      firstName,
      lastName,
      email: lead?.email ?? null,
      phone: lead?.phone ?? null,
      campaignId: attribution.campaignId,
      adId: attribution.adId,
      formId: attribution.formId,
      receivedAt: lead?.created_at ?? null,
      // The Blockwise lead id is the record this capture came from, so the CRM
      // receipt points back at something a person can look up.
      captureRecordId: job.lead_id,
      backfill: job.backfill,
    });

    await markLeadCrmDeliveryDelivered({
      serviceSupabase: input.serviceSupabase,
      workspaceId: input.workspaceId,
      jobId: job.id,
      crmLead: result.lead,
    });

    return { jobId: job.id, state: "delivered", crmLead: result.lead, created: result.created };
  } catch (error) {
    // Record why, then rethrow so the queue owns the retry decision. The message
    // is a category, never a credential or a stack trace: this row is readable by
    // every workspace member.
    await markLeadCrmDeliveryError({
      serviceSupabase: input.serviceSupabase,
      workspaceId: input.workspaceId,
      jobId: job.id,
      message: redactDeliveryError(error),
    }).catch(() => undefined);

    throw error;
  }
}

async function loadLead(
  serviceSupabase: SupabaseClient,
  workspaceId: string,
  job: LeadCrmDeliveryJob,
): Promise<LeadRow | null> {
  const { data, error } = await serviceSupabase
    .from("leads")
    .select("id, full_name, email, phone, created_at, raw_payload")
    .eq("workspace_id", workspaceId)
    .eq("id", job.lead_id)
    .maybeSingle();

  if (error) throw new Error(`leads lookup failed: ${error.message}`);
  return (data ?? null) as LeadRow | null;
}

/**
 * "Ada Lovelace" becomes Ada / Lovelace. A single token stays a first name, and
 * an empty name sends neither field rather than an empty string.
 */
export function splitName(fullName: string | null): { firstName: string | null; lastName: string | null } {
  const value = (fullName ?? "").trim();
  if (!value) return { firstName: null, lastName: null };
  const [first, ...rest] = value.split(/\s+/u);
  return { firstName: first ?? null, lastName: rest.length > 0 ? rest.join(" ") : null };
}

/** Meta attribution stored on the raw payload, when the capture carried it. */
export function readAttribution(rawPayload: Record<string, unknown> | null) {
  const pick = (key: string): string | null => {
    const value = rawPayload?.[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  };
  return { campaignId: pick("campaign_id"), adId: pick("ad_id"), formId: pick("form_id") };
}

/**
 * A short, non-secret reason for a failed delivery. Adapter errors carry a
 * stable code; anything else is reduced to its class so an unexpected throw
 * cannot leak a connection string or a credential into a member-readable row.
 */
export function redactDeliveryError(error: unknown): string {
  if (isCrmError(error)) {
    return `crm:${error.code}`;
  }
  if (error instanceof Error) {
    return error.name || "error";
  }
  return "error";
}
