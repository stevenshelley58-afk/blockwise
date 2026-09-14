import type { SupabaseClient } from "@supabase/supabase-js";

import { VIDEO_OFFER } from "./video-offer.ts";
import { assessBriefCompleteness, type BriefInput, BRIEF_ISSUE_MESSAGES } from "./video-types.ts";

/**
 * Commissioned video orders.
 *
 * A paid order is created only from a frozen, complete brief. The order stores
 * an immutable snapshot of what was sold — price, deliverable, deadline rules
 * and revision allowance — so a later price change or a later edit to the offer
 * config cannot alter what an existing customer bought.
 *
 * Payment state and fulfilment state are separate columns, so a refund or a
 * dispute never erases the production record.
 */

export class VideoOrderError extends Error {
  readonly kind: "blocked" | "invalid" | "conflict" | "storage";
  readonly issues?: string[];
  constructor(kind: "blocked" | "invalid" | "conflict" | "storage", message: string, issues?: string[]) {
    super(message);
    this.kind = kind;
    this.issues = issues;
  }
}

export class VideoCheckoutGatedError extends VideoOrderError {
  constructor(message: string) {
    super("blocked", message);
  }
}

/**
 * The gate that keeps live checkout off until the accountant confirms the GST
 * treatment. Two independent conditions must both hold, so flipping the offer
 * config alone is not enough to start charging customers.
 */
export function assertCheckoutEnabled(env: NodeJS.ProcessEnv = process.env): void {
  if (VIDEO_OFFER.taxTreatment === "undetermined") {
    throw new VideoCheckoutGatedError(
      "Paid video orders are not available yet. The tax treatment of this price is still being confirmed.",
    );
  }
  if (!VIDEO_OFFER.checkoutEnabled) {
    throw new VideoCheckoutGatedError("Paid video orders are not available yet.");
  }
  if (!env.STRIPE_VIDEO_AUD_PRICE_ID?.trim()) {
    throw new VideoCheckoutGatedError("Paid video orders are not available yet.");
  }
}

/** The exact terms this order is sold on, frozen at purchase. */
export function buildOfferSnapshot(now: Date) {
  return {
    offerId: VIDEO_OFFER.id,
    offerVersion: VIDEO_OFFER.version,
    amountMinor: VIDEO_OFFER.amountMinor,
    currency: VIDEO_OFFER.currency,
    taxTreatment: VIDEO_OFFER.taxTreatment,
    deliverable: VIDEO_OFFER.deliverable,
    deliveryWorkingDays: VIDEO_OFFER.deliveryWorkingDays,
    revisionWorkingDays: VIDEO_OFFER.revisionWorkingDays,
    revisionEntitlement: VIDEO_OFFER.revisionEntitlement,
    workdays: VIDEO_OFFER.workdays,
    workdayStartHour: VIDEO_OFFER.workdayStartHour,
    workdayEndHour: VIDEO_OFFER.workdayEndHour,
    timezone: VIDEO_OFFER.defaultTimezone,
    supportEmail: VIDEO_OFFER.supportEmail,
    snapshotAt: now.toISOString(),
  };
}

export type SubmitBriefInput = {
  supabase: SupabaseClient;
  workspaceId: string;
  projectId: string;
  createdBy: string;
  brief: Omit<BriefInput, "assetCount">;
};

/**
 * Freeze a brief and open an order for it.
 *
 * The brief is validated before it is frozen, and the frozen row is never
 * updated afterwards: a later clarification is a new version, so the version a
 * customer paid for stays exactly as they approved it.
 */
