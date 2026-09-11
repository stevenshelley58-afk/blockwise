import type { SupabaseClient } from "@supabase/supabase-js";

import { deterministicUuid } from "../adstudio/id.ts";

export const META_PARTNER_REQUEST_TARGET = "meta_partner_access_request";
export const META_PARTNER_REQUEST_ACTION = "requested";
export const META_PARTNER_STATUS_ACTION = "status_changed";
/**
 * How the request was raised. `confirmation` is the current customer flow: the
 * customer shares assets in Meta and confirms it, and the operator reads the
 * asset IDs from Meta's shared-asset list. `assets` carries IDs the customer
 * typed on the retired form and is kept so those records still read correctly.
 */
export type MetaPartnerRequestType = "confirmation" | "assets";
export const META_PARTNER_REQUEST_STATUSES = [
  "requested",
  "verifying",
  "ready_for_manual_publishing",
  "needs_changes",
  "cancelled",
] as const;
export type MetaPartnerAccessRequestStatus =
  (typeof META_PARTNER_REQUEST_STATUSES)[number];
export type MetaPartnerAccessRequest = {
  requestId: string;
  workspaceId: string;
  requestType: MetaPartnerRequestType;
  /** Empty until an operator records what they verified in Meta. */
  adAccountId: string;
  pageId: string;
  instagramAccountId: string | null;
  status: MetaPartnerAccessRequestStatus;
  statusReason: string | null;
  createdAt: string;
  updatedAt: string;
};

type AuditRow = {
  id: string;
  workspace_id: string | null;
  actor_profile_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  correlation_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const META_ID_RE = /^\d{6,25}$/;

export class MetaPartnerAccessRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "MetaPartnerAccessRequestError";
    this.code = code;
    this.status = status;
  }
}

function requireUuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID_RE.test(value))
    throw new MetaPartnerAccessRequestError(
      "invalid_input",
      `${label} must be a UUID.`,
    );
  return value;
}

export function normalizeMetaId(
  value: unknown,
  kind: "account" | "page" | "instagram",
) {
  const input = typeof value === "string" ? value.trim() : "";
  const digits =
    kind === "account" && input.startsWith("act_") ? input.slice(4) : input;
  if (!META_ID_RE.test(digits)) return null;
  return kind === "account" ? `act_${digits}` : digits;
}

function statusFromRow(row: AuditRow): MetaPartnerAccessRequestStatus | null {
  const value = row.metadata?.status;
  return typeof value === "string" &&
    (META_PARTNER_REQUEST_STATUSES as readonly string[]).includes(value)
    ? (value as MetaPartnerAccessRequestStatus)
    : null;
}

function toRequest(events: AuditRow[]): MetaPartnerAccessRequest | null {
  const created = events.find(
    (row) => row.action === META_PARTNER_REQUEST_ACTION,
  );
  if (!created || !created.workspace_id) return null;
  const metadata = created.metadata ?? {};
  const statusEvent = events
    .filter((row) => row.action === META_PARTNER_STATUS_ACTION)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .at(-1);
  const status = statusEvent ? statusFromRow(statusEvent) : "requested";
  if (!status) return null;
  // The customer's confirmation carries no asset IDs, so the operator records
  // what they verified in Meta on the status event. Read the newest value from
  // either event so old typed-ID requests keep working.
  const verified = statusEvent?.metadata ?? {};
  const assetId = (key: "adAccountId" | "pageId") => {
    const value = verified[key] ?? metadata[key];
    return typeof value === "string" ? value : "";
  };
  const instagramAccountId = verified.instagramAccountId ?? metadata.instagramAccountId;
  return {
    requestId: created.correlation_id ?? created.id,
    workspaceId: created.workspace_id,
    requestType: metadata.requestType === "assets" ? "assets" : "confirmation",
    adAccountId: assetId("adAccountId"),
    pageId: assetId("pageId"),
    instagramAccountId:
      typeof instagramAccountId === "string" ? instagramAccountId : null,
    status,
    statusReason:
      statusEvent && typeof statusEvent.metadata?.reason === "string"
        ? statusEvent.metadata.reason
        : null,
    createdAt: created.created_at,
    updatedAt: statusEvent?.created_at ?? created.created_at,
  };
}

