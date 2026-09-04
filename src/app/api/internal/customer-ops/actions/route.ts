import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { verifyInternalRequest } from "@/lib/internal-auth";
import { parseOpsAction } from "@/lib/ops/action-contract";
import { isSubscriptionBound, sameQueuedEnvelope } from "@/lib/ops/action-executor-contract";
import { applyStripeBillingEvent, reconciliationEventForSubscription } from "@/lib/billing/billing-domain";
import { retrieveStripeSubscription } from "@/lib/billing/stripe-scaffold";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { readBoundedRequestBody, RequestBodyTooLargeError } from "@/lib/ops/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["team_invite", "team_resend", "team_cancel", "team_role_change", "session_revoke", "enquiry_assign", "enquiry_close", "enquiry_reply", "consent_grant", "consent_withdraw", "consent_unsubscribe", "suppression_add", "suppression_remove", "billing_reconcile"]);
const MAX_BODY = 128 * 1024;
class ActionExecutionError extends Error { constructor(message: string, readonly status: number) { super(message); } }

/**
 * Private executor endpoint for the customer-ops control edge. The edge has
 * already claimed the action; this route re-checks the exact leased row and
 * delegates to existing Blockwise domain RPCs. It is never a browser route.
 */
export async function POST(request: Request) {
  let raw: string;
  try { raw = await readBoundedRequestBody(request, MAX_BODY); } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: error.code }, { status: 413 });
    return NextResponse.json({ error: "request_body_unavailable" }, { status: 400 });
  }
  const service = createSupabaseServiceClient();
  const auth = await verifyInternalRequest(request, "ops.execute", { body: raw, supabase: service });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: Record<string, unknown>;
  try { const value: unknown = JSON.parse(raw); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); body = value as Record<string, unknown>; } catch { return NextResponse.json({ error: "invalid_action" }, { status: 422 }); }

  const actionId = id(body.actionId); const leaseToken = id(body.leaseToken); const workspaceId = id(body.workspaceId); const customerId = id(body.customerId);
  const actionType = typeof body.action === "string" ? body.action : ""; const target = record(body.target); const targetId = id(target?.id); const targetType = typeof target?.type === "string" ? target.type : "";
  const expectedVersion = body.expectedVersion;
  if (!actionId || !leaseToken || !workspaceId || !customerId || workspaceId !== customerId || !ACTIONS.has(actionType) || !targetId || !targetType || !Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1) return NextResponse.json({ error: "invalid_action" }, { status: 422 });

  const { data: queued, error: loadError } = await service.from("ops_action_outbox").select("action_id,idempotency_key,lease_token,lease_expires_at,workspace_id,customer_id,actor_operator_id,actor_role,actor_aal,action_type,target_type,target_id,expected_version,reason,payload,status,created_at,expires_at").eq("action_id", actionId).eq("workspace_id", workspaceId).maybeSingle();
  if (loadError) return NextResponse.json({ error: "executor_unavailable" }, { status: 503 });
  if (!queued || queued.status !== "processing" || queued.lease_token !== leaseToken || !queued.lease_expires_at || new Date(String(queued.lease_expires_at)).getTime() <= Date.now() || !queued.expires_at || new Date(String(queued.expires_at)).getTime() <= Date.now() || queued.customer_id !== customerId || queued.action_type !== actionType || queued.target_type !== targetType || queued.target_id !== targetId || Number(queued.expected_version) !== Number(expectedVersion)) return NextResponse.json({ error: "action_lease_invalid" }, { status: 409 });
  if (!UUID.test(String(queued.actor_operator_id)) || !["owner", "support"].includes(String(queued.actor_role)) || queued.actor_aal !== "aal2") return NextResponse.json({ error: "operator_provenance_invalid" }, { status: 403 });
  const payload = record(body.payload);
  if (!payload || JSON.stringify(payload).length > 12000) return NextResponse.json({ error: "invalid_action_payload" }, { status: 422 });
  const envelope = { ...body, leaseToken: undefined };
  try { parseOpsAction(envelope); } catch { return NextResponse.json({ error: "invalid_action_envelope" }, { status: 422 }); }
  if (!sameQueuedEnvelope(envelope, queued)) return NextResponse.json({ error: "action_envelope_mismatch" }, { status: 409 });
  const { data: operator, error: operatorError } = await service.from("profiles").select("is_operator,operator_role").eq("id", String(queued.actor_operator_id)).maybeSingle();
  if (operatorError) return NextResponse.json({ error: "operator_state_unavailable" }, { status: 503 });
  if (!operator?.is_operator || operator.operator_role !== queued.actor_role) return NextResponse.json({ error: "operator_no_longer_authorized" }, { status: 403 });

  try {
    const queuedPayload = record(queued.payload);
    if (!queuedPayload) return NextResponse.json({ error: "queued_payload_invalid" }, { status: 503 });
    if (actionType === "team_invite" || actionType === "team_resend") {
      const invitation = actionType === "team_invite" ? { email: String(queuedPayload.email ?? ""), role: String(queuedPayload.role ?? "member") } : await invitationDetails(service, workspaceId, targetId);
      await invite(service, workspaceId, String(queued.actor_operator_id), invitation.email, invitation.role, actionId, String(queued.idempotency_key));
    }
    else if (actionType === "team_cancel") {
      const outcome = await requireRpc(service, "cancel_workspace_invitation", { p_workspace_id: workspaceId, p_invitation_id: targetId, p_actor_profile_id: String(queued.actor_operator_id), p_reason: "operator_action" });
      const outcomeCode = String(outcome || "unknown");
      if (!["cancelled", "expired"].includes(outcomeCode)) {
        const status = outcomeCode === "owner_required" ? 403 : ["workspace_not_found", "invitation_not_found"].includes(outcomeCode) ? 404 : 409;
        throw new ActionExecutionError(`invitation_${outcomeCode}`, status);
      }
    }
    else if (actionType === "session_revoke") {
      if (targetId === String(queued.actor_operator_id)) return NextResponse.json({ error: "cannot_revoke_actor_session" }, { status: 409 });
      await requireRpc(service, "revoke_user_sessions", { p_user_id: targetId });
    } else if (["team_role_change", "enquiry_close", "enquiry_reply", "consent_grant", "consent_withdraw", "consent_unsubscribe", "suppression_add", "suppression_remove"].includes(actionType)) {
      const mutation = await requireRpc(service, "execute_ops_customer_action", {
        p_action_id: actionId,
        p_workspace_id: workspaceId,
        p_target_id: targetId,
        p_action_type: actionType,
        p_expected_version: Number(expectedVersion),
        p_actor_profile_id: String(queued.actor_operator_id),
        p_payload: queuedPayload,
      });
      if (!mutation || typeof mutation !== "object") throw new ActionExecutionError("action_mutation_failed", 502);
    } else if (actionType === "enquiry_assign") {
      const assignee = queuedPayload.assigneeProfileId === null ? null : id(queuedPayload.assigneeProfileId);
      if (queuedPayload.assigneeProfileId !== null && !assignee) return NextResponse.json({ error: "invalid_assignee" }, { status: 422 });
      const { data, error } = await service.rpc("assign_ops_enquiry", { p_workspace_id: workspaceId, p_enquiry_id: targetId, p_assignee_profile_id: assignee, p_expected_version: Number(expectedVersion), p_actor_profile_id: String(queued.actor_operator_id) });
      if (error) {
        const message = error.message.toLowerCase();
        if (message.includes("not a workspace member")) return NextResponse.json({ error: "invalid_assignee" }, { status: 403 });
        if (message.includes("invalid enquiry assignment")) return NextResponse.json({ error: "invalid_assignment" }, { status: 422 });
        return NextResponse.json({ error: "enquiry_assignment_failed" }, { status: 502 });
      }
      if (data !== true) return NextResponse.json({ error: "enquiry_version_conflict" }, { status: 409 });
    } else if (actionType === "billing_reconcile") {
      const { data: billing, error } = await service.from("workspaces").select("stripe_subscription_id").eq("id", workspaceId).maybeSingle();
      if (error) return NextResponse.json({ error: "billing_state_unavailable" }, { status: 503 });
      const subscriptionId = typeof billing?.stripe_subscription_id === "string" ? billing.stripe_subscription_id : "";
      if (!subscriptionId) return NextResponse.json({ error: "billing_not_connected" }, { status: 409 });
      const subscription = await retrieveStripeSubscription(subscriptionId);
      if (!isSubscriptionBound(subscription, subscriptionId, workspaceId)) throw new ActionExecutionError("billing_subscription_workspace_mismatch", 409);
      await applyStripeBillingEvent(service, reconciliationEventForSubscription(subscription, `ops:${actionId}`));
    }
    return NextResponse.json({ status: "accepted", operationId: actionId });
  } catch (error) {
    console.error(JSON.stringify({ event: "customer_ops_executor_failed", actionType, actionId: idSuffix(actionId), workspaceId: idSuffix(workspaceId), errorCode: safeCode(error) }));
    if (error instanceof ActionExecutionError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "action_execution_failed" }, { status: 502 });
  }
}

