/**
 * Versioned, provider-neutral operator action contract.
 *
 * This module validates intent only. It does not execute customer mutations or
 * call a provider. Hermes can claim the durable action outbox and select an
 * adapter only after a capability is enabled for the action.
 */
export const BLOCKWISE_ACTION_CONTRACT_VERSION = "blockwise.ops.action.v1" as const;

export type OpsActionCapability = "available" | "capability_required" | "unsupported";
export type OpsActionRole = "owner" | "support";
export type OpsActionTargetType = "workspace" | "invitation" | "profile" | "session" | "enquiry" | "booking" | "billing";

export type OpsActionName =
  | "team_invite" | "team_resend" | "team_cancel" | "team_role_change" | "team_suspend" | "team_reactivate"
  | "session_revoke"
  | "consent_grant" | "consent_withdraw" | "consent_unsubscribe"
  | "suppression_add" | "suppression_remove"
  | "enquiry_assign" | "enquiry_close" | "enquiry_reply"
  | "enquiry_reopen"
  | "booking_cancel" | "booking_reschedule"
  | "billing_reconcile" | "billing_cancel_at_period_end" | "billing_portal_link";

export type TeamRole = "admin" | "member" | "viewer";
export type OpsActionPayloadMap = {
  team_invite: { email: string; role: TeamRole };
  team_resend: Record<string, never>;
  team_cancel: Record<string, never>;
  team_role_change: { role: TeamRole };
  team_suspend: Record<string, never>;
  team_reactivate: Record<string, never>;
  session_revoke: Record<string, never>;
  consent_grant: { topic: string };
  consent_withdraw: { topic?: string };
  consent_unsubscribe: Record<string, never>;
  suppression_add: { reason: string };
  suppression_remove: { reason: string };
  enquiry_assign: { assigneeProfileId: string | null };
  enquiry_close: Record<string, never>;
  enquiry_reply: { body: string };
  enquiry_reopen: Record<string, never>;
  booking_cancel: Record<string, never>;
  booking_reschedule: { scheduledStartAt: string; scheduledEndAt?: string };
  billing_reconcile: Record<string, never>;
  billing_cancel_at_period_end: { cancelAtPeriodEnd: boolean };
  billing_portal_link: Record<string, never>;
};

export type OpsActionTargetMap = {
  team_invite: "workspace";
  team_resend: "invitation";
  team_cancel: "invitation";
  team_role_change: "profile";
  team_suspend: "profile";
  team_reactivate: "profile";
  session_revoke: "session";
  consent_grant: "profile";
  consent_withdraw: "profile";
  consent_unsubscribe: "profile";
  suppression_add: "profile";
  suppression_remove: "profile";
  enquiry_assign: "enquiry";
  enquiry_close: "enquiry";
  enquiry_reply: "enquiry";
  enquiry_reopen: "enquiry";
  booking_cancel: "booking";
  booking_reschedule: "booking";
  billing_reconcile: "billing";
  billing_cancel_at_period_end: "billing";
  billing_portal_link: "billing";
};

export type OpsActionCapabilityDefinition = {
  capability: OpsActionCapability;
  description: string;
};

/**
 * The map is deliberately explicit so an unavailable action cannot be
 * mistaken for an implemented mutation. "available" means Blockwise already
 * owns a reviewed capability; it does not authorize provider execution here.
 */
export const OPS_ACTION_CAPABILITIES: Record<OpsActionName, OpsActionCapabilityDefinition> = {
  team_invite: { capability: "available", description: "existing team invitation reservation and delivery path" },
  team_resend: { capability: "available", description: "existing pending invitation resend path" },
  team_cancel: { capability: "available", description: "existing invitation cancellation RPC" },
  team_role_change: { capability: "available", description: "owner-only CAS role mutation with last-owner protection" },
  team_suspend: { capability: "unsupported", description: "account suspension capability is not implemented" },
  team_reactivate: { capability: "unsupported", description: "account reactivation capability is not implemented" },
  session_revoke: { capability: "available", description: "existing owner-only session revocation RPC" },
  consent_grant: { capability: "capability_required", description: "exact per-profile Mautic consent executor is not registered" },
  consent_withdraw: { capability: "capability_required", description: "exact per-profile Mautic consent executor is not registered" },
  consent_unsubscribe: { capability: "capability_required", description: "exact per-profile Mautic unsubscribe executor is not registered" },
  suppression_add: { capability: "capability_required", description: "durable Mautic suppression executor is not registered" },
  suppression_remove: { capability: "capability_required", description: "durable Mautic suppression executor is not registered" },
  enquiry_assign: { capability: "available", description: "existing explicit enquiry association RPC" },
  enquiry_close: { capability: "capability_required", description: "Hermes Chatwoot action lane requires verified provider readiness" },
  enquiry_reply: { capability: "capability_required", description: "Hermes Chatwoot action lane requires verified provider readiness" },
  enquiry_reopen: { capability: "capability_required", description: "Hermes Chatwoot action lane requires verified provider readiness" },
  booking_cancel: { capability: "capability_required", description: "operator booking cancellation executor is not registered" },
  booking_reschedule: { capability: "capability_required", description: "operator booking reschedule executor is not registered" },
  billing_reconcile: { capability: "available", description: "existing billing reconciliation path" },
  billing_cancel_at_period_end: { capability: "capability_required", description: "operator cancellation executor is not registered" },
  billing_portal_link: { capability: "capability_required", description: "operator billing portal-link executor is not registered" },
};