async function loadEvents(
  service: SupabaseClient,
  filters: { workspaceId?: string; requestId?: string },
) {
  let query = service
    .from("audit_logs")
    .select(
      "id,workspace_id,actor_profile_id,action,target_type,target_id,correlation_id,metadata,created_at",
    )
    .eq("target_type", META_PARTNER_REQUEST_TARGET);
  if (filters.workspaceId)
    query = query.eq("workspace_id", filters.workspaceId);
  if (filters.requestId) query = query.eq("correlation_id", filters.requestId);
  const { data, error } = await query.order("created_at", { ascending: true });
  if (error)
    throw new MetaPartnerAccessRequestError(
      "storage_error",
      "Meta partner-access requests could not be loaded.",
      500,
    );
  return (data ?? []) as AuditRow[];
}

export async function createMetaPartnerAccessRequest(input: {
  serviceSupabase: SupabaseClient;
  workspaceId: string;
  actorProfileId: string;
  mutationId: string;
  requestType?: unknown;
  adAccountId?: unknown;
  pageId?: unknown;
  instagramAccountId?: unknown;
}) {
  const workspaceId = requireUuid(input.workspaceId, "workspaceId");
  const actorProfileId = requireUuid(input.actorProfileId, "actorProfileId");
  const mutationId = requireUuid(input.mutationId, "mutationId");
  // A confirmation is the whole request: the customer has already shared the
  // assets in Meta and the operator reads the IDs from Meta's shared list.
  // Anything else still has to name the assets it is about.
  const requestType: MetaPartnerRequestType =
    input.requestType === "assets" ? "assets" : "confirmation";
  const adAccountId =
    requestType === "assets" ? normalizeMetaId(input.adAccountId, "account") : null;
  const pageId =
    requestType === "assets" ? normalizeMetaId(input.pageId, "page") : null;
  const instagramAccountId =
    requestType === "assets" &&
    input.instagramAccountId != null &&
    input.instagramAccountId !== ""
      ? normalizeMetaId(input.instagramAccountId, "instagram")
      : null;
  if (
    requestType === "assets" &&
    (!adAccountId ||
      !pageId ||
      (input.instagramAccountId && !instagramAccountId))
  )
    throw new MetaPartnerAccessRequestError(
      "invalid_input",
      "Enter a valid numeric ad account ID and Page ID. The optional Instagram ID must also be numeric.",
    );

  const existing = toRequest(
    await loadEvents(input.serviceSupabase, { requestId: mutationId }),
  );
  if (existing) {
    if (
      existing.workspaceId !== workspaceId ||
      existing.requestType !== requestType ||
      existing.adAccountId !== (adAccountId ?? "") ||
      existing.pageId !== (pageId ?? "") ||
      existing.instagramAccountId !== instagramAccountId
    )
      throw new MetaPartnerAccessRequestError(
        "idempotency_conflict",
        "This request ID is already used for different Meta assets.",
        409,
      );
    return existing;
  }

  const { error } = await input.serviceSupabase.from("audit_logs").insert({
    id: mutationId,
    workspace_id: workspaceId,
    actor_profile_id: actorProfileId,
    action: META_PARTNER_REQUEST_ACTION,
    target_type: META_PARTNER_REQUEST_TARGET,
    target_id: workspaceId,
    correlation_id: mutationId,
    metadata: {
      requestType,
      status: "requested",
      adAccountId,
      pageId,
      instagramAccountId,
    },
  });
  if (error && error.code !== "23505")
    throw new MetaPartnerAccessRequestError(
      "storage_error",
      "The Meta partner-access request could not be recorded.",
      500,
    );
  const request = toRequest(
    await loadEvents(input.serviceSupabase, { requestId: mutationId }),
  );
  if (!request)
    throw new MetaPartnerAccessRequestError(
      "storage_error",
      "The Meta partner-access request could not be loaded after saving.",
      500,
    );
  return request;
}

export async function getMetaPartnerAccessRequest(
  serviceSupabase: SupabaseClient,
  requestId: string,
) {
  return toRequest(
    await loadEvents(serviceSupabase, {
      requestId: requireUuid(requestId, "requestId"),
    }),
  );
}

