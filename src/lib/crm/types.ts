/**
 * Domain types for the Frappe CRM adapter.
 *
 * Frappe CRM owns working lead, task and outcome state. These types describe
 * what the adapter reads back; Blockwise never stores an editable copy of
 * stage, owner, tasks or outcomes.
 */

export const CRM_STAGES = ["New", "Contacting", "Engaged", "Appointment booked", "Won", "Lost"] as const;
export type CrmStage = (typeof CRM_STAGES)[number];

/** Stages after which no prospecting reminder may be produced. */
export const CRM_TERMINAL_STAGES = ["Won", "Lost"] as const;
export type CrmTerminalStage = (typeof CRM_TERMINAL_STAGES)[number];

/** Real Frappe CRM Task status values. Note the single-l "Canceled". */
export const CRM_TASK_STATUSES = ["Backlog", "Todo", "In Progress", "Done", "Canceled"] as const;
export type CrmTaskStatus = (typeof CRM_TASK_STATUSES)[number];

export const CRM_OPEN_TASK_STATUSES = ["Backlog", "Todo", "In Progress"] as const;

export const CRM_TASK_PURPOSES = ["first_contact", "follow_up", "respond", "appointment", "other"] as const;
export type CrmTaskPurpose = (typeof CRM_TASK_PURPOSES)[number];

/**
 * Manual quality label. A separate axis from stage: a junk submission and a
 * genuine enquiry both start at the same stage, and only a person can tell
 * them apart, so quality is never inferred from stage or activity.
 */
export const CRM_QUALITIES = ["valid", "invalid", "high_intent"] as const;
export type CrmQuality = (typeof CRM_QUALITIES)[number];

export type CrmLead = {
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  stage: CrmStage | string;
  quality: CrmQuality | string | null;
  archived: boolean;
  owner: string | null;
  revision: number;
  sourceProvider: string | null;
  sourceSubmissionId: string | null;
  propertyContext: string | null;
  receivedAt: string | null;
  modified: string | null;
};

export type CrmLeadSummary = CrmLead & {
  nextTask: {
    name: string;
    status: CrmTaskStatus | string;
    purpose: CrmTaskPurpose | string | null;
    dueAt: string | null;
  } | null;
};

export type CrmTask = {
  name: string;
  title: string;
  status: CrmTaskStatus | string;
  priority: string | null;
  assignedTo: string | null;
  referenceDoctype: string | null;
  referenceDocname: string | null;
  purpose: CrmTaskPurpose | string | null;
  origin: string | null;
  dueAt: string | null;
  modified: string | null;
};

export type CrmActivity = {
  name: string;
  eventId: string | null;
  type: string;
  actor: string | null;
  source: string | null;
  occurredAt: string | null;
  recordedAt: string | null;
  note: string | null;
};

/**
 * A native FCRM Note. The note is the editable authority for its text; the
 * activity log records that one was added and points at it by name, so history
 * stays auditable without a second editable copy of the words.
 */
export type CrmNote = {
  name: string;
  title: string | null;
  content: string | null;
  owner: string | null;
  createdAt: string | null;
};

export type CrmCaptureResult = {
  lead: string;
  created: boolean;
  stage: CrmStage | string;
  revision: number;
};

export type CrmMutationResult = {
  lead?: string;
  task?: string;
  note?: string;
  stage?: CrmStage | string;
  quality?: CrmQuality | string | null;
  status?: CrmTaskStatus | string;
  revision?: number;
  archived?: boolean;
  assignee?: string | null;
  completedTasks?: string[];
  cancelledTasks?: string[];
  movedTasks?: string[];
  createdTask?: string | null;
  dueAt?: string | null;
  recorded?: string;
};

export function isCrmTerminalStage(stage: string | null | undefined): boolean {
  return (CRM_TERMINAL_STAGES as readonly string[]).includes(stage ?? "");
}

export function isCrmOpenTaskStatus(status: string | null | undefined): boolean {
  return (CRM_OPEN_TASK_STATUSES as readonly string[]).includes(status ?? "");
}
