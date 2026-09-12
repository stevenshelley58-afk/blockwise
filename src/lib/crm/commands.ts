/**
 * Typed CRM command surface.
 *
 * Every mutation carries a caller-supplied `commandId`. The adapter never
 * generates one: command ids are derived from the idempotency key or the
 * original source submission id so a retry replays the stored result instead
 * of mutating twice.
 */

import type { CrmClient } from "./client.ts";
import type {
  CrmActivity,
  CrmCaptureResult,
  CrmLead,
  CrmLeadSummary,
  CrmMutationResult,
  CrmStage,
  CrmTask,
  CrmTaskPurpose,
} from "./types.ts";

const API = "blockwise_crm.api";

export type CrmActor = { actor?: string | null };

export type CaptureEnquiryInput = CrmActor & {
  commandId: string;
  sourceProvider: string;
  sourceSubmissionId: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  assignee?: string | null;
  campaignId?: string | null;
  adId?: string | null;
  formId?: string | null;
  receivedAt?: string | null;
  captureRecordId?: string | null;
  propertyContext?: string | null;
  /**
   * Historical import. The CRM records it on the capture receipt; Blockwise
   * suppresses first-contact notifications and every follow-up notice for a
   * backfilled enquiry.
   */
  backfill?: boolean;
};

export type LeadCommandInput = CrmActor & {
  commandId: string;
  lead: string;
  expectedRevision?: number | null;
};

export type LogContactInput = LeadCommandInput & {
  note?: string | null;
  occurredAt?: string | null;
  nextFollowUpAt?: string | null;
  eventId?: string | null;
};

export type LogReplyInput = LeadCommandInput & { note?: string | null; occurredAt?: string | null; eventId?: string | null };
export type BookAppointmentInput = LeadCommandInput & { appointmentAt: string; note?: string | null; occurredAt?: string | null; eventId?: string | null };
export type MarkOutcomeInput = LeadCommandInput & { outcome: "Won" | "Lost"; reason?: string | null };
export type SetStageInput = LeadCommandInput & { stage: CrmStage };
export type CreateTaskInput = CrmActor & {
  commandId: string;
  lead: string;
  title: string;
  purpose?: CrmTaskPurpose | string;
  dueAt?: string | null;
  assignee?: string | null;
};
export type TaskCommandInput = CrmActor & { commandId: string; task: string };
export type SnoozeTaskInput = TaskCommandInput & { dueAt: string };
export type ReassignInput = LeadCommandInput & { assignee: string };
export type ArchiveInput = LeadCommandInput & { reason?: string | null };
export type ReopenInput = LeadCommandInput & { stage: CrmStage; reason: string };
export type RecordEventInput = CrmActor & {
  commandId: string;
  lead: string;
  type: "email_app_launch_requested" | "call_requested" | "note";
  note?: string | null;
  eventId?: string | null;
};

export type ListLeadsInput = {
  includeArchived?: boolean;
  owner?: string | null;
  stage?: string | null;
  limit?: number;
  offset?: number;
};

export type ListTasksInput = { owner?: string | null; status?: string | null; limit?: number; offset?: number };

export interface CrmCommands {
  readonly workspaceId: string;
  readonly site: string;
  captureEnquiry(input: CaptureEnquiryInput): Promise<CrmCaptureResult>;
  logContact(input: LogContactInput): Promise<CrmMutationResult>;
  logReply(input: LogReplyInput): Promise<CrmMutationResult>;
  bookAppointment(input: BookAppointmentInput): Promise<CrmMutationResult>;
  markOutcome(input: MarkOutcomeInput): Promise<CrmMutationResult>;
  setStage(input: SetStageInput): Promise<CrmMutationResult>;
  createTask(input: CreateTaskInput): Promise<CrmMutationResult>;
  completeTask(input: TaskCommandInput): Promise<CrmMutationResult>;
  snoozeTask(input: SnoozeTaskInput): Promise<CrmMutationResult>;
  reassign(input: ReassignInput): Promise<CrmMutationResult>;
  archive(input: ArchiveInput): Promise<CrmMutationResult>;
  reopen(input: ReopenInput): Promise<CrmMutationResult>;
  recordEvent(input: RecordEventInput): Promise<CrmMutationResult>;
  getLead(lead: string): Promise<CrmLead>;
  listLeads(input?: ListLeadsInput): Promise<CrmLeadSummary[]>;
  listTasks(input?: ListTasksInput): Promise<CrmTask[]>;
  listActivities(lead: string, limit?: number): Promise<CrmActivity[]>;
  health(): Promise<{ ok: boolean; site: string | null }>;
}