async function invite(service: ReturnType<typeof createSupabaseServiceClient>, workspaceId: string, actorId: string, email: string, role: string, actionId: string, idempotencyKey: string): Promise<void> {
  const normalized = email.trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 320) throw new Error("invalid invitation email");
  if (!["admin", "member", "viewer"].includes(role)) throw new Error("invalid invitation role");
  const reservation = await requireRpc(service, "reserve_verified_workspace_invitation", { p_workspace_id: workspaceId, p_email: normalized, p_role: role, p_actor_profile_id: actorId });
  const row = Array.isArray(reservation) ? reservation[0] : reservation;
  const invitationId = row && typeof row === "object" && typeof (row as { invitation_id?: unknown }).invitation_id === "string" ? (row as { invitation_id: string }).invitation_id : "";
  const outcome = row && typeof row === "object" ? String((row as { outcome?: unknown }).outcome ?? "") : "";
  if (!invitationId && outcome !== "already_member") throw new ActionExecutionError(`invitation_${outcome || "reservation_failed"}`, ["owner_required", "paid_plan_required"].includes(outcome) ? 403 : 409);
  if (outcome === "already_member") return;
  const deliveryReservation = await requireRpc(service, "begin_ops_invitation_delivery", { p_action_id: actionId, p_idempotency_key: idempotencyKey, p_workspace_id: workspaceId, p_invitation_id: invitationId });
  const reservationState = record(deliveryReservation)?.state;
  if (reservationState === "completed") return;
  if (reservationState !== "reserved") {
    const reconciled = await requireRpc(service, "reconcile_ops_invitation_delivery", { p_action_id: actionId });
    if (reconciled === "completed") return;
    throw new ActionExecutionError("invitation_delivery_needs_reconciliation", 409);
  }
  const started = await requireRpc(service, "start_ops_invitation_delivery", { p_action_id: actionId });
  if (started !== true) throw new ActionExecutionError("invitation_delivery_needs_reconciliation", 409);
  const redirectTo = new URL("/auth/confirm", process.env.NEXT_PUBLIC_APP_URL ?? "https://blockwise.sale"); redirectTo.searchParams.set("next", "/settings#team");
  try {
    const delivery = await service.auth.admin.inviteUserByEmail(normalized, { redirectTo: redirectTo.toString() });
    if (delivery.error) throw new Error("invitation_delivery_failed");
    const providerUserId = id(record(record(delivery.data)?.user)?.id);
    const { error: updateError } = await service.from("workspace_invitations").update({ send_attempt_count: 1, last_sent_at: new Date().toISOString(), last_send_error: null, updated_at: new Date().toISOString(), ...(providerUserId ? { provider_user_id: providerUserId } : {}) }).eq("id", invitationId).eq("workspace_id", workspaceId).eq("status", "pending");
    if (updateError) throw new Error("invitation_state_update_failed");
    const completed = await requireRpc(service, "complete_ops_invitation_delivery", { p_action_id: actionId });
    if (completed !== true) throw new Error("invitation_delivery_completion_failed");
  } catch (error) {
    await service.rpc("quarantine_ops_invitation_delivery", { p_action_id: actionId, p_error: error instanceof Error ? error.message : "invitation delivery failed" });
    throw error;
  }
}
async function invitationDetails(service: ReturnType<typeof createSupabaseServiceClient>, workspaceId: string, invitationId: string): Promise<{ email: string; role: string }> { const { data, error } = await service.from("workspace_invitations").select("email,role").eq("id", invitationId).eq("workspace_id", workspaceId).eq("status", "pending").maybeSingle(); if (error) throw new Error("invitation_lookup_failed"); if (typeof data?.email !== "string" || typeof data.role !== "string") throw new ActionExecutionError("invitation_not_found", 404); return { email: data.email, role: data.role }; }
async function requireRpc(service: ReturnType<typeof createSupabaseServiceClient>, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await service.rpc(fn, args);
  if (!error) return data;
  const message = error.message.toLowerCase();
  if (message.includes("invitation delivery needs reconciliation")) throw new ActionExecutionError("invitation_delivery_needs_reconciliation", 409);
  if (message.includes("last_operator_owner")) throw new ActionExecutionError("last_operator_owner", 409);
  if (message.includes("not a workspace member")) throw new ActionExecutionError("invalid_workspace_member", 403);
  if (message.includes("invalid") && (message.includes("user") || message.includes("profile"))) throw new ActionExecutionError("invalid_target", 409);
  throw new Error(`${fn}_failed`);
}
function id(value: unknown): string { return typeof value === "string" && UUID.test(value.trim()) ? value.trim().toLowerCase() : ""; }
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function safeCode(error: unknown): string { const value = error instanceof Error ? error.message : ""; return /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : "unknown_error"; }
function idSuffix(value: string): string { return value.length > 8 ? value.slice(-8) : value; }
