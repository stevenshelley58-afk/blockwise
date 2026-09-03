import type { SupabaseClient } from "@supabase/supabase-js";

import { deterministicUuid } from "./id.ts";

export const MANUAL_REQUEST_TARGET = "adstudio_manual_meta_publish";
export const MANUAL_REQUEST_ACTION = "requested";
export const MANUAL_STATUS_ACTION = "status_changed";
export const MANUAL_STATUSES = ["requested", "in_progress", "completed", "cancelled"] as const;
export type ManualPublishStatus = (typeof MANUAL_STATUSES)[number];

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

export type ManualPublishRequest = {
  requestId: string;
  mutationId: string;
  workspaceId: string;
  adId: string;
  adName: string | null;
  revisionId: string;
  revisionNumber: number;
  documentHash: string;
  feedPngPath: string | null;
  storyPngPath: string | null;
  notes: string | null;
  publishSummary: Record<string, unknown>;
  publishControls: Record<string, unknown>;
  status: ManualPublishStatus;
  statusReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export class ManualPublishError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ManualPublishError";
    this.code = code;
    this.status = status;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) throw new ManualPublishError("invalid_input", `${label} must be a UUID.`);
  return value;
}

function requirePlainObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ManualPublishError("invalid_input", `${label} must be a JSON object.`);
  let serialized: string;
  try { serialized = JSON.stringify(value); } catch { throw new ManualPublishError("invalid_input", `${label} must be valid JSON.`); }
  if (serialized.length > 32_000) throw new ManualPublishError("invalid_input", `${label} is too large.`);
  return value as Record<string, unknown>;
}

function statusFromMetadata(row: AuditRow): ManualPublishStatus | null {
  const value = row.metadata?.status;
  return typeof value === "string" && (MANUAL_STATUSES as readonly string[]).includes(value) ? value as ManualPublishStatus : null;
}

function toRequest(events: AuditRow[]): ManualPublishRequest | null {
  const created = events.find((row) => row.action === MANUAL_REQUEST_ACTION);
  if (!created) return null;
  const metadata = created.metadata ?? {};
  const statusEvent = events.filter((row) => row.action === MANUAL_STATUS_ACTION).sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1);
  const status = statusEvent ? statusFromMetadata(statusEvent) : "requested";
  if (!status) return null;
  return {
    requestId: created.correlation_id ?? created.id,
    mutationId: created.correlation_id ?? created.id,
    workspaceId: created.workspace_id ?? "",
    adId: String(metadata.adId ?? created.target_id ?? ""),
    adName: typeof metadata.adName === "string" ? metadata.adName : null,
    revisionId: String(metadata.revisionId ?? ""),
    revisionNumber: Number(metadata.revisionNumber ?? 0),
    documentHash: String(metadata.documentHash ?? ""),
    feedPngPath: typeof metadata.feedPngPath === "string" ? metadata.feedPngPath : null,
    storyPngPath: typeof metadata.storyPngPath === "string" ? metadata.storyPngPath : null,
    notes: typeof metadata.notes === "string" ? metadata.notes : null,
    publishSummary: metadata.publishSummary && typeof metadata.publishSummary === "object" && !Array.isArray(metadata.publishSummary) ? metadata.publishSummary as Record<string, unknown> : {},
    publishControls: metadata.publishControls && typeof metadata.publishControls === "object" && !Array.isArray(metadata.publishControls) ? metadata.publishControls as Record<string, unknown> : {},
    status,
    statusReason: statusEvent && typeof statusEvent.metadata?.reason === "string" ? statusEvent.metadata.reason : null,
    createdAt: created.created_at,
    updatedAt: statusEvent?.created_at ?? created.created_at,
  };
}