export function createCrmCommands(client: CrmClient, workspaceId: string): CrmCommands {
  const scope = { workspace_id: workspaceId };

  function command(input: { commandId: string; actor?: string | null }, extra: Record<string, unknown> = {}) {
    if (!input.commandId?.trim()) {
      throw new Error("A CRM command requires a command_id.");
    }
    return {
      ...scope,
      ...extra,
      command_id: input.commandId,
      ...(input.actor ? { actor: input.actor } : {}),
    };
  }

  return {
    workspaceId,
    site: client.site,

    async captureEnquiry(input) {
      const payload = command(input, {
        source_provider: input.sourceProvider,
        source_submission_id: input.sourceSubmissionId,
        first_name: input.firstName ?? null,
        last_name: input.lastName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        assignee: input.assignee ?? null,
        campaign_id: input.campaignId ?? null,
        ad_id: input.adId ?? null,
        form_id: input.formId ?? null,
        received_at: input.receivedAt ?? null,
        capture_record_id: input.captureRecordId ?? null,
        property_context: input.propertyContext ?? null,
        backfill: input.backfill === true,
      });
      const result = await client.call<Record<string, unknown>>(`${API}.capture_enquiry`, payload);
      return {
        lead: String(result.lead ?? ""),
        created: result.created === true,
        stage: String(result.stage ?? "New"),
        revision: Number(result.revision ?? 0),
      } satisfies CrmCaptureResult;
    },

    async logContact(input) {
      return client.call<CrmMutationResult>(
        `${API}.log_contact`,
        command(input, {
          lead: input.lead,
          expected_revision: input.expectedRevision ?? null,
          note: input.note ?? null,
          occurred_at: input.occurredAt ?? null,
          next_follow_up_at: input.nextFollowUpAt ?? null,
          event_id: input.eventId ?? null,
        }),
      );
    },

    async logReply(input) {
      return client.call<CrmMutationResult>(
        `${API}.log_reply`,
        command(input, {
          lead: input.lead,
          expected_revision: input.expectedRevision ?? null,
          note: input.note ?? null,
          occurred_at: input.occurredAt ?? null,
          event_id: input.eventId ?? null,
        }),
      );
    },

    async bookAppointment(input) {
      return client.call<CrmMutationResult>(
        `${API}.book_appointment`,
        command(input, {
          lead: input.lead,
          expected_revision: input.expectedRevision ?? null,
          appointment_at: input.appointmentAt,
          note: input.note ?? null,
          occurred_at: input.occurredAt ?? null,
          event_id: input.eventId ?? null,
        }),
      );
    },

    async markOutcome(input) {
      return client.call<CrmMutationResult>(
        `${API}.mark_outcome`,
        command(input, {
          lead: input.lead,
          expected_revision: input.expectedRevision ?? null,
          outcome: input.outcome,
          reason: input.reason ?? null,
        }),
      );
    },

    async setStage(input) {
      return client.call<CrmMutationResult>(
        `${API}.set_stage`,
        command(input, {
          lead: input.lead,
          expected_revision: input.expectedRevision ?? null,
          stage: input.stage,
        }),
      );
    },

    async createTask(input) {
      return client.call<CrmMutationResult>(
        `${API}.create_task`,
        command(input, {
          lead: input.lead,
          title: input.title,
          purpose: input.purpose ?? "other",
          due_at: input.dueAt ?? null,
          assignee: input.assignee ?? null,
        }),
      );
    },

    async completeTask(input) {
      return client.call<CrmMutationResult>(`${API}.complete_task`, command(input, { task: input.task }));
    },

    async snoozeTask(input) {
      return client.call<CrmMutationResult>(
        `${API}.snooze_task`,
        command(input, { task: input.task, due_at: input.dueAt }),
      );
    },

    async reassign(input) {
      return client.call<CrmMutationResult>(
        `${API}.reassign`,
        command(input, {
          lead: input.lead,
          expected_revision: input.expectedRevision ?? null,
          assignee: input.assignee,
        }),
      );
    },

    async archive(input) {
      return client.call<CrmMutationResult>(
        `${API}.archive`,
        command(input, { lead: input.lead, expected_revision: input.expectedRevision ?? null }),
      );
    },

    async reopen(input) {
      return client.call<CrmMutationResult>(
        `${API}.reopen`,
        command(input, { lead: input.lead, stage: input.stage, reason: input.reason }),
      );
    },

    async recordEvent(input) {
      return client.call<CrmMutationResult>(
        `${API}.record_event`,
        command(input, {
          lead: input.lead,
          type: input.type,
          note: input.note ?? null,
          event_id: input.eventId ?? null,
        }),
      );
    },

    async getLead(lead) {
      const result = await client.read<Record<string, unknown>>(`${API}.get_lead`, { ...scope, lead });
      return mapLead(result);
    },

    async listLeads(input = {}) {
      const result = await client.read<{ leads?: Record<string, unknown>[] }>(`${API}.list_leads`, {
        ...scope,
        include_archived: input.includeArchived ? 1 : 0,
        owner: input.owner ?? null,
        stage: input.stage ?? null,
        limit: input.limit ?? 100,
        offset: input.offset ?? 0,
      });
      return (result.leads ?? []).map((row) => ({ ...mapLead(row), nextTask: mapNextTask(row.next_task) }));
    },

    async listTasks(input = {}) {
      const result = await client.read<{ tasks?: Record<string, unknown>[] }>(`${API}.list_tasks`, {
        ...scope,
        owner: input.owner ?? null,
        status: input.status ?? null,
        limit: input.limit ?? 200,
        offset: input.offset ?? 0,
      });
      return (result.tasks ?? []).map(mapTask);
    },

    async listActivities(lead, limit = 100) {
      const result = await client.read<{ activities?: Record<string, unknown>[] }>(`${API}.list_activities`, {
        ...scope,
        lead,
        limit,
      });
      return (result.activities ?? []).map(mapActivity);
    },

    async health() {
      const result = await client.call<{ ok?: boolean; site?: string | null }>(`${API}.health`, { ...scope });
      return { ok: result.ok === true, site: result.site ?? null };
    },
  };
}

