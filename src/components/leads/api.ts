/**
 * Transport layer for the lead work application.
 *
 * Every mutation goes through one `send` function so there is a single place
 * that adds the idempotency key, a single place that maps a failure onto a
 * truthful message, and a single seam a test can observe. The email draft
 * helper uses the same seam, which is what lets a test prove that opening a
 * draft never issues a stage change or a task completion.
 */

import { leadsCopy } from "./copy.ts";
import type {
  LeadActivity,
  LeadDetailResponse,
  LeadListResponse,
  LeadMutationResponse,
  LeadRow,
  LeadTask,
} from "./types.ts";

export type LeadHttpMethod = "GET" | "POST" | "PATCH";

export type LeadRequest = {
  method: LeadHttpMethod;
  path: string;
  body?: unknown;
  idempotencyKey?: string;
};

export type LeadTransportResponse = { status: number; body: unknown };

export type LeadTransport = (request: LeadRequest) => Promise<LeadTransportResponse>;

export type LeadErrorCode =
  | "conflict"
  | "crm_unavailable"
  | "not_found"
  | "forbidden"
  | "unexpected"
  | "network"
  | "unknown";

export class LeadApiError extends Error {
  readonly status: number;
  readonly code: LeadErrorCode;
  readonly staleRevision: boolean;
  readonly revision: number | null;

  constructor(input: { message: string; status: number; code: LeadErrorCode; staleRevision?: boolean; revision?: number | null }) {
    super(input.message);
    this.name = "LeadApiError";
    this.status = input.status;
    this.code = input.code;
    this.staleRevision = input.staleRevision === true;
    this.revision = input.revision ?? null;
  }

  /** Read-only mode: the CRM is not answering, so nothing may be edited. */
  get blocksEditing(): boolean {
    return this.code === "crm_unavailable" || this.code === "forbidden" || this.status === 403;
  }
}

const KNOWN_CODES = new Set(["conflict", "crm_unavailable", "not_found", "forbidden", "unexpected"]);

export function newIdempotencyKey(): string {
  const random = typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : null;
  if (random) return "lead-" + random;
  return "lead-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
}

export const browserLeadTransport: LeadTransport = async (request) => {
  const headers: Record<string, string> = { accept: "application/json" };
  if (request.body !== undefined) headers["content-type"] = "application/json";
  if (request.idempotencyKey) headers["Idempotency-Key"] = request.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(request.path, {
      method: request.method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      credentials: "same-origin",
    });
  } catch {
    throw new LeadApiError({ message: "The request could not reach Blockwise.", status: 0, code: "network" });
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = null;
    }
  }
  return { status: response.status, body };
};

export type LeadListQuery = {
  search?: string;
  stage?: string;
  source?: string;
  quality?: string;
  mine?: boolean;
  unassigned?: boolean;
  followUpDue?: boolean;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
};

export type LeadActivityInput = {
  note?: string | null;
  occurredAt?: string | null;
  nextFollowUpAt?: string | null;
  expectedRevision?: number | null;
};

export type LeadTaskInput = {
  title: string;
  purpose?: string | null;
  dueAt?: string | null;
  assignee?: string | null;
};

