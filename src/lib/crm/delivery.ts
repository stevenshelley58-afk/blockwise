/**
 * CRM delivery state for a captured lead.
 *
 * Blockwise captures the lead; Frappe CRM owns it from then on. Between the two
 * sits exactly one durable job row per capture, created by
 * `ensure_lead_crm_delivery_job` in
 * `20260912040000_crm_workspace_sites_and_delivery.sql`.
 *
 * The row exists so that three things stay true:
 *   * a delivery that fails is retried rather than lost,
 *   * a retry replays the original `command_id` instead of minting a second
 *     enquiry in the CRM,
 *   * the customer can be told "waiting for CRM" instead of seeing a lead that
 *     silently never arrived.
 *
 * Producers do only the workspace-fenced RPCs, exactly as the provider job queue
 * does. Execution belongs to the VPS worker, which owns retries and leases.
 *
 * Server-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { enqueueQueuedJob } from "../providers/job-queue-enqueue.ts";

export const LEAD_CRM_DELIVERY_TABLE = "lead_crm_delivery_jobs";
export const LEAD_CRM_DELIVERY_KIND = "deliver.lead.crm";

/**
 * CRM delivery writes to an external system, so it is opt-in and off by default,
 * matching how provider writes are gated. Wiring can therefore ship before
 * anyone decides to start delivering.
 *
 * When this is off the producer registers nothing at all, rather than creating
 * pending rows that would show the customer a "waiting for CRM" state nothing
 * is going to resolve.
 */
export function crmDeliveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BLOCKWISE_ENABLE_CRM_DELIVERY === "true";
}

export type LeadCrmDeliveryState = "pending" | "delivered" | "error";

export type LeadCrmDeliveryJob = {
  id: string;
  workspace_id: string;
  lead_id: string;
  source_provider: string;
  source_submission_id: string;
  command_id: string;
  state: LeadCrmDeliveryState;
  backfill: boolean;
  attempts: number;
  crm_lead: string | null;
  last_error: string | null;
};

type RawDeliveryJob = Partial<LeadCrmDeliveryJob> & { id?: string | null };

/**
 * Derive the CRM command id for a capture.
 *
 * The adapter never generates a command id, because a generated one would differ
 * on every retry and the CRM would capture the same enquiry twice. Deriving it
 * from the source identity means every attempt for one submission replays the
 * same command, which is what makes the retry safe.
 */
export function crmCaptureCommandId(sourceProvider: string, sourceSubmissionId: string): string {
  return `crm-capture:${sourceProvider}:${sourceSubmissionId}`;
}

/**
 * Create or return the delivery job for one capture. Safe to call on every
 * attempt: the RPC takes an advisory lock and returns the existing row rather
 * than inserting a second one.
 */
export async function ensureLeadCrmDeliveryJob(input: {
  serviceSupabase: SupabaseClient;
  workspaceId: string;
  leadId: string;
  sourceProvider: string;
  sourceSubmissionId: string;
  commandId?: string;
  backfill?: boolean;
}): Promise<LeadCrmDeliveryJob> {
  const commandId = input.commandId ?? crmCaptureCommandId(input.sourceProvider, input.sourceSubmissionId);

  const { data, error } = await input.serviceSupabase.rpc("ensure_lead_crm_delivery_job", {
    p_workspace_id: input.workspaceId,
    p_lead_id: input.leadId,
    p_source_provider: input.sourceProvider,
    p_source_submission_id: input.sourceSubmissionId,
    p_command_id: commandId,
    p_backfill: input.backfill ?? false,
  });

  if (error) throw new Error(`ensure_lead_crm_delivery_job failed: ${error.message}`);

  const job = firstRow<RawDeliveryJob>(data);
  if (!job?.id) {
    throw new Error("ensure_lead_crm_delivery_job returned no delivery job.");
  }

  return normalizeJob(job as RawDeliveryJob & { id: string });
}

/** Read one delivery job, fenced to its workspace. */
export async function loadLeadCrmDeliveryJob(input: {
  serviceSupabase: SupabaseClient;
  workspaceId: string;
  jobId: string;
}): Promise<LeadCrmDeliveryJob | null> {
  const { data, error } = await input.serviceSupabase
    .from(LEAD_CRM_DELIVERY_TABLE)
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.jobId)
    .maybeSingle();

  if (error) throw new Error(`lead_crm_delivery_jobs lookup failed: ${error.message}`);
  return data ? normalizeJob(data as RawDeliveryJob & { id: string }) : null;
}

