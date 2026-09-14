import type { SupabaseClient } from "@supabase/supabase-js";

import type { VideoOrderFulfilmentState } from "./video-types.ts";

/**
 * The operator fulfilment queue.
 *
 * Paid orders only, ordered by the commitment already made to the customer.
 * The deadline shown here is the stored `first_draft_due_at`, never a value
 * recomputed when an operator picks the job up: reassignment, retries and
 * weekend gaps must not move a promise the customer has already been given.
 *
 * This module is read-only. Every action an operator takes is a separate,
 * audited mutation.
 */

type OrderRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  brief_version_id: string;
  amount_minor: number;
  currency: string;
  payment_state: string;
  fulfilment_state: string;
  ready_at: string | null;
  first_draft_due_at: string | null;
  due_timezone: string | null;
  assigned_operator: string | null;
  claimed_at: string | null;
  revision_entitlement: number | null;
  revisions_used: number | null;
  created_at: string;
};

type ProjectRow = { id: string; title: string | null };
type AssetRow = { project_id: string; kind: string | null; upload_state: string | null };
type VersionRow = { order_id: string | null; kind: string };
type FeedbackRow = { order_id: string; revision_number: number };

/** Hours before the committed deadline at which an order is worth attention. */
export const AT_RISK_HOURS = 12;

export type FulfilmentUrgency = "unclaimed" | "at_risk" | "due_soon" | "overdue" | "on_track" | "waiting_on_customer";

export type QueueOrder = {
  orderId: string;
  workspaceId: string;
  workspaceName: string | null;
  projectId: string;
  projectTitle: string;
  briefVersionId: string;
  amountMinor: number;
  currency: string;
  paymentState: string;
  fulfilmentState: VideoOrderFulfilmentState;
  readyAt: string | null;
  firstDraftDueAt: string | null;
  dueTimezone: string;
  assignedOperator: string | null;
  claimedAt: string | null;
  revisionEntitlement: number;
  revisionsUsed: number;
  sourceCount: number;
  draftCount: number;
  hasFeedback: boolean;
  createdAt: string;
};

export type QueueBrief = {
  objective: string | null;
  audience: string | null;
  desiredAction: string | null;
  keyFacts: string | null;
  overlayWording: string | null;
  wantsWordingHelp: boolean;
  transcript: string | null;
  referenceUrl: string | null;
  musicPreference: string;
  version: number;
  frozenAt: string | null;
};

/**
 * How much attention an order needs right now. Pure, so the thresholds can be
 * tested without a clock or a database.
 */
export function classifyUrgency(input: {
  fulfilmentState: VideoOrderFulfilmentState;
  firstDraftDueAt: string | null;
  claimedAt: string | null;
  now: Date;
}): FulfilmentUrgency {
  const { fulfilmentState, firstDraftDueAt, claimedAt, now } = input;

  // A draft or final already exists, so the ball is in the customer's court.
  if (fulfilmentState === "draft_ready" || fulfilmentState === "final_ready" || fulfilmentState === "delivered") {
    return "waiting_on_customer";
  }
  if (fulfilmentState === "needs_clarification") return "waiting_on_customer";
  if (!firstDraftDueAt) return claimedAt ? "on_track" : "unclaimed";

  const due = new Date(firstDraftDueAt).getTime();
  const hoursLeft = (due - now.getTime()) / 3_600_000;

  // Unclaimed is checked before the clock on purpose. An order nobody owns is
  // the more actionable problem, including one already past its deadline:
  // telling an operator "overdue" while it sits unassigned hides the reason.
  if (!claimedAt) return "unclaimed";
  if (hoursLeft < 0) return "overdue";
  if (hoursLeft <= AT_RISK_HOURS) return "at_risk";
  if (hoursLeft <= AT_RISK_HOURS * 2) return "due_soon";
  return "on_track";
}

export const URGENCY_LABELS: Record<FulfilmentUrgency, string> = {
  unclaimed: "Unclaimed",
  at_risk: "At risk",
  due_soon: "Due soon",
  overdue: "Overdue",
  on_track: "On track",
  waiting_on_customer: "Waiting on customer",
};

/** How long an order has been waiting for an operator to claim it. */
export function hoursUnclaimed(input: { claimedAt: string | null; createdAt: string; now: Date }): number | null {
  if (input.claimedAt) return null;
  return Math.max(0, (input.now.getTime() - new Date(input.createdAt).getTime()) / 3_600_000);
}

/**
 * Load the paid orders an operator has to deliver.
 *
 * Only paid orders appear. An unpaid order is not work yet, and showing it
 * would invite an editor to start on something that may never be bought.
 */
