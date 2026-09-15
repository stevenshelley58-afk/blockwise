import type { SupabaseClient } from "@supabase/supabase-js";

import { VIDEO_BUCKET, versionObjectPath } from "./video-refs.ts";
import type { VideoOrderFulfilmentState } from "./video-types.ts";
import { enqueueVideoNotification, resolveOrderContact } from "./video-notifications.ts";

/**
 * Operator actions on a paid video order.
 *
 * Every mutation is operator-only, validated against the order's current state,
 * and recorded on the append-only trail with an idempotency key so a retry
 * cannot apply the same transition twice.
 *
 * The committed deadline is never written by anything in this file. Claiming a
 * job, reassigning it, uploading a draft late or retrying a failed upload all
 * leave `first_draft_due_at` exactly as the customer was told it.
 */

export class FulfilmentError extends Error {
  readonly kind: "invalid" | "conflict" | "forbidden" | "storage";
  constructor(kind: "invalid" | "conflict" | "forbidden" | "storage", message: string) {
    super(message);
    this.kind = kind;
  }
}


/**
 * Tell the customer their order moved. Best effort by design: the draft or the
 * delivery is already recorded, so a notification problem is reported and not
 * allowed to fail the operator's action or lose the order.
 */
async function notifyCustomer(input: {
  supabase: SupabaseClient;
  kind: "draft_ready" | "final_ready";
  workspaceId: string;
  orderId: string;
  projectId: string;
  firstDraftDueAt: string | null;
  dueTimezone: string;
  revisionEntitlement: number;
  revisionsUsed: number;
  versionNumber: number;
}): Promise<void> {
  try {
    const contact = await resolveOrderContact(input.supabase, input.workspaceId);
    if (!contact) return;

    const { data: project } = await input.supabase
      .from("video_projects")
      .select("title")
      .eq("id", input.projectId)
      .maybeSingle();

    await enqueueVideoNotification({
      supabase: input.supabase,
      kind: input.kind,
      to: contact,
      versionNumber: input.versionNumber,
      order: {
        workspaceId: input.workspaceId,
        orderId: input.orderId,
        projectTitle: String((project as { title?: string } | null)?.title ?? "your video"),
        firstDraftDueAt: input.firstDraftDueAt,
        dueTimezone: input.dueTimezone,
        revisionEntitlement: input.revisionEntitlement,
        revisionsUsed: input.revisionsUsed,
      },
    });
  } catch (error) {
    console.error("video notification failed", {
      kind: input.kind,
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}

async function loadOrder(supabase: SupabaseClient, orderId: string) {
  const { data, error } = await supabase
    .from("video_orders")
    .select("id, workspace_id, project_id, payment_state, fulfilment_state, assigned_operator, revision_entitlement, revisions_used, brief_version_id, first_draft_due_at, due_timezone")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new FulfilmentError("storage", "The order could not be loaded.");
  if (!data) throw new FulfilmentError("invalid", "That order was not found.");
  return data;
}

async function recordEvent(input: {
  supabase: SupabaseClient;
  workspaceId: string;
  orderId: string;
  projectId: string;
  operatorId: string;
  eventType: string;
  from?: string | null;
  to?: string | null;
  detail?: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<void> {
  const { error } = await input.supabase.from("video_order_events").insert({
    workspace_id: input.workspaceId,
    order_id: input.orderId,
    project_id: input.projectId,
    actor_id: input.operatorId,
    actor_role: "operator",
    event_type: input.eventType,
    from_state: input.from ?? null,
    to_state: input.to ?? null,
    detail: input.detail ?? {},
    idempotency_key: input.idempotencyKey,
  });
  // A duplicate key means this transition was already recorded, which is the
  // intended outcome of a retry rather than a failure.
  if (error && error.code !== "23505") {
    throw new FulfilmentError("storage", "The action could not be recorded.");
  }
}

/**
 * Claim a paid order. The first operator to claim keeps it, so two editors
 * cannot start the same job, and a second claim is refused rather than silently
 * reassigning someone else's work.
 */
export async function claimOrder(input: {
  supabase: SupabaseClient;
  orderId: string;
  operatorId: string;
  now?: Date;
}): Promise<{ assignedOperator: string }> {
  const order = await loadOrder(input.supabase, input.orderId);
  if (order.payment_state !== "paid") {
    throw new FulfilmentError("forbidden", "Only a paid order can be claimed.");
  }

  const now = input.now ?? new Date();
  const { data: updated, error } = await input.supabase
    .from("video_orders")
    .update({
      assigned_operator: input.operatorId,
      claimed_at: now.toISOString(),
      // Note the absence of first_draft_due_at: the promise does not move.
      fulfilment_state: order.fulfilment_state === "queued" ? "editing" : order.fulfilment_state,
    })
    .eq("id", input.orderId)
    .eq("payment_state", "paid")
    .is("assigned_operator", null)
    .select("assigned_operator")
    .maybeSingle();

  if (error) throw new FulfilmentError("storage", "That order could not be claimed.");
  if (!updated) {
    throw new FulfilmentError("conflict", "Another operator has already claimed this order.");
  }

  await recordEvent({
    supabase: input.supabase,
    workspaceId: String(order.workspace_id),
    orderId: input.orderId,
    projectId: String(order.project_id),
    operatorId: input.operatorId,
    eventType: "order.claimed",
    from: String(order.fulfilment_state),
    to: String(order.fulfilment_state === "queued" ? "editing" : order.fulfilment_state),
    idempotencyKey: `order.claimed:${input.orderId}`,
  });

  return { assignedOperator: String(updated.assigned_operator) };
}

/**
 * Register an uploaded draft against the order. The asset is created by the
 * caller from bytes it has already inspected; this only advances the state.
 */
export async function publishDraft(input: {
  supabase: SupabaseClient;
  orderId: string;
  operatorId: string;
  assetId: string;
  notes?: string | null;
}): Promise<{ versionNumber: number }> {
  const order = await loadOrder(input.supabase, input.orderId);
  if (order.payment_state !== "paid") {
    throw new FulfilmentError("forbidden", "Only a paid order can receive a draft.");
  }

  const workspaceId = String(order.workspace_id);
  const projectId = String(order.project_id);

  const { data: asset } = await input.supabase
    .from("video_assets")
    .select("id, workspace_id, project_id, upload_state")
    .eq("id", input.assetId)
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!asset) throw new FulfilmentError("invalid", "That draft file was not found for this order.");
  if (asset.upload_state !== "ready") {
    throw new FulfilmentError("invalid", "That draft has not finished uploading.");
  }

  const { data: latest } = await input.supabase
    .from("video_versions")
    .select("version_number")
    .eq("project_id", projectId)
    .eq("kind", "draft")
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const versionNumber = Number(latest?.version_number ?? 0) + 1;

  const { error: versionError } = await input.supabase.from("video_versions").insert({
    workspace_id: workspaceId,
    project_id: projectId,
    order_id: input.orderId,
    version_number: versionNumber,
    kind: "draft",
    asset_id: input.assetId,
    notes: input.notes ?? null,
    created_by: input.operatorId,
  });

  if (versionError) throw new FulfilmentError("storage", "That draft could not be recorded.");

  const { error: stateError } = await input.supabase
    .from("video_orders")
    .update({ fulfilment_state: "draft_ready" satisfies VideoOrderFulfilmentState })
    .eq("id", input.orderId)
    .eq("payment_state", "paid");

  if (stateError) throw new FulfilmentError("storage", "The order could not be updated.");

  await recordEvent({
    supabase: input.supabase,
    workspaceId,
    orderId: input.orderId,
    projectId,
    operatorId: input.operatorId,
    eventType: "order.draft_ready",
    from: String(order.fulfilment_state),
    to: "draft_ready",
    detail: { versionNumber, assetId: input.assetId },
    idempotencyKey: `order.draft_ready:${input.orderId}:${versionNumber}`,
  });

  await notifyCustomer({
    supabase: input.supabase,
    kind: "draft_ready",
    workspaceId,
    orderId: input.orderId,
    projectId,
    firstDraftDueAt: order.first_draft_due_at ? String(order.first_draft_due_at) : null,
    dueTimezone: String(order.due_timezone ?? "Australia/Sydney"),
    revisionEntitlement: Number(order.revision_entitlement ?? 1),
    revisionsUsed: Number(order.revisions_used ?? 0),
    versionNumber,
  });

  return { versionNumber };
}

/**
 * Deliver a final. The approved version becomes immutable, and the entitlement
 * is what the customer bought: approving a final does not create a new
 * revision right.
 */
export async function deliverFinal(input: {
  supabase: SupabaseClient;
  orderId: string;
  operatorId: string;
  assetId: string;
}): Promise<{ versionNumber: number }> {
  const order = await loadOrder(input.supabase, input.orderId);
  if (order.payment_state !== "paid") {
    throw new FulfilmentError("forbidden", "Only a paid order can be delivered.");
  }
  // A delivered or cancelled order is finished. Without this, a second call
  // would create another final version and rewrite a delivery the customer has
  // already been told about.
  if (order.fulfilment_state === "delivered" || order.fulfilment_state === "cancelled") {
    throw new FulfilmentError("conflict", `This order is already ${order.fulfilment_state}.`);
  }

  const workspaceId = String(order.workspace_id);
  const projectId = String(order.project_id);

  const { data: asset } = await input.supabase
    .from("video_assets")
    .select("id, workspace_id, project_id, upload_state")
    .eq("id", input.assetId)
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!asset) throw new FulfilmentError("invalid", "That final file was not found for this order.");
  if (asset.upload_state !== "ready") {
    throw new FulfilmentError("invalid", "That final has not finished uploading.");
  }

  const { data: latest } = await input.supabase
    .from("video_versions")
    .select("version_number")
    .eq("project_id", projectId)
    .eq("kind", "final")
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const versionNumber = Number(latest?.version_number ?? 0) + 1;

  const { error: versionError } = await input.supabase.from("video_versions").insert({
    workspace_id: workspaceId,
    project_id: projectId,
    order_id: input.orderId,
    version_number: versionNumber,
    kind: "final",
    asset_id: input.assetId,
    created_by: input.operatorId,
  });

  if (versionError) throw new FulfilmentError("storage", "That final could not be recorded.");

  const { data: delivered, error: stateError } = await input.supabase
    .from("video_orders")
    .update({ fulfilment_state: "delivered" satisfies VideoOrderFulfilmentState })
    .eq("id", input.orderId)
    .eq("payment_state", "paid")
    .not("fulfilment_state", "in", "(delivered,cancelled)")
    .select("id")
    .maybeSingle();

  if (stateError) throw new FulfilmentError("storage", "The order could not be updated.");
  if (!delivered) throw new FulfilmentError("conflict", "This order has already been finished.");

  await recordEvent({
    supabase: input.supabase,
    workspaceId,
    orderId: input.orderId,
    projectId,
    operatorId: input.operatorId,
    eventType: "order.delivered",
    from: String(order.fulfilment_state),
    to: "delivered",
    detail: { versionNumber, assetId: input.assetId },
    idempotencyKey: `order.delivered:${input.orderId}:${versionNumber}`,
  });

  await notifyCustomer({
    supabase: input.supabase,
    kind: "final_ready",
    workspaceId,
    orderId: input.orderId,
    projectId,
    firstDraftDueAt: order.first_draft_due_at ? String(order.first_draft_due_at) : null,
    dueTimezone: String(order.due_timezone ?? "Australia/Sydney"),
    revisionEntitlement: Number(order.revision_entitlement ?? 1),
    revisionsUsed: Number(order.revisions_used ?? 0),
    versionNumber,
  });

  return { versionNumber };
}

/** Operator-only download reference for one source asset in the pack. */
export function operatorAssetPath(input: { workspaceId: string; projectId: string; assetId: string; kind: "draft" | "final" }): string {
  return versionObjectPath({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    versionId: input.assetId,
    kind: input.kind,
  });
}

export const OPERATOR_MEDIA_BUCKET = VIDEO_BUCKET;