export async function listMetaPartnerAccessRequestsForWorkspace(
  serviceSupabase: SupabaseClient,
  workspaceId: string,
) {
  const events = await loadEvents(serviceSupabase, {
    workspaceId: requireUuid(workspaceId, "workspaceId"),
  });
  const groups = new Map<string, AuditRow[]>();
  for (const event of events) {
    const key = event.correlation_id ?? event.id;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...groups.values()]
    .map(toRequest)
    .filter((request): request is MetaPartnerAccessRequest => Boolean(request))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getLatestMetaPartnerAccessRequest(
  serviceSupabase: SupabaseClient,
  workspaceId: string,
) {
  return (
    (
      await listMetaPartnerAccessRequestsForWorkspace(
        serviceSupabase,
        workspaceId,
      )
    )[0] ?? null
  );
}

export function allowedMetaPartnerAccessTransition(
  from: MetaPartnerAccessRequestStatus,
  to: MetaPartnerAccessRequestStatus,
) {
  if (from === "requested")
    return ["verifying", "needs_changes", "cancelled"].includes(to);
  if (from === "verifying")
    return [
      "ready_for_manual_publishing",
      "needs_changes",
      "cancelled",
    ].includes(to);
  if (from === "needs_changes") return ["verifying", "cancelled"].includes(to);
  if (from === "ready_for_manual_publishing") return to === "cancelled";
  return false;
}

export async function updateMetaPartnerAccessStatus(input: {
  serviceSupabase: SupabaseClient;
  requestId: string;
  status: MetaPartnerAccessRequestStatus;
  reason: string;
  actorProfileId: string;
  /**
   * The asset IDs the operator found on Meta's shared-asset list. Required to
   * mark a confirmation-only request ready, because that request carries none.
   */
  verified?: {
    adAccountId?: unknown;
    pageId?: unknown;
    instagramAccountId?: unknown;
  };
}) {
  const requestId = requireUuid(input.requestId, "requestId");
  const actorProfileId = requireUuid(input.actorProfileId, "actorProfileId");
  const reason = input.reason.trim();
  if (!reason || reason.length > 1000)
    throw new MetaPartnerAccessRequestError(
      "invalid_input",
      "A reason between 1 and 1,000 characters is required.",
    );
  const current = await getMetaPartnerAccessRequest(
    input.serviceSupabase,
    requestId,
  );
  if (!current)
    throw new MetaPartnerAccessRequestError(
      "not_found",
      "Partner-access request was not found.",
      404,
    );
  if (current.status === input.status) return current;
  if (!allowedMetaPartnerAccessTransition(current.status, input.status))
    throw new MetaPartnerAccessRequestError(
      "invalid_transition",
      `Cannot change the request from ${current.status} to ${input.status}.`,
      409,
    );

  const adAccountId =
    normalizeMetaId(input.verified?.adAccountId, "account") ??
    (current.adAccountId || null);
  const pageId =
    normalizeMetaId(input.verified?.pageId, "page") ?? (current.pageId || null);
  const instagramAccountId =
    input.verified?.instagramAccountId == null ||
    input.verified?.instagramAccountId === ""
      ? current.instagramAccountId
      : normalizeMetaId(input.verified.instagramAccountId, "instagram");
  if (
    input.status === "ready_for_manual_publishing" &&
    (!adAccountId || !pageId)
  )
    throw new MetaPartnerAccessRequestError(
      "invalid_input",
      "Record the ad account ID and Page ID you verified in Meta before marking this ready.",
    );

  const transitionId = deterministicUuid(
    `meta_partner_access_transition:${requestId}:${current.updatedAt}:${input.status}`,
  );
  const { error } = await input.serviceSupabase.from("audit_logs").insert({
    id: transitionId,
    workspace_id: current.workspaceId,
    actor_profile_id: actorProfileId,
    action: META_PARTNER_STATUS_ACTION,
    target_type: META_PARTNER_REQUEST_TARGET,
    target_id: current.workspaceId,
    correlation_id: requestId,
    metadata: {
      requestType: "meta_partner_access",
      status: input.status,
      reason,
      adAccountId,
      pageId,
      instagramAccountId,
    },
  });
  if (error && error.code !== "23505")
    throw new MetaPartnerAccessRequestError(
      "storage_error",
      "The partner-access request status could not be recorded.",
      500,
    );
  const updated = await getMetaPartnerAccessRequest(
    input.serviceSupabase,
    requestId,
  );
  if (!updated || updated.status !== input.status)
    throw new MetaPartnerAccessRequestError(
      "status_race",
      "The request changed while it was being updated. Reload and try again.",
      409,
    );
  return updated;
}