type OpsActionFor<Name extends OpsActionName> = {
  schema: typeof BLOCKWISE_ACTION_CONTRACT_VERSION;
  actionId: string;
  idempotencyKey: string;
  workspaceId: string;
  customerId: string;
  actor: { operatorId: string; role: OpsActionRole; aal: "aal2" };
  target: { type: OpsActionTargetMap[Name]; id: string };
  action: Name;
  expectedVersion: number;
  reason: string;
  createdAt: string;
  expiresAt: string;
  payload: OpsActionPayloadMap[Name];
};

export type OpsActionEnvelope = { [Name in OpsActionName]: OpsActionFor<Name> }[OpsActionName];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_REASON = 500;
const MAX_IDEMPOTENCY_KEY = 256;
const MAX_REPLY_BODY = 4000;
const MAX_TOPIC = 128;

const PAYLOAD_KEYS: Record<OpsActionName, readonly string[]> = {
  team_invite: ["email", "role"], team_resend: [], team_cancel: [], team_role_change: ["role"], team_suspend: [], team_reactivate: [], session_revoke: [],
  consent_grant: ["topic"], consent_withdraw: ["topic"], consent_unsubscribe: [], suppression_add: ["reason"], suppression_remove: ["reason"],
  enquiry_assign: ["assigneeProfileId"], enquiry_close: [], enquiry_reply: ["body"], enquiry_reopen: [], booking_cancel: [], booking_reschedule: ["scheduledStartAt", "scheduledEndAt"],
  billing_reconcile: [], billing_cancel_at_period_end: ["cancelAtPeriodEnd"], billing_portal_link: [],
};
const REQUIRED_PAYLOAD_KEYS: Record<OpsActionName, readonly string[]> = {
  ...PAYLOAD_KEYS,
  consent_withdraw: [],
  booking_reschedule: ["scheduledStartAt"],
};

export function actionCapability(action: OpsActionName): OpsActionCapabilityDefinition {
  return OPS_ACTION_CAPABILITIES[action];
}

/** Validate an untrusted action request and return a normalized envelope. */
export function parseOpsAction(input: unknown): OpsActionEnvelope {
  const value = record(input, "action");
  if (value.schema !== BLOCKWISE_ACTION_CONTRACT_VERSION) throw new Error("action schema is invalid");
  const action = string(value.action, "action");
  if (!(action in OPS_ACTION_CAPABILITIES)) throw new Error("unsupported operations action");
  const name = action as OpsActionName;
  const payload = record(value.payload, "payload");
  const keys = Object.keys(payload).sort();
  const expectedKeys = [...PAYLOAD_KEYS[name]].sort();
  const requiredKeys = [...REQUIRED_PAYLOAD_KEYS[name]].sort();
  if (keys.some((key) => !expectedKeys.includes(key)) || requiredKeys.some((key) => !keys.includes(key))) throw new Error("action payload fields are not allowlisted");
  const actionId = uuid(value.actionId, "actionId");
  const workspaceId = uuid(value.workspaceId, "workspaceId");
  const customerId = uuid(value.customerId, "customerId");
  if (workspaceId !== customerId) throw new Error("customerId must equal workspaceId");
  const actorValue = record(value.actor, "actor");
  const actor = { operatorId: uuid(actorValue.operatorId, "actor.operatorId"), role: actorValue.role, aal: actorValue.aal } as { operatorId: string; role: OpsActionRole; aal: "aal2" };
  if (actor.role !== "owner" && actor.role !== "support") throw new Error("actor.role is invalid");
  if (actor.aal !== "aal2") throw new Error("operator AAL2 is required");
  const targetValue = record(value.target, "target");
  const targetType = targetValue.type;
  if (targetType !== targetTypeFor(name)) throw new Error("action target type is invalid");
  const target = { type: targetType, id: uuid(targetValue.id, "target.id") } as { type: OpsActionTargetMap[typeof name]; id: string };
  const idempotencyKey = string(value.idempotencyKey, "idempotencyKey");
  if (idempotencyKey.length > MAX_IDEMPOTENCY_KEY || !/^[A-Za-z0-9][A-Za-z0-9:._/-]*$/.test(idempotencyKey)) throw new Error("idempotencyKey is invalid");
  const expectedVersion = value.expectedVersion;
  if (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 1) throw new Error("expectedVersion must be positive");
  const reason = string(value.reason, "reason");
  if (reason.length > MAX_REASON) throw new Error("reason is too long");
  const createdAt = timestamp(value.createdAt, "createdAt");
  const expiresAt = timestamp(value.expiresAt, "expiresAt");
  const createdMs = Date.parse(createdAt);
  const expiresMs = Date.parse(expiresAt);
  if (expiresMs <= createdMs || expiresMs - createdMs > 24 * 60 * 60 * 1000) throw new Error("action expiry is invalid");
  const normalizedPayload = normalizePayload(name, payload);
  return { schema: BLOCKWISE_ACTION_CONTRACT_VERSION, actionId, idempotencyKey, workspaceId, customerId, actor, target, action: name, expectedVersion: expectedVersion as number, reason, createdAt, expiresAt, payload: normalizedPayload } as OpsActionEnvelope;
}