async function loadEvents(service: SupabaseClient, filters: { workspaceId?: string; mutationId?: string; adId?: string }) {
  let query = service.from("audit_logs").select("id,workspace_id,actor_profile_id,action,target_type,target_id,correlation_id,metadata,created_at").eq("target_type", MANUAL_REQUEST_TARGET);
  if (filters.workspaceId) query = query.eq("workspace_id", filters.workspaceId);
  if (filters.mutationId) query = query.eq("correlation_id", filters.mutationId);
  if (filters.adId) query = query.eq("target_id", filters.adId);
  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) throw new ManualPublishError("storage_error", "Manual publishing requests could not be loaded.", 500);
  return (data ?? []) as AuditRow[];
}

export async function createOrLoadManualPublishRequest(input: {
  serviceSupabase: SupabaseClient;
  workspaceId: string;
  adId: string;
  mutationId: string;
  notes?: string | null;
  publishSummary: unknown;
  controls: unknown;
  actorProfileId: string;
}): Promise<ManualPublishRequest> {
  const workspaceId = requireUuid(input.workspaceId, "workspaceId");
  const adId = requireUuid(input.adId, "adId");
  const mutationId = requireUuid(input.mutationId, "mutationId");
  const notes = input.notes?.trim() || null;
  const publishSummary = requirePlainObject(input.publishSummary, "publishSummary");
  const publishControls = requirePlainObject(input.controls, "controls");
  if (notes && notes.length > 1000) throw new ManualPublishError("invalid_input", "notes must be 1,000 characters or fewer.");

  const existing = await loadEvents(input.serviceSupabase, { mutationId });
  if (existing.length) {
    const request = toRequest(existing);
    if (!request || request.workspaceId !== workspaceId || request.adId !== adId) throw new ManualPublishError("idempotency_conflict", "mutationId is already used for another request.", 409);
    return request;
  }

  const { data: ad, error: adError } = await input.serviceSupabase.from("ad_customer_ads").select("id,workspace_id,name,active_revision_id").eq("id", adId).eq("workspace_id", workspaceId).maybeSingle();
  if (adError || !ad) throw new ManualPublishError("ad_not_found", "The saved ad could not be found in this workspace.", 404);
  if (!ad.active_revision_id) throw new ManualPublishError("not_saved", "Save the ad before requesting manual publishing.");
  const { data: revision, error: revisionError } = await input.serviceSupabase.from("ad_revisions").select("id,workspace_id,revision_number,document_hash,feed_png_path,story_png_path").eq("id", ad.active_revision_id).eq("ad_id", adId).eq("workspace_id", workspaceId).maybeSingle();
  if (revisionError || !revision) throw new ManualPublishError("revision_not_found", "The active saved revision could not be found.", 404);
  if (typeof revision.feed_png_path !== "string" || !revision.feed_png_path || typeof revision.story_png_path !== "string" || !revision.story_png_path) throw new ManualPublishError("renders_missing", "Save both Feed and Story PNGs before requesting manual publishing.");

  const metadata = {
    requestType: "manual_meta_publish",
    mutationId,
    workspaceId,
    adId,
    adName: typeof ad.name === "string" ? ad.name : null,
    revisionId: revision.id,
    revisionNumber: Number(revision.revision_number),
    documentHash: revision.document_hash,
    feedPngPath: revision.feed_png_path ?? null,
    storyPngPath: revision.story_png_path ?? null,
    notes,
    publishSummary,
    publishControls,
    status: "requested",
  } satisfies Record<string, unknown>;
  const { error } = await input.serviceSupabase.from("audit_logs").insert({
    id: mutationId,
    workspace_id: workspaceId,
    actor_profile_id: input.actorProfileId,
    action: MANUAL_REQUEST_ACTION,
    target_type: MANUAL_REQUEST_TARGET,
    target_id: adId,
    correlation_id: mutationId,
    metadata,
  });
  if (error && error.code !== "23505") throw new ManualPublishError("storage_error", "The manual publishing request could not be recorded.", 500);
  const created = await loadEvents(input.serviceSupabase, { mutationId });
  const request = toRequest(created);
  if (!request || request.workspaceId !== workspaceId || request.adId !== adId) throw new ManualPublishError("idempotency_conflict", "mutationId is already used for another request.", 409);
  return request;
}