export async function submitBriefAndCreateOrder(input: SubmitBriefInput): Promise<{
  orderId: string;
  briefVersionId: string;
  status: "awaiting_payment";
}> {
  const { supabase, workspaceId, projectId, createdBy } = input;

  const { data: project, error: projectError } = await supabase
    .from("video_projects")
    .select("id, workspace_id, mode")
    .eq("id", projectId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (projectError) throw new VideoOrderError("storage", "That video could not be loaded.");
  if (!project) throw new VideoOrderError("invalid", "That video was not found.");
  if (project.mode !== "commissioned") {
    throw new VideoOrderError("invalid", "This video is not a commissioned order.");
  }

  // Only ready, customer-visible source material may be attached to a brief.
  const { count: assetCount, error: assetError } = await supabase
    .from("video_assets")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .eq("visibility", "customer")
    .eq("upload_state", "ready");

  if (assetError) throw new VideoOrderError("storage", "Your files could not be checked.");
  const readyAssets = assetCount ?? 0;

  const issues = assessBriefCompleteness({ ...input.brief, assetCount: readyAssets });
  if (issues.length > 0) {
    throw new VideoOrderError(
      "invalid",
      "Finish these before paying: " + issues.map((issue) => BRIEF_ISSUE_MESSAGES[issue]).join(" "),
      issues,
    );
  }

  // An order already awaiting payment is resumed rather than duplicated, so a
  // double submit cannot open two orders for one brief.
  const { data: existing } = await supabase
    .from("video_orders")
    .select("id, brief_version_id, payment_state, fulfilment_state")
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .eq("payment_state", "pending")
    .maybeSingle();

  if (existing) {
    return {
      orderId: String(existing.id),
      briefVersionId: String(existing.brief_version_id),
      status: "awaiting_payment",
    };
  }

  const now = new Date();

  // Freeze the customer's own draft in place. Editing a copy and freezing that
  // instead would leave the version they were looking at unfrozen, so the row
  // the customer saw and the row the order points at could differ.
  const { data: draft, error: draftError } = await supabase
    .from("video_brief_versions")
    .select("id, version, frozen_at")
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .is("frozen_at", null)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (draftError) throw new VideoOrderError("storage", "Your brief could not be loaded.");

  let briefRow: { id: string } | null = draft ? { id: String(draft.id) } : null;

  if (briefRow) {
    const { error: freezeError } = await supabase
      .from("video_brief_versions")
      .update({
        objective: input.brief.objective ?? null,
        audience: input.brief.audience ?? null,
        desired_action: input.brief.desiredAction ?? null,
        key_facts: input.brief.keyFacts ?? null,
        overlay_wording: input.brief.overlayWording ?? null,
        wants_wording_help: input.brief.wantsWordingHelp === true,
        transcript: input.brief.transcript ?? null,
        reference_url: input.brief.referenceUrl ?? null,
        music_preference: input.brief.musicPreference ?? "house_licensed",
        upload_permission_confirmed: input.brief.uploadPermissionConfirmed === true,
        is_complete: true,
        completeness_issues: [],
        frozen_at: now.toISOString(),
      })
      .eq("id", briefRow.id)
      .eq("workspace_id", workspaceId)
      .is("frozen_at", null);

    if (freezeError) throw new VideoOrderError("storage", "Your brief could not be saved.");
  } else {
    // No draft exists, which happens when the customer submits in one pass.
    const { data: latest } = await supabase
      .from("video_brief_versions")
      .select("version")
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersion = Number(latest?.version ?? 0) + 1;
    const { data: created, error: createError } = await supabase
      .from("video_brief_versions")
      .insert({
        workspace_id: workspaceId,
        project_id: projectId,
        version: nextVersion,
        objective: input.brief.objective ?? null,
        audience: input.brief.audience ?? null,
        desired_action: input.brief.desiredAction ?? null,
        key_facts: input.brief.keyFacts ?? null,
        overlay_wording: input.brief.overlayWording ?? null,
        wants_wording_help: input.brief.wantsWordingHelp === true,
        transcript: input.brief.transcript ?? null,
        reference_url: input.brief.referenceUrl ?? null,
        music_preference: input.brief.musicPreference ?? "house_licensed",
        upload_permission_confirmed: input.brief.uploadPermissionConfirmed === true,
        is_complete: true,
        completeness_issues: [],
        frozen_at: now.toISOString(),
        created_by: createdBy,
      })
      .select("id")
      .single();

    if (createError || !created) throw new VideoOrderError("storage", "Your brief could not be saved.");
    briefRow = { id: String(created.id) };
  }

  const snapshot = buildOfferSnapshot(now);

  const { data: orderRow, error: orderError } = await supabase
    .from("video_orders")
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      brief_version_id: briefRow.id,
      offer_id: VIDEO_OFFER.id,
      offer_version: VIDEO_OFFER.version,
      offer_snapshot: snapshot,
      amount_minor: VIDEO_OFFER.amountMinor,
      currency: VIDEO_OFFER.currency,
      tax_treatment: VIDEO_OFFER.taxTreatment,
      payment_state: "pending",
      fulfilment_state: "awaiting_payment",
      due_timezone: VIDEO_OFFER.defaultTimezone,
      workday_start_hour: VIDEO_OFFER.workdayStartHour,
      workday_end_hour: VIDEO_OFFER.workdayEndHour,
      delivery_working_days: VIDEO_OFFER.deliveryWorkingDays,
      revision_working_days: VIDEO_OFFER.revisionWorkingDays,
      revision_entitlement: VIDEO_OFFER.revisionEntitlement,
      created_by: createdBy,
    })
    .select("id")
    .single();

  if (orderError || !orderRow) {
    throw new VideoOrderError("storage", "Your order could not be created.");
  }

  // The ordering rule, recorded through the append-only trail.
  await supabase.from("video_order_events").insert({
    workspace_id: workspaceId,
    order_id: orderRow.id,
    project_id: projectId,
    actor_id: createdBy,
    actor_role: "customer",
    event_type: "order.created",
    to_state: "awaiting_payment",
    detail: { offerId: VIDEO_OFFER.id, offerVersion: VIDEO_OFFER.version, amountMinor: VIDEO_OFFER.amountMinor },
  });

  return { orderId: String(orderRow.id), briefVersionId: String(briefRow.id), status: "awaiting_payment" };
}