function mapLead(row: Record<string, unknown>): CrmLead {
  return {
    name: String(row.name ?? ""),
    firstName: nullableString(row.first_name),
    lastName: nullableString(row.last_name),
    email: nullableString(row.email),
    phone: nullableString(row.mobile_no ?? row.phone),
    stage: String(row.blockwise_stage ?? row.stage ?? "New"),
    archived: row.blockwise_archived === 1 || row.blockwise_archived === true || row.archived === true,
    owner: nullableString(row.lead_owner ?? row.owner),
    revision: Number(row.blockwise_revision ?? row.revision ?? 0),
    sourceProvider: nullableString(row.blockwise_source_provider ?? row.source_provider),
    sourceSubmissionId: nullableString(row.blockwise_source_submission_id ?? row.source_submission_id),
    propertyContext: nullableString(row.blockwise_property_context ?? row.property_context),
    receivedAt: nullableString(row.received_at),
    modified: nullableString(row.modified),
  };
}

function mapTask(row: Record<string, unknown>): CrmTask {
  return {
    name: String(row.name ?? ""),
    title: nullableString(row.title) ?? "",
    status: String(row.status ?? ""),
    priority: nullableString(row.priority),
    assignedTo: nullableString(row.assigned_to),
    referenceDoctype: nullableString(row.reference_doctype),
    referenceDocname: nullableString(row.reference_docname),
    purpose: nullableString(row.blockwise_purpose),
    origin: nullableString(row.blockwise_origin),
    dueAt: nullableString(row.blockwise_due_at),
    modified: nullableString(row.modified),
  };
}

function mapActivity(row: Record<string, unknown>): CrmActivity {
  return {
    name: String(row.name ?? ""),
    eventId: nullableString(row.event_id),
    type: String(row.type ?? ""),
    actor: nullableString(row.actor),
    source: nullableString(row.source),
    occurredAt: nullableString(row.occurred_at),
    recordedAt: nullableString(row.recorded_at),
    note: nullableString(row.note),
  };
}

function mapNextTask(value: unknown): CrmLeadSummary["nextTask"] {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!row.name) return null;
  return {
    name: String(row.name),
    status: String(row.status ?? ""),
    purpose: nullableString(row.purpose),
    dueAt: nullableString(row.due_at),
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value ? value : value === null || value === undefined ? null : String(value);
}