export async function loadFulfilmentQueue(
  supabase: SupabaseClient,
  options: { limit?: number; includeDelivered?: boolean } = {},
): Promise<QueueOrder[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);

  const { data, error } = await supabase
    .from("video_orders")
    .select(
      "id, workspace_id, project_id, brief_version_id, amount_minor, currency, payment_state, fulfilment_state, " +
        "ready_at, first_draft_due_at, due_timezone, assigned_operator, claimed_at, revision_entitlement, " +
        "revisions_used, created_at",
    )
    .eq("payment_state", "paid")
    .order("first_draft_due_at", { ascending: true, nullsFirst: false })
    .limit(limit);

  if (error) throw new Error(`The fulfilment queue could not be loaded: ${error.message}`);
  // Filtered here rather than in the query: a conditional builder call widens
  // the client's row type to an error union, and this keeps the rule readable.
  const orders = ((data ?? []) as unknown as OrderRow[]).filter(
    (row) =>
      options.includeDelivered ||
      (row.fulfilment_state !== "delivered" && row.fulfilment_state !== "cancelled"),
  );
  if (orders.length === 0) return [];

  const projectIds = [...new Set(orders.map((row) => String(row.project_id)))];
  const orderIds = orders.map((row) => String(row.id));

  // One pass per related table rather than a query per order.
  const [projects, assets, versions, feedback] = await Promise.all([
    supabase.from("video_projects").select("id, title, workspace_id").in("id", projectIds),
    supabase
      .from("video_assets")
      .select("project_id, kind, upload_state")
      .in("project_id", projectIds)
      .eq("upload_state", "ready"),
    supabase.from("video_versions").select("order_id, kind").in("order_id", orderIds),
    supabase.from("video_feedback").select("order_id, revision_number").in("order_id", orderIds),
  ]);

  const titleById = new Map(
    ((projects.data ?? []) as unknown as ProjectRow[]).map((row) => [String(row.id), String(row.title ?? "Untitled")]),
  );

  const sourceCount = new Map<string, number>();
  for (const row of (assets.data ?? []) as unknown as AssetRow[]) {
    const projectId = String(row.project_id);
    if (row.kind === "source_upload" || row.kind === "source_workspace") {
      sourceCount.set(projectId, (sourceCount.get(projectId) ?? 0) + 1);
    }
  }

  const draftCount = new Map<string, number>();
  for (const row of (versions.data ?? []) as unknown as VersionRow[]) {
    if (row.kind !== "draft") continue;
    const orderId = String(row.order_id);
    draftCount.set(orderId, (draftCount.get(orderId) ?? 0) + 1);
  }

  const feedbackOrders = new Set(
    ((feedback.data ?? []) as unknown as FeedbackRow[]).map((row) => String(row.order_id)),
  );

  return orders.map((row) => ({
    orderId: String(row.id),
    workspaceId: String(row.workspace_id),
    workspaceName: null,
    projectId: String(row.project_id),
    projectTitle: titleById.get(String(row.project_id)) ?? "Untitled video",
    briefVersionId: String(row.brief_version_id),
    amountMinor: Number(row.amount_minor),
    currency: String(row.currency),
    paymentState: String(row.payment_state),
    fulfilmentState: String(row.fulfilment_state) as VideoOrderFulfilmentState,
    readyAt: row.ready_at ? String(row.ready_at) : null,
    firstDraftDueAt: row.first_draft_due_at ? String(row.first_draft_due_at) : null,
    dueTimezone: String(row.due_timezone ?? "Australia/Sydney"),
    assignedOperator: row.assigned_operator ? String(row.assigned_operator) : null,
    claimedAt: row.claimed_at ? String(row.claimed_at) : null,
    revisionEntitlement: Number(row.revision_entitlement ?? 1),
    revisionsUsed: Number(row.revisions_used ?? 0),
    sourceCount: sourceCount.get(String(row.project_id)) ?? 0,
    draftCount: draftCount.get(String(row.id)) ?? 0,
    hasFeedback: feedbackOrders.has(String(row.id)),
    createdAt: String(row.created_at),
  }));
}

/** The frozen brief an operator edits from. */
export async function loadQueueBrief(
  supabase: SupabaseClient,
  workspaceId: string,
  briefVersionId: string,
): Promise<QueueBrief | null> {
  const { data, error } = await supabase
    .from("video_brief_versions")
    .select(
      "objective, audience, desired_action, key_facts, overlay_wording, wants_wording_help, transcript, " +
        "reference_url, music_preference, version, frozen_at",
    )
    .eq("id", briefVersionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as unknown as Record<string, unknown>;
  return {
    objective: (row.objective as string | null) ?? null,
    audience: (row.audience as string | null) ?? null,
    desiredAction: (row.desired_action as string | null) ?? null,
    keyFacts: (row.key_facts as string | null) ?? null,
    overlayWording: (row.overlay_wording as string | null) ?? null,
    wantsWordingHelp: row.wants_wording_help === true,
    transcript: (row.transcript as string | null) ?? null,
    referenceUrl: (row.reference_url as string | null) ?? null,
    musicPreference: String(row.music_preference ?? "house_licensed"),
    version: Number(row.version ?? 1),
    frozenAt: row.frozen_at ? String(row.frozen_at) : null,
  };
}

/**
 * The source pack an operator downloads to edit from. Operator-only production
 * material is excluded: this is the customer's supplied footage.
 */
export async function loadSourcePack(
  supabase: SupabaseClient,
  workspaceId: string,
  projectId: string,
): Promise<Array<{ assetId: string; objectPath: string; originalName: string | null; mime: string | null; bytes: number | null }>> {
  const { data, error } = await supabase
    .from("video_assets")
    .select("id, object_path, original_name, mime_type, bytes")
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .in("kind", ["source_upload", "source_workspace"])
    .eq("upload_state", "ready")
    .order("created_at", { ascending: true });

  if (error) throw new Error(`The source pack could not be loaded: ${error.message}`);
  type SourceAssetRow = {
    id: string;
    object_path: string;
    original_name: string | null;
    mime_type: string | null;
    bytes: number | null;
  };
  return ((data ?? []) as unknown as SourceAssetRow[]).map((row) => ({
    assetId: String(row.id),
    objectPath: String(row.object_path),
    originalName: (row.original_name as string | null) ?? null,
    mime: (row.mime_type as string | null) ?? null,
    bytes: (row.bytes as number | null) ?? null,
  }));
}
