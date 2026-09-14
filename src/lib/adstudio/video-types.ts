import type { UploadRejectionReason } from "./video-limits.ts";

export type VideoProjectMode = "uploaded" | "commissioned";
export type VideoProjectStatus = "draft" | "submitted" | "archived";

/**
 * Upload ledger states. A file becomes `ready` only after server-side
 * inspection of its actual bytes. Anything not yet inspected stays quarantined.
 */
export type UploadState = "initiated" | "uploaded" | "validating" | "ready" | "rejected";

export type VideoOrderPaymentState =
  | "pending"
  | "paid"
  | "refunded"
  | "partially_refunded"
  | "disputed"
  | "failed";

export type VideoOrderFulfilmentState =
  | "awaiting_payment"
  | "queued"
  | "editing"
  | "draft_ready"
  | "revision_requested"
  | "final_ready"
  | "delivered"
  | "cancelled"
  | "failed"
  | "needs_clarification";

/** Customer-facing progression. Internal states are never shown verbatim. */
export const FULFILMENT_LABELS: Record<VideoOrderFulfilmentState, string> = {
  awaiting_payment: "Awaiting payment",
  queued: "Queued for editing",
  editing: "Being edited",
  draft_ready: "Draft ready for review",
  revision_requested: "Revision in progress",
  final_ready: "Final ready",
  delivered: "Delivered",
  cancelled: "Cancelled",
  failed: "Needs attention",
  needs_clarification: "We need one detail from you",
};

export type MediaInspection = {
  ok: boolean;
  reason?: UploadRejectionReason;
  mime?: string;
  bytes?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  hasVideoStream?: boolean;
  hasAudioStream?: boolean;
  needsOptimisation?: boolean;
};

export type BriefCompletenessIssue =
  | "objective_missing"
  | "audience_missing"
  | "desired_action_missing"
  | "key_facts_missing"
  | "overlay_wording_missing"
  | "permission_not_confirmed"
  | "no_assets";

export const BRIEF_ISSUE_MESSAGES: Record<BriefCompletenessIssue, string> = {
  objective_missing: "Add what this video should achieve.",
  audience_missing: "Add who this video is for.",
  desired_action_missing: "Add what you want people to do after watching.",
  key_facts_missing: "Add at least one fact the video must include.",
  overlay_wording_missing: "Add the wording for the text overlay, or ask us to write it for you.",
  permission_not_confirmed: "Confirm you have permission to use the material you supplied.",
  no_assets: "Add at least one photo or clip for us to use.",
};

export type BriefInput = {
  objective?: string | null;
  audience?: string | null;
  desiredAction?: string | null;
  keyFacts?: string | null;
  overlayWording?: string | null;
  wantsWordingHelp?: boolean;
  transcript?: string | null;
  referenceUrl?: string | null;
  musicPreference?: "house_licensed" | "customer_supplied" | "none";
  uploadPermissionConfirmed?: boolean;
  assetCount: number;
};

/**
 * Completeness is checked before checkout so a customer cannot pay for a brief
 * an editor cannot start. It is re-checked server-side at payment time.
 */
export function assessBriefCompleteness(input: BriefInput): BriefCompletenessIssue[] {
  const issues: BriefCompletenessIssue[] = [];
  const present = (value: string | null | undefined) => typeof value === "string" && value.trim().length > 0;

  if (!present(input.objective)) issues.push("objective_missing");
  if (!present(input.audience)) issues.push("audience_missing");
  if (!present(input.desiredAction)) issues.push("desired_action_missing");
  if (!present(input.keyFacts)) issues.push("key_facts_missing");
  // A customer may either supply overlay wording or ask us to write it.
  if (!present(input.overlayWording) && input.wantsWordingHelp !== true) {
    issues.push("overlay_wording_missing");
  }
  if (input.uploadPermissionConfirmed !== true) issues.push("permission_not_confirmed");
  if (input.assetCount < 1) issues.push("no_assets");

  return issues;
}

/**
 * The committed deadline. `ready_at` is the later of verified payment and a
 * complete validated brief. The customer sees the resulting exact local date
 * and time; the duration is never left for them to interpret.
 */
export function computeReadyAt(input: { paidAt: Date; briefCompleteAt: Date }): Date {
  return input.paidAt.getTime() >= input.briefCompleteAt.getTime() ? input.paidAt : input.briefCompleteAt;
}
