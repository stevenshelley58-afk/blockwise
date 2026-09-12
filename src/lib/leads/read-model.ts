/**
 * Read model for the lead list and detail.
 *
 * Frappe owns stage, owner, tasks and outcomes. Blockwise contributes only the
 * facts it owns: quality labels, duplicate warnings and CRM delivery state.
 * The merge never writes back to the CRM.
 */

import {
  isCrmTerminalStage,
  type CrmLeadSummary,
  type CrmTask,
  type CrmActivity,
} from "../crm/types.ts";

export type LeadQualityLabel = "high_intent" | "valid" | "invalid" | "Unlabelled";

export type LeadDeliveryState = "pending" | "delivered" | "error" | "none";

export type LeadQualityRow = { lead_id?: string | null; label?: string | null };
export type LeadDuplicateRow = { lead_id?: string | null; duplicate_of_lead_id?: string | null };
export type LeadDeliveryRow = {
  lead_id?: string | null;
  crm_lead?: string | null;
  state?: string | null;
  backfill?: boolean | null;
};

export type LeadListRow = {
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
  /** Blockwise-owned. */
  quality: LeadQualityLabel;
  duplicateWarning: boolean;
  duplicateOf: string | null;
  /** Blockwise-owned: separate from the sales stage and from email delivery. */
  crmDeliveryState: LeadDeliveryState;
  backfill: boolean;
  nextTask: { id: string; title: string; status: string; purpose: string | null; dueAt: string | null } | null;
  followUpDue: boolean;
};

export type LeadDetail = LeadListRow & {
  tasks: CrmTask[];
  activities: CrmActivity[];
};

export type LeadListFilters = {
  search?: string | null;
  stage?: string | null;
  owner?: string | null;
  /** Restrict to enquiries owned by the signed-in member. */
  mine?: boolean;
  unassigned?: boolean;
  followUpDue?: boolean;
  source?: string | null;
  quality?: LeadQualityLabel | null;
  includeArchived?: boolean;
  /** CRM identity of the signed-in member, required when mine is true. */
  currentOwner?: string | null;
};

export function mergeLeadRows(input: {
  leads: CrmLeadSummary[];
  quality?: LeadQualityRow[];
  duplicates?: LeadDuplicateRow[];
  delivery?: LeadDeliveryRow[];
  tasks?: CrmTask[];
  currentOwner?: string | null;
  now?: Date;
}): LeadListRow[] {
  const deliveryByCrmLead = new Map<string, LeadDeliveryRow>();
  for (const row of input.delivery ?? []) {
    if (row.crm_lead) deliveryByCrmLead.set(row.crm_lead, row);
  }

  const qualityByLead = new Map<string, string>();
  for (const row of input.quality ?? []) {
    if (row.lead_id && row.label) qualityByLead.set(row.lead_id, row.label);
  }

  const duplicateByLead = new Map<string, string | null>();
  for (const row of input.duplicates ?? []) {
    if (row.lead_id) duplicateByLead.set(row.lead_id, row.duplicate_of_lead_id ?? null);
  }

  const tasksByEnquiry = new Map<string, CrmTask[]>();
  for (const task of input.tasks ?? []) {
    const enquiry = task.referenceDocname;
    if (!enquiry) continue;
    const list = tasksByEnquiry.get(enquiry) ?? [];
    list.push(task);
    tasksByEnquiry.set(enquiry, list);
  }

  const nowMs = (input.now ?? new Date()).getTime();

  return input.leads.map((lead) => {
    const delivery = deliveryByCrmLead.get(lead.name) ?? null;
    const blockwiseLeadId = delivery?.lead_id ?? null;
    const tasks = tasksByEnquiry.get(lead.name) ?? [];
    const nextTask = pickNextTask(tasks, lead.nextTask?.name ?? null);
    const dueAtMs = nextTask?.dueAt ? Date.parse(nextTask.dueAt) : Number.NaN;

    return {
      id: lead.name,
      blockwiseLeadId,
      name: [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() || "Unknown enquiry",
      email: lead.email,
      phone: lead.phone,
      stage: lead.stage,
      archived: lead.archived,
      owner: lead.owner,
      revision: lead.revision,
      source: sourceLabel(lead.sourceProvider),
      propertyContext: lead.propertyContext,
      receivedAt: lead.receivedAt,
      modified: lead.modified,
      quality: normalizeQuality(blockwiseLeadId ? qualityByLead.get(blockwiseLeadId) : undefined),
      duplicateWarning: blockwiseLeadId ? (duplicateByLead.get(blockwiseLeadId) ?? null) !== null : false,
      duplicateOf: blockwiseLeadId ? (duplicateByLead.get(blockwiseLeadId) ?? null) : null,
      crmDeliveryState: normalizeDeliveryState(delivery?.state),
      backfill: delivery?.backfill === true,
      nextTask,
      followUpDue:
        !isCrmTerminalStage(lead.stage) &&
        !lead.archived &&
        Boolean(nextTask) &&
        Number.isFinite(dueAtMs) &&
        dueAtMs <= nowMs,
    };
  });
}

export function applyLeadFilters(rows: LeadListRow[], filters: LeadListFilters): LeadListRow[] {
  const search = filters.search?.trim().toLowerCase() ?? "";
  const owner = filters.owner?.trim() ?? "";
  const source = filters.source?.trim().toLowerCase() ?? "";

  return rows.filter((row) => {
    if (!filters.includeArchived && row.archived) return false;
    if (filters.stage && row.stage !== filters.stage) return false;
    if (filters.quality && row.quality !== filters.quality) return false;
    if (filters.unassigned === true && row.owner) return false;
    if (filters.unassigned === false && !row.owner) return false;
    if (filters.mine === true && (!ownerMatches(row.owner, filters.currentOwner ?? null) )) return false;
    if (filters.followUpDue === true && !row.followUpDue) return false;
    if (owner && !ownerMatches(row.owner, owner)) return false;
    if (source && !row.source.toLowerCase().includes(source)) return false;
    if (search) {
      const haystack = [row.name, row.email, row.phone, row.propertyContext].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

function ownerMatches(rowOwner: string | null, expected: string | null): boolean {
  if (!expected) return false;
  return (rowOwner ?? "").trim().toLowerCase() === expected.trim().toLowerCase();
}

function pickNextTask(
  tasks: CrmTask[],
  preferredName: string | null,
): LeadListRow["nextTask"] {
  if (tasks.length === 0) return null;
  const open = tasks
    .filter((task) => task.status !== "Done" && task.status !== "Canceled")
    .sort((a, b) => (Date.parse(a.dueAt ?? "") || 0) - (Date.parse(b.dueAt ?? "") || 0));
  const chosen = (preferredName ? open.find((task) => task.name === preferredName) : undefined) ?? open[0];
  if (!chosen) return null;
  return {
    id: chosen.name,
    title: chosen.title,
    status: chosen.status,
    purpose: chosen.purpose,
    dueAt: chosen.dueAt,
  };
}

function normalizeQuality(label: string | undefined): LeadQualityLabel {
  const normalized = (label ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "high_intent" || normalized === "valid" || normalized === "invalid") return normalized;
  return "Unlabelled";
}

function normalizeDeliveryState(state: string | null | undefined): LeadDeliveryState {
  if (state === "pending" || state === "delivered" || state === "error") return state;
  return "none";
}

function sourceLabel(provider: string | null): string {
  if (provider === "meta") return "Meta lead form";
  if (provider === "google") return "Google lead form";
  if (provider === "manual") return "Manual entry";
  return provider ? provider : "Unknown source";
}