export async function getManualPublishRequest(serviceSupabase: SupabaseClient, input: { workspaceId?: string; adId?: string; mutationId?: string }) {
  const events = await loadEvents(serviceSupabase, { workspaceId: input.workspaceId ? requireUuid(input.workspaceId, "workspaceId") : undefined, adId: input.adId ? requireUuid(input.adId, "adId") : undefined, mutationId: input.mutationId ? requireUuid(input.mutationId, "mutationId") : undefined });
  if (input.mutationId) return toRequest(events);
  const groups = new Map<string, AuditRow[]>();
  for (const event of events) { const key = event.correlation_id ?? event.id; groups.set(key, [...(groups.get(key) ?? []), event]); }
  return [...groups.values()].map(toRequest).filter((request): request is ManualPublishRequest => Boolean(request)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

export function allowedManualStatusTransition(from: ManualPublishStatus, to: ManualPublishStatus) {
  return (from === "requested" && (to === "in_progress" || to === "cancelled")) || (from === "in_progress" && (to === "completed" || to === "cancelled"));
}

export async function listManualPublishRequests(serviceSupabase: SupabaseClient) {
  const events = await loadEvents(serviceSupabase, {});
  const grouped = new Map<string, AuditRow[]>();
  for (const event of events) {
    const key = event.correlation_id ?? event.id;
    const group = grouped.get(key) ?? [];
    group.push(event);
    grouped.set(key, group);
  }
  return [...grouped.values()].map(toRequest).filter((request): request is ManualPublishRequest => Boolean(request));
}

export async function listManualPublishRequestsForWorkspace(serviceSupabase: SupabaseClient, workspaceId: string) {
  const events = await loadEvents(serviceSupabase, { workspaceId: requireUuid(workspaceId, "workspaceId") });
  const grouped = new Map<string, AuditRow[]>();
  for (const event of events) {
    const key = event.correlation_id ?? event.id;
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }
  return [...grouped.values()].map(toRequest).filter((request): request is ManualPublishRequest => Boolean(request));
}

export async function updateManualPublishStatus(input: { serviceSupabase: SupabaseClient; requestId: string; status: ManualPublishStatus; reason: string; actorProfileId: string; }) {
  const requestId = requireUuid(input.requestId, "requestId");
  const reason = input.reason.trim();
  if (!reason || reason.length > 1000) throw new ManualPublishError("invalid_input", "A reason between 1 and 1,000 characters is required.");
  const events = await loadEvents(input.serviceSupabase, { mutationId: requestId });
  const current = toRequest(events);
  if (!current) throw new ManualPublishError("not_found", "Manual publishing request was not found.", 404);
  if (current.status === input.status) return current;
  if (!allowedManualStatusTransition(current.status, input.status)) throw new ManualPublishError("invalid_transition", `Cannot change request from ${current.status} to ${input.status}.`, 409);
  const transitionId = deterministicUuid(`manual_meta_publish_transition:${requestId}:${current.status}`);
  const { error } = await input.serviceSupabase.from("audit_logs").insert({
    id: transitionId,
    workspace_id: current.workspaceId,
    actor_profile_id: input.actorProfileId,
    action: MANUAL_STATUS_ACTION,
    target_type: MANUAL_REQUEST_TARGET,
    target_id: current.adId,
    correlation_id: requestId,
    metadata: { requestType: "manual_meta_publish", status: input.status, reason },
  });
  if (error && error.code !== "23505") throw new ManualPublishError("storage_error", "The request status could not be recorded.", 500);
  const updated = toRequest(await loadEvents(input.serviceSupabase, { mutationId: requestId }));
  if (!updated) throw new ManualPublishError("status_race", "The request changed while it was being updated; reload and try again.", 409);
  if (updated.status !== input.status) throw new ManualPublishError("status_race", `Another operator changed this request to ${updated.status}; reload before continuing.`, 409);
  return updated;
}
