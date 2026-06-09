import {
  WORKFORCE_AGENTS,
  HUMAN_APPROVAL_ACTIONS,
  type WorkforceAction,
  type WorkforceDataClass,
  type WorkforceDestination,
} from "./permissions.ts";

export type WorkforceRuntimePolicy = {
  workspaceId: string;
  agentRunId: string;
  actorProfileId: string;
  agentKey: string;
  allowedActions: WorkforceAction[];
  allowedDataClasses: WorkforceDataClass[];
  allowedDestinations: WorkforceDestination[];
  allowedOutboundDomains: string[];
  maxRowsPerRun: number;
  canCrossWorkspace: boolean;
  approvalIds: string[];
};

export type WorkforceRuntimePolicyInput = {
  workspaceId: string;
  agentRunId: string;
  actorProfileId: string;
  agentKey: string;
  approvalIds?: string[];
};

export type WorkforceOperation = {
  action: WorkforceAction;
  workspaceId: string;
  dataClasses: WorkforceDataClass[];
  destination: WorkforceDestination;
  outboundDomain?: string;
  approvalId?: string;
  rowCount?: number;
};

export type WorkforceAuthorizationDecision = {
  allowed: boolean;
  reason?: string;
};

export type SensitiveSignal = "email" | "au_phone" | "secret";

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const AU_PHONE_PATTERN = /(?:\+?61|0)\s?(?:2|3|4|7|8)\s?\d{2,4}\s?\d{3}\s?\d{3}\b/;
const SECRET_PATTERN = /\b(?:sk|pk|rk|api[_-]?key|secret|token)[-_=:][A-Za-z0-9_-]{6,}\b/i;

export function buildWorkforceRuntimePolicy(input: WorkforceRuntimePolicyInput): WorkforceRuntimePolicy {
  if (!input.workspaceId || !input.agentRunId || !input.actorProfileId || !input.agentKey) {
    throw new Error("Agent runtime policy requires workspaceId, agentRunId, actorProfileId, and agentKey.");
  }

  const definition = WORKFORCE_AGENTS.find((agent) => agent.key === input.agentKey);

  if (!definition) {
    throw new Error(`Unknown agent definition: ${input.agentKey}`);
  }

  return {
    workspaceId: input.workspaceId,
    agentRunId: input.agentRunId,
    actorProfileId: input.actorProfileId,
    agentKey: definition.key,
    allowedActions: [...definition.allowedActions],
    allowedDataClasses: [...definition.allowedDataClasses],
    allowedDestinations: [...definition.allowedDestinations],
    allowedOutboundDomains: [...definition.allowedOutboundDomains],
    maxRowsPerRun: definition.maxRowsPerRun,
    canCrossWorkspace: definition.canCrossWorkspace,
    approvalIds: [...(input.approvalIds ?? [])],
  };
}

export function authorizeWorkforceOperation(
  policy: WorkforceRuntimePolicy,
  operation: WorkforceOperation,
): WorkforceAuthorizationDecision {
  if (!policy.allowedActions.includes(operation.action)) {
    return {
      allowed: false,
      reason: `Agent ${policy.agentKey} is not allowed to perform ${operation.action}.`,
    };
  }

  if (operation.workspaceId !== policy.workspaceId && !hasCrossWorkspaceGrant(policy, operation)) {
    return {
      allowed: false,
      reason: "Agents cannot access another workspace without an explicit cross-workspace grant.",
    };
  }

  for (const dataClass of operation.dataClasses) {
    if (!policy.allowedDataClasses.includes(dataClass)) {
      return {
        allowed: false,
        reason: `Data class ${dataClass} is not in this agent policy allowlist.`,
      };
    }
  }

  if (!policy.allowedDestinations.includes(operation.destination)) {
    return {
      allowed: false,
      reason: `Destination ${operation.destination} is not in this agent policy allowlist.`,
    };
  }

  if (operation.outboundDomain && !policy.allowedOutboundDomains.includes(operation.outboundDomain)) {
    return {
      allowed: false,
      reason: `Outbound domain ${operation.outboundDomain} is not in this agent policy allowlist.`,
    };
  }

  if (HUMAN_APPROVAL_ACTIONS.includes(operation.action) && !hasApproval(policy, operation.approvalId)) {
    return {
      allowed: false,
      reason: `Action ${operation.action} requires a recorded human approval.`,
    };
  }

  if ((operation.rowCount ?? 0) > policy.maxRowsPerRun) {
    return {
      allowed: false,
      reason: `Requested row count exceeds this agent policy limit of ${policy.maxRowsPerRun}.`,
    };
  }

  return { allowed: true };
}

export function detectSensitiveText(value: string): SensitiveSignal[] {
  const signals: SensitiveSignal[] = [];

  if (EMAIL_PATTERN.test(value)) {
    signals.push("email");
  }

  if (AU_PHONE_PATTERN.test(value)) {
    signals.push("au_phone");
  }

  if (SECRET_PATTERN.test(value)) {
    signals.push("secret");
  }

  return signals;
}

function hasCrossWorkspaceGrant(policy: WorkforceRuntimePolicy, operation: WorkforceOperation): boolean {
  return policy.canCrossWorkspace && hasApproval(policy, operation.approvalId);
}

function hasApproval(policy: WorkforceRuntimePolicy, approvalId?: string): boolean {
  return Boolean(approvalId && policy.approvalIds.includes(approvalId));
}