export function createLeadApi(input: { transport: LeadTransport; workspaceId: string }) {
  const { transport, workspaceId } = input;

  async function send(request: LeadRequest): Promise<unknown> {
    const response = await transport(request);
    const body = response.body;
    if (response.status < 200 || response.status >= 300) {
      throw toError(response.status, body);
    }
    return body;
  }

  function mutate(path: string, body: unknown): Promise<LeadMutationResponse> {
    return send({ method: "POST", path, body: { ...(body as object), workspaceId }, idempotencyKey: newIdempotencyKey() }) as Promise<LeadMutationResponse>;
  }

  function leadPath(leadId: string, suffix: string): string {
    return "/api/leads/" + encodeURIComponent(leadId) + suffix;
  }

  return {
    workspaceId,
    list(query: LeadListQuery = {}): Promise<LeadListResponse> {
      const params = new URLSearchParams({ workspaceId, limit: String(query.limit ?? 100), offset: String(query.offset ?? 0) });
      if (query.search) params.set("search", query.search);
      if (query.stage) params.set("stage", query.stage);
      if (query.source) params.set("source", query.source);
      if (query.quality) params.set("quality", query.quality);
      if (query.mine) params.set("mine", "true");
      if (query.unassigned) params.set("unassigned", "true");
      if (query.followUpDue) params.set("followUpDue", "true");
      if (query.includeArchived) params.set("includeArchived", "true");
      return send({ method: "GET", path: "/api/leads?" + params.toString() }) as Promise<LeadListResponse>;
    },
    detail(leadId: string): Promise<LeadDetailResponse> {
      return send({ method: "GET", path: leadPath(leadId, "?workspaceId=" + encodeURIComponent(workspaceId)) }) as Promise<LeadDetailResponse>;
    },
    setStage(leadId: string, stage: string, expectedRevision?: number | null): Promise<LeadMutationResponse> {
      return mutate(leadPath(leadId, "/stage"), { stage, expectedRevision: expectedRevision ?? undefined });
    },
    logActivity(leadId: string, kind: "contact" | "reply", activity: LeadActivityInput = {}): Promise<LeadMutationResponse> {
      return mutate(leadPath(leadId, "/activities"), { kind, ...activity });
    },
    setAssignee(leadId: string, assignee: string, expectedRevision?: number | null): Promise<LeadMutationResponse> {
      return mutate(leadPath(leadId, "/assignee"), { assignee, expectedRevision: expectedRevision ?? undefined });
    },
    recordOutcome(leadId: string, outcome: "Won" | "Lost", reason?: string | null, expectedRevision?: number | null): Promise<LeadMutationResponse> {
      return mutate(leadPath(leadId, "/outcome"), { outcome, reason: reason ?? undefined, expectedRevision: expectedRevision ?? undefined });
    },
    archive(leadId: string, reason?: string | null, expectedRevision?: number | null): Promise<LeadMutationResponse> {
      return mutate(leadPath(leadId, "/archive"), { reason: reason ?? undefined, expectedRevision: expectedRevision ?? undefined });
    },
    reopen(leadId: string, stage: string, reason: string): Promise<LeadMutationResponse> {
      return mutate(leadPath(leadId, "/reopen"), { stage, reason });
    },
    /** Audit-only. Never marks the enquiry contacted and never completes a task. */
    recordEvent(leadId: string, type: "email_app_launch_requested" | "call_requested" | "note", note?: string | null): Promise<LeadMutationResponse> {
      return mutate(leadPath(leadId, "/events"), { type, note: note ?? undefined });
    },
    createTask(leadId: string, task: LeadTaskInput): Promise<LeadMutationResponse> {
      return mutate(leadPath(leadId, "/tasks"), task);
    },
    updateTask(taskId: string, patch: { status: "Done" } | { dueAt: string }): Promise<LeadMutationResponse> {
      return send({
        method: "PATCH",
        path: "/api/lead-tasks/" + encodeURIComponent(taskId),
        body: { ...patch, workspaceId },
        idempotencyKey: newIdempotencyKey(),
      }) as Promise<LeadMutationResponse>;
    },
  };
}

export type LeadApi = ReturnType<typeof createLeadApi>;

function toError(status: number, body: unknown): LeadApiError {
  const record = isRecord(body) ? body : {};
  const code = typeof record.code === "string" && KNOWN_CODES.has(record.code) ? (record.code as LeadErrorCode) : defaultCode(status);
  const message = typeof record.error === "string" && record.error.trim() ? record.error : fallbackMessage(code);
  return new LeadApiError({
    message,
    status,
    code,
    staleRevision: record.staleRevision === true || code === "conflict",
    revision: typeof record.revision === "number" ? record.revision : null,
  });
}

function defaultCode(status: number): LeadErrorCode {
  if (status === 409) return "conflict";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 503 || status === 502) return "crm_unavailable";
  return "unknown";
}

function fallbackMessage(code: LeadErrorCode): string {
  if (code === "conflict") return leadsCopy.states.staleReadBody;
  if (code === "crm_unavailable") return leadsCopy.states.crmUnavailableBody;
  if (code === "forbidden") return leadsCopy.states.permissionBody;
  if (code === "not_found") return leadsCopy.states.notFoundBody;
  if (code === "network") return "The request could not reach Blockwise.";
  return leadsCopy.states.saveFailedBody;
}

export type LeadErrorDescription = {
  title: string;
  body: string;
  /** True when the workspace should switch to read-only saved data. */
  readOnly: boolean;
  /** True when the change must be reverted to the confirmed position. */
  revert: boolean;
};

/** Maps a failure onto text that says what happened and what to do next. */
export function describeLeadError(error: unknown): LeadErrorDescription {
  if (!(error instanceof LeadApiError)) {
    return { title: leadsCopy.states.saveFailedTitle, body: leadsCopy.states.saveFailedBody, readOnly: false, revert: false };
  }
  if (error.code === "conflict" || error.staleRevision) {
    return { title: leadsCopy.states.conflictTitle, body: leadsCopy.states.staleReadBody, readOnly: false, revert: true };
  }
  if (error.code === "crm_unavailable") {
    return { title: leadsCopy.states.crmUnavailableTitle, body: leadsCopy.states.crmUnavailableBody, readOnly: true, revert: false };
  }
  if (error.code === "forbidden") {
    return { title: leadsCopy.states.permissionTitle, body: leadsCopy.states.permissionBody, readOnly: true, revert: false };
  }
  if (error.code === "not_found") {
    return { title: leadsCopy.states.notFoundTitle, body: leadsCopy.states.notFoundBody, readOnly: false, revert: false };
  }
  return { title: leadsCopy.states.saveFailedTitle, body: error.message || leadsCopy.states.saveFailedBody, readOnly: false, revert: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type { LeadActivity, LeadRow, LeadTask };
