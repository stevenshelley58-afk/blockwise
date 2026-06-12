import { randomUUID } from "node:crypto";

import type { ApprovalStatus } from "../publishing/readiness.ts";
import { DEFAULT_META_GRAPH_VERSION } from "./meta-graph-version.ts";

export type MetaPlanMutationAction = "activate" | "pause" | "increase_budget" | "export_leads";
export type MetaPlanMutationStatus = "requested" | "approved" | "applying" | "applied" | "failed";

export type MetaPlanMutationPayload = {
  campaignId?: string;
  adSetIds?: string[];
  adIds?: string[];
  adSetBudgets?: Array<{ adSetId: string; dailyBudgetMinorUnits: number }>;
  destination?: string;
};

export type MetaPlanMutation = {
  mutationId: string;
  workspaceId: string;
  planId: string;
  action: MetaPlanMutationAction;
  status: MetaPlanMutationStatus;
  payload: MetaPlanMutationPayload;
  approvalRequestId: string | null;
  requestedBy: string | null;
  requestLog: MetaMutationLogEntry[];
  responseLog: MetaMutationLogEntry[];
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MetaPlanMutationApproval = {
  targetType: "meta_publish_plan_mutation";
  targetId: string;
  status: "requested";
  riskSummary: string;
};

export type BuiltMetaPlanMutation = MetaPlanMutation & {
  approval: MetaPlanMutationApproval;
};

export type MetaMutationLogEntry = {
  step: string;
  method: "POST";
  path: string;
  body?: Record<string, unknown>;
  response?: Record<string, unknown>;
  status?: number;
  createdAt: string;
};

export function buildMetaPlanMutation(input: {
  workspaceId: string;
  planId: string;
  requestedBy?: string | null;
  action: MetaPlanMutationAction;
  payload: MetaPlanMutationPayload;
  mutationId?: string;
  now?: string;
}): BuiltMetaPlanMutation {
  const now = input.now ?? new Date().toISOString();
  const mutationId = input.mutationId ?? randomUUID();

  return {
    mutationId,
    workspaceId: input.workspaceId,
    planId: input.planId,
    action: input.action,
    status: "requested",
    payload: input.payload,
    approvalRequestId: null,
    requestedBy: input.requestedBy ?? null,
    requestLog: [],
    responseLog: [],
    lastError: null,
    createdAt: now,
    updatedAt: now,
    approval: {
      targetType: "meta_publish_plan_mutation",
      targetId: mutationId,
      status: "requested",
      riskSummary: riskSummaryForMutation(input.action, input.payload),
    },
  };
}

export async function executeMetaPlanMutation(input: {
  mutation: MetaPlanMutation;
  approvalStatus: ApprovalStatus;
  accessToken: string;
  graphVersion?: string;
  fetchImpl?: typeof fetch;
}): Promise<Pick<MetaPlanMutation, "status" | "requestLog" | "responseLog" | "lastError">> {
  if (input.approvalStatus !== "approved") {
    throw new Error("Meta live mutation requires an approved approval request.");
  }

  const requestLog = [...input.mutation.requestLog];
  const responseLog = [...input.mutation.responseLog];

  try {
    if (input.mutation.action === "activate" || input.mutation.action === "pause") {
      const status = input.mutation.action === "activate" ? "ACTIVE" : "PAUSED";
      const objectIds = [
        input.mutation.payload.campaignId,
        ...(input.mutation.payload.adSetIds ?? []),
        ...(input.mutation.payload.adIds ?? []),
      ].filter(Boolean) as string[];

      for (const objectId of objectIds) {
        await postMetaMutation({
          ...input,
          requestLog,
          responseLog,
          step: `${input.mutation.action}.${objectId}`,
          path: `/${objectId}`,
          body: { status },
        });
      }
    }

    if (input.mutation.action === "increase_budget" || input.mutation.payload.adSetBudgets?.length) {
      for (const budget of input.mutation.payload.adSetBudgets ?? []) {
        await postMetaMutation({
          ...input,
          requestLog,
          responseLog,
          step: `budget.${budget.adSetId}`,
          path: `/${budget.adSetId}`,
          body: { daily_budget: String(budget.dailyBudgetMinorUnits) },
        });
      }
    }

    return { status: "applied", requestLog, responseLog, lastError: null };
  } catch (error) {
    return {
      status: "failed",
      requestLog,
      responseLog,
      lastError: error instanceof Error ? error.message : "Meta mutation failed.",
    };
  }
}

function riskSummaryForMutation(action: MetaPlanMutationAction, payload: MetaPlanMutationPayload): string {
  if (action === "activate") return "Activate paused Meta campaign objects. This can start live delivery and spend.";
  if (action === "pause") return "Pause live Meta campaign objects. This can stop delivery immediately.";
  if (action === "increase_budget") return `Increase Meta ad set budget for ${payload.adSetBudgets?.length ?? 0} ad set(s).`;

  return `Export Meta lead PII to ${payload.destination ?? "configured lead destination"}.`;
}

async function postMetaMutation(input: {
  accessToken: string;
  graphVersion?: string;
  fetchImpl?: typeof fetch;
  requestLog: MetaMutationLogEntry[];
  responseLog: MetaMutationLogEntry[];
  step: string;
  path: string;
  body: Record<string, unknown>;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const createdAt = new Date().toISOString();
  const url = `https://graph.facebook.com/${input.graphVersion ?? DEFAULT_META_GRAPH_VERSION}${input.path}`;

  input.requestLog.push({
    step: input.step,
    method: "POST",
    path: input.path,
    body: input.body,
    createdAt,
  });

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input.body),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  input.responseLog.push({
    step: input.step,
    method: "POST",
    path: input.path,
    response: payload,
    status: response.status,
    createdAt: new Date().toISOString(),
  });

  if (!response.ok) {
    const error = payload.error as { message?: string } | undefined;
    throw new Error(error?.message ?? `Meta mutation ${input.step} failed with ${response.status}.`);
  }
}