/**
 * Record verified payment and start the clock.
 *
 * `ready_at` is the later of verified payment and a complete validated brief,
 * so an early payment waits for the brief and a late payment does not get its
 * deadline shortened. The due date is computed by the database function that
 * owns the working-day rule, never in application code.
 */
export async function markOrderPaid(input: {
  supabase: SupabaseClient;
  orderId: string;
  paidAt: Date;
}): Promise<{ firstDraftDueAt: string }> {
  const { data: order, error } = await input.supabase
    .from("video_orders")
    .select("id, workspace_id, payment_state, delivery_working_days, due_timezone, workday_start_hour, workday_end_hour")
    .eq("id", input.orderId)
    .maybeSingle();

  if (error) throw new VideoOrderError("storage", "The order could not be loaded.");
  if (!order) throw new VideoOrderError("invalid", "That order was not found.");
  // Already paid: never re-date an order, so a replayed event cannot reset it.
  if (order.payment_state === "paid") {
    const { data: current } = await input.supabase
      .from("video_orders")
      .select("first_draft_due_at")
      .eq("id", input.orderId)
      .maybeSingle();
    return { firstDraftDueAt: String(current?.first_draft_due_at ?? "") };
  }

  const { data: due, error: dueError } = await input.supabase.rpc("video_order_first_draft_due_at", {
    p_ready_at: input.paidAt.toISOString(),
    p_working_days: order.delivery_working_days,
    p_timezone: order.due_timezone,
    p_workday_start: order.workday_start_hour,
    p_workday_end: order.workday_end_hour,
  });

  if (dueError) throw new VideoOrderError("storage", "The deadline could not be computed.");

  const { error: updateError } = await input.supabase
    .from("video_orders")
    .update({
      payment_state: "paid",
      fulfilment_state: "queued",
      ready_at: input.paidAt.toISOString(),
      first_draft_due_at: due,
    })
    .eq("id", input.orderId)
    .eq("payment_state", "pending");

  if (updateError) throw new VideoOrderError("storage", "The order could not be updated.");

  await input.supabase.from("video_order_events").insert({
    workspace_id: order.workspace_id,
    order_id: input.orderId,
    actor_role: "webhook",
    event_type: "order.paid",
    from_state: "awaiting_payment",
    to_state: "queued",
    idempotency_key: `order.paid:${input.orderId}`,
  });

  return { firstDraftDueAt: String(due) };
}
