/**
 * Client-side shapes for the lead work application.
 *
 * These mirror `src/lib/leads/read-model.ts` and the `/api/leads` routes. The
 * CRM owns stage, owner, tasks and outcomes; Blockwise only adds quality,
 * duplicate and delivery facts. Nothing here is an editable second copy.
 */

export const LEAD_STAGES = ["New", "Contacting", "Engaged", "Appointment booked", "Won", "Lost"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_QUALITY_LABELS = ["high_intent", "valid", "invalid", "Unlabelled"] as const;
export type LeadQuality = (typeof LEAD_QUALITY_LABELS)[number];

export type LeadDeliveryState = "pending" | "delivered" | "error" | "none";

export type LeadNextTask = {
  id: string;
  title: string;
  status: string;
  purpose: string | null;
  dueAt: string | null;
};

export type LeadRow = {
  id: string;
  blockwiseLeadId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  stage: string;
  archived: boolean;
  owner: string | null;
  revision: number;
  source: string;
  propertyContext: string | null;
  receivedAt: string | null;
  modified: string | null;
  quality: LeadQuality;
  duplicateWarning: boolean;
  duplicateOf: string | null;
  crmDeliveryState: LeadDeliveryState;
  backfill: boolean;
  nextTask: LeadNextTask | null;
  followUpDue: boolean;
};

export type LeadTask = {
  name: string;
  title: string;
  status: string;
  priority: string | null;
  assignedTo: string | null;
  referenceDoctype: string | null;
  referenceDocname: string | null;
  purpose: string | null;
  origin: string | null;
  dueAt: string | null;
  modified: string | null;
};

export type LeadActivity = {
  name: string;
  eventId: string | null;
  type: string;
  actor: string | null;
  source: string | null;
  occurredAt: string | null;
  recordedAt: string | null;
  note: string | null;
};

export type LeadListResponse = {
  workspaceId: string;
  leads: LeadRow[];
  total: number;
  limit: number;
  offset: number;
  crmPendingCount: number;
  followUpDueCount: number;
};

export type LeadDetailResponse = {
  workspaceId: string;
  lead: LeadRow;
  tasks: LeadTask[];
  activities: LeadActivity[];
};

export type LeadMutationResponse = {
  ok: true;
  commandId: string;
  lead?: string;
  task?: string;
  stage?: string;
  status?: string;
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

export type LeadView = "action" | "all" | "pipeline" | "tasks";

export type LeadFilters = {
  search: string;
  stage: string;
  source: string;
  quality: string;
  mine: boolean;
  unassigned: boolean;
  followUpDue: boolean;
};

export const EMPTY_LEAD_FILTERS: LeadFilters = {
  search: "",
  stage: "",
  source: "",
  quality: "",
  mine: false,
  unassigned: false,
  followUpDue: false,
};

export function isLeadStage(value: string): value is LeadStage {
  return (LEAD_STAGES as readonly string[]).includes(value);
}

export function isTerminalStage(stage: string): boolean {
  return stage === "Won" || stage === "Lost";
}

export function isOpenTask(task: LeadTask): boolean {
  return task.status !== "Done" && task.status !== "Canceled";
}