/**
 * Record a delivery. `crmLead` is the CRM's own lead name (for example
 * `CRM-LEAD-2026-00014`), which is what the customer-facing surface quotes back.
 */
export async function markLeadCrmDeliveryDelivered(input: {
  serviceSupabase: SupabaseClient;
  workspaceId: string;
  jobId: string;
  crmLead: string | null;
}): Promise<void> {
  await updateJob(input.serviceSupabase, input.workspaceId, input.jobId, {
    state: "delivered",
    crm_lead: input.crmLead,
    last_error: null,
  });
}

/**
 * Record a failed attempt. The message is stored for an operator, so it must
 * already be redacted: never a credential, never a raw stack trace. The state
 * stays `error` and the queue decides whether to retry, which is why a retry can
 * overwrite this with a later success.
 */
export async function markLeadCrmDeliveryError(input: {
  serviceSupabase: SupabaseClient;
  workspaceId: string;
  jobId: string;
  message: string;
}): Promise<void> {
  await updateJob(input.serviceSupabase, input.workspaceId, input.jobId, {
    state: "error",
    last_error: input.message.slice(0, 500),
  });
}

async function updateJob(
  serviceSupabase: SupabaseClient,
  workspaceId: string,
  jobId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await serviceSupabase
    .from(LEAD_CRM_DELIVERY_TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", jobId);

  if (error) throw new Error(`lead_crm_delivery_jobs update failed: ${error.message}`);
}

/**
 * Hand the job to the VPS worker. The dedupe key is the job id, so two producers
 * racing on the same capture enqueue one job, not two.
 */
export async function queueLeadCrmDelivery(input: {
  workspaceId: string;
  jobId: string;
  /** Injection point for tests; production uses the shared job queue. */
  enqueue?: typeof enqueueQueuedJob;
}) {
  const enqueue = input.enqueue ?? enqueueQueuedJob;
  return enqueue({
    workspaceId: input.workspaceId,
    kind: LEAD_CRM_DELIVERY_KIND,
    payload: { workspaceId: input.workspaceId, jobId: input.jobId },
    maxAttempts: 5,
    dedupeKey: `deliver-lead-crm:${input.workspaceId}:${input.jobId}`,
  });
}

/**
 * One lead's delivery state, as a customer-facing surface needs it.
 *
 * Deliberately not the whole job row: `last_error` is an operator detail and
 * `command_id` is an internal identity, so neither is exposed to a member. The
 * table's RLS policy already limits a member to their own workspace, so a caller
 * reading with their own client cannot see another workspace's row.
 */
export type LeadCrmDeliverySummary = {
  lead_id: string;
  state: LeadCrmDeliveryState;
  crm_lead: string | null;
};

/**
 * The label the customer sees for a lead's CRM delivery, or null when there is
 * nothing to say.
 *
 * A missing row means no delivery was ever registered for that lead. With the
 * gate off the producer registers nothing at all, so silence is the honest
 * rendering here: printing "Waiting for CRM" on every lead would promise a
 * handoff nothing is going to perform, which is the exact state this mechanism
 * exists to make visible rather than to fake. The pending label is only used
 * once a job actually exists.
 */
export function formatLeadCrmDelivery(summary: LeadCrmDeliverySummary | undefined): string | null {
  if (!summary) return null;
  if (summary.state === "delivered") {
    return summary.crm_lead ? `In CRM as ${summary.crm_lead}` : "In CRM";
  }
  if (summary.state === "error") return "CRM delivery failed";
  return "Waiting for CRM";
}

/**
 * `ensure_lead_crm_delivery_job` returns a composite row. PostgREST hands that
 * back as a one-element array or as a bare object depending on the call, so both
 * shapes are accepted rather than assuming one.
 */
function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;
  if (data && typeof data === "object") return data as T;
  return null;
}

function normalizeJob(row: RawDeliveryJob & { id: string }): LeadCrmDeliveryJob {
  const state = row.state;
  return {
    id: row.id,
    workspace_id: String(row.workspace_id ?? ""),
    lead_id: String(row.lead_id ?? ""),
    source_provider: String(row.source_provider ?? ""),
    source_submission_id: String(row.source_submission_id ?? ""),
    command_id: String(row.command_id ?? ""),
    state: state === "delivered" || state === "error" ? state : "pending",
    backfill: row.backfill === true,
    attempts: typeof row.attempts === "number" ? row.attempts : 0,
    crm_lead: row.crm_lead ?? null,
    last_error: row.last_error ?? null,
  };
}