function normalizePayload<Name extends OpsActionName>(name: Name, payload: Record<string, unknown>): OpsActionPayloadMap[Name] {
  if (name === "team_invite") {
    const email = string(payload.email, "payload.email").toLowerCase();
    if (email.length > 320 || !/^\S+@\S+$/.test(email)) throw new Error("payload.email is invalid");
    const role = payload.role;
    if (role !== "admin" && role !== "member" && role !== "viewer") throw new Error("payload.role is invalid");
    return { email, role } as OpsActionPayloadMap[Name];
  }
  if (name === "team_role_change") {
    if (payload.role !== "admin" && payload.role !== "member" && payload.role !== "viewer") throw new Error("payload.role is invalid");
    return { role: payload.role } as OpsActionPayloadMap[Name];
  }
  if (name === "consent_grant") {
    const topic = string(payload.topic, "payload.topic");
    if (topic.length > MAX_TOPIC) throw new Error("payload.topic is too long");
    return { topic } as OpsActionPayloadMap[Name];
  }
  if (name === "consent_withdraw") {
    if (payload.topic !== undefined) {
      const topic = string(payload.topic, "payload.topic");
      if (topic.length > MAX_TOPIC) throw new Error("payload.topic is too long");
      return { topic } as OpsActionPayloadMap[Name];
    }
    return {} as OpsActionPayloadMap[Name];
  }
  if (name === "suppression_add" || name === "suppression_remove") {
    const reason = string(payload.reason, "payload.reason");
    if (reason.length > MAX_REASON) throw new Error("payload.reason is too long");
    return { reason } as OpsActionPayloadMap[Name];
  }
  if (name === "enquiry_assign") {
    if (payload.assigneeProfileId !== null && payload.assigneeProfileId !== undefined) uuid(payload.assigneeProfileId, "payload.assigneeProfileId");
    return { assigneeProfileId: payload.assigneeProfileId === undefined ? null : payload.assigneeProfileId } as OpsActionPayloadMap[Name];
  }
  if (name === "enquiry_reply") {
    const body = string(payload.body, "payload.body");
    if (body.length > MAX_REPLY_BODY) throw new Error("payload.body is too long");
    return { body } as OpsActionPayloadMap[Name];
  }
  if (name === "booking_reschedule") {
    const scheduledStartAt = timestamp(payload.scheduledStartAt, "payload.scheduledStartAt");
    const scheduledEndAt = payload.scheduledEndAt === undefined ? undefined : timestamp(payload.scheduledEndAt, "payload.scheduledEndAt");
    if (scheduledEndAt && Date.parse(scheduledEndAt) <= Date.parse(scheduledStartAt)) throw new Error("booking schedule is invalid");
    return scheduledEndAt ? { scheduledStartAt, scheduledEndAt } as OpsActionPayloadMap[Name] : { scheduledStartAt } as OpsActionPayloadMap[Name];
  }
  if (name === "billing_cancel_at_period_end") {
    if (typeof payload.cancelAtPeriodEnd !== "boolean") throw new Error("payload.cancelAtPeriodEnd is invalid");
    return { cancelAtPeriodEnd: payload.cancelAtPeriodEnd } as OpsActionPayloadMap[Name];
  }
  return {} as OpsActionPayloadMap[Name];
}

function targetTypeFor(action: OpsActionName): OpsActionTargetType {
  return ({
    team_invite: "workspace", team_resend: "invitation", team_cancel: "invitation", team_role_change: "profile", team_suspend: "profile", team_reactivate: "profile",
    session_revoke: "session", consent_grant: "profile", consent_withdraw: "profile", consent_unsubscribe: "profile", suppression_add: "profile", suppression_remove: "profile",
    enquiry_assign: "enquiry", enquiry_close: "enquiry", enquiry_reply: "enquiry", enquiry_reopen: "enquiry", booking_cancel: "booking", booking_reschedule: "booking", billing_reconcile: "billing", billing_cancel_at_period_end: "billing", billing_portal_link: "billing",
  } as const)[action];
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string): string { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`); return value.trim(); }
function uuid(value: unknown, label: string): string { const normalized = string(value, label).toLowerCase(); if (!UUID.test(normalized)) throw new Error(`${label} is invalid`); return normalized; }
function timestamp(value: unknown, label: string): string { const normalized = string(value, label); const date = new Date(normalized); if (!ISO.test(normalized) || !Number.isFinite(date.getTime()) || date.toISOString() !== normalized) throw new Error(`${label} is invalid`); return normalized; }
