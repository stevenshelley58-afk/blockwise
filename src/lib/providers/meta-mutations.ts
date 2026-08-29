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
  /**
   * Owning Blockwise publish plan, or null for inline management of a
   * Meta-created object (the worker then resolves the Meta token from the
   * workspace's provider connection instead of a plan).
   */
  planId: string | null;
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
  method: "POST" | "GET";
  path: string;
  body?: Record<string, unknown>;
  response?: Record<string, unknown>;
  status?: number;
  createdAt: string;
};

type MetaMutationExecutionResult = Pick<
  MetaPlanMutation,
  "status" | "requestLog" | "responseLog" | "lastError"
>;

const META_MUTATION_REQUEST_TIMEOUT_MS = 30_000;
const META_ACTIVATION_COMPENSATION_TIMEOUT_MS = 90_000;

export function buildMetaPlanMutation(input: {
  workspaceId: string;
  planId: string | null;
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
    planId: input.planId ?? null,
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
  compensationFetchImpl?: typeof fetch;
  onCheckpoint?: (result: MetaMutationExecutionResult) => Promise<void>;
}): Promise<MetaMutationExecutionResult> {
  if (input.approvalStatus !== "approved") {
    throw new Error("Meta live mutation requires an approved approval request.");
  }

  const requestLog = [...input.mutation.requestLog];
  const responseLog = [...input.mutation.responseLog];

  try {
    if (input.mutation.action === "activate") {
      await executeSafeActivation({ ...input, requestLog, responseLog });
    } else {
      if (input.mutation.action === "pause") {
        for (const objectId of mutationObjectIds(input.mutation.payload)) {
          await postMetaMutation({
            ...input,
            requestLog,
            responseLog,
            step: `pause.${objectId}`,
            path: `/${objectId}`,
            body: { status: "PAUSED" },
          });
        }
      }

      if (input.mutation.action === "increase_budget" || input.mutation.payload.adSetBudgets?.length) {
        await applyBudgetMutations({ ...input, requestLog, responseLog });
      }
    }

    return { status: "applied", requestLog, responseLog, lastError: null };
  } catch (error) {
    const primaryError = errorMessage(error);
    if (input.mutation.action === "activate") {
      const unconfirmedIds = await compensateFailedActivation({
        ...input,
        fetchImpl: input.compensationFetchImpl ?? input.fetchImpl,
        requestLog,
        responseLog,
      });
      return {
        status: "failed",
        requestLog,
        responseLog,
        lastError: unconfirmedIds.length === 0
          ? primaryError
          : `${primaryError} Safety pause could not be confirmed for Meta object(s): ${unconfirmedIds.join(", ")}.`,
      };
    }

    return {
      status: "failed",
      requestLog,
      responseLog,
      lastError: primaryError,
    };
  }
}

/**
 * Keep the campaign paused while its children and budget are prepared. The
 * campaign is the final ACTIVE write, so no earlier successful request can
 * start delivery. Repeating the guard also makes a retry safe after an
 * unanswered request from a previous attempt.
 */
async function executeSafeActivation(input: {
  mutation: MetaPlanMutation;
  accessToken: string;
  graphVersion?: string;
  fetchImpl?: typeof fetch;
  onCheckpoint?: (result: MetaMutationExecutionResult) => Promise<void>;
  requestLog: MetaMutationLogEntry[];
  responseLog: MetaMutationLogEntry[];
}) {
  const campaignId = normalizedObjectId(input.mutation.payload.campaignId);
  if (campaignId) {
    await postMetaMutation({
      ...input,
      step: `activate.guard_pause.${campaignId}`,
      path: `/${campaignId}`,
      body: { status: "PAUSED" },
    });
    const pausedStatus = await getMetaMutationObjectStatus({
      ...input,
      step: `activate.verify_guard_paused.${campaignId}`,
      objectId: campaignId,
    });
    if (!statusConfirmsPaused(pausedStatus)) {
      throw new Error(
        `Meta campaign ${campaignId} was not confirmed PAUSED, so activation stopped before child delivery could start.`,
      );
    }
  }

  if (input.mutation.payload.adSetBudgets?.length) {
    await applyBudgetMutations(input);
  }

  for (const objectId of mutationChildObjectIds(input.mutation.payload, campaignId)) {
    await postMetaMutation({
      ...input,
      step: `activate.${objectId}`,
      path: `/${objectId}`,
      body: { status: "ACTIVE" },
    });
  }

  if (campaignId) {
    await postMetaMutation({
      ...input,
      step: `activate.${campaignId}`,
      path: `/${campaignId}`,
      body: { status: "ACTIVE" },
    });
  }

  for (const objectId of mutationObjectIds(input.mutation.payload)) {
    const activeStatus = await getMetaMutationObjectStatus({
      ...input,
      step: `activate.verify_active.${objectId}`,
      objectId,
    });
    if (!statusConfirmsActive(activeStatus)) {
      throw new Error(`Meta activation for ${objectId} was not confirmed ACTIVE.`);
    }
  }
}

async function applyBudgetMutations(input: {
  mutation: MetaPlanMutation;
  accessToken: string;
  graphVersion?: string;
  fetchImpl?: typeof fetch;
  onCheckpoint?: (result: MetaMutationExecutionResult) => Promise<void>;
  requestLog: MetaMutationLogEntry[];
  responseLog: MetaMutationLogEntry[];
}) {
  for (const budget of input.mutation.payload.adSetBudgets ?? []) {
    await postMetaMutation({
      ...input,
      step: `budget.${budget.adSetId}`,
      path: `/${budget.adSetId}`,
      body: { daily_budget: String(budget.dailyBudgetMinorUnits) },
    });
  }
}

/**
 * A POST can reach Meta even when its response never reaches the worker. On
 * any activation failure, pause every target (campaign first) and then inspect
 * its configured status. Compensation appends logs in memory but skips the
 * applying-state checkpoint entirely; the caller persists the returned final
 * result only after all bounded safety I/O has finished.
 */
async function compensateFailedActivation(input: {
  mutation: MetaPlanMutation;
  accessToken: string;
  graphVersion?: string;
  fetchImpl?: typeof fetch;
  onCheckpoint?: (result: MetaMutationExecutionResult) => Promise<void>;
  requestLog: MetaMutationLogEntry[];
  responseLog: MetaMutationLogEntry[];
}): Promise<string[]> {
  const objectIds = mutationObjectIds(input.mutation.payload);
  const operationSignal = AbortSignal.timeout(META_ACTIVATION_COMPENSATION_TIMEOUT_MS);

  for (const objectId of objectIds) {
    try {
      await postMetaMutation({
        ...input,
        onCheckpoint: undefined,
        step: `activate.compensate_pause.${objectId}`,
        path: `/${objectId}`,
        body: { status: "PAUSED" },
        operationSignal,
      });
    } catch {
      // Verification below can still prove that an unanswered or rejected
      // pause left the object safely paused.
    }
  }

  const unconfirmedIds: string[] = [];
  for (const objectId of objectIds) {
    try {
      const status = await getMetaMutationObjectStatus({
        ...input,
        onCheckpoint: undefined,
        step: `activate.verify_paused.${objectId}`,
        objectId,
        operationSignal,
      });
      if (!statusConfirmsPaused(status)) {
        unconfirmedIds.push(objectId);
      }
    } catch {
      unconfirmedIds.push(objectId);
    }
  }

  return unconfirmedIds;
}

function mutationObjectIds(payload: MetaPlanMutationPayload): string[] {
  return uniqueObjectIds([
    payload.campaignId,
    ...(payload.adSetIds ?? []),
    ...(payload.adIds ?? []),
  ]);
}

function mutationChildObjectIds(
  payload: MetaPlanMutationPayload,
  campaignId: string | null,
): string[] {
  return uniqueObjectIds([
    ...(payload.adSetIds ?? []),
    ...(payload.adIds ?? []),
  ]).filter((objectId) => objectId !== campaignId);
}

function uniqueObjectIds(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(normalizedObjectId).filter((value): value is string => Boolean(value)))];
}

function normalizedObjectId(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function statusConfirmsPaused(payload: Record<string, unknown>): boolean {
  const configuredStatus = normalizedStatus(payload.configured_status);
  if (configuredStatus) return configuredStatus === "PAUSED";

  const status = normalizedStatus(payload.status);
  if (status) return status === "PAUSED";

  const effectiveStatus = normalizedStatus(payload.effective_status);
  return effectiveStatus === "PAUSED" || effectiveStatus?.endsWith("_PAUSED") === true;
}

function statusConfirmsActive(payload: Record<string, unknown>): boolean {
  const configuredStatus = normalizedStatus(payload.configured_status);
  if (configuredStatus) return configuredStatus === "ACTIVE";

  const status = normalizedStatus(payload.status);
  if (status) return status === "ACTIVE";

  return normalizedStatus(payload.effective_status) === "ACTIVE";
}

function normalizedStatus(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toUpperCase() : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Meta mutation failed.";
}

async function checkpointMetaMutationProgress(input: {
  onCheckpoint?: (result: MetaMutationExecutionResult) => Promise<void>;
  requestLog: MetaMutationLogEntry[];
  responseLog: MetaMutationLogEntry[];
}) {
  if (!input.onCheckpoint) return;

  await input.onCheckpoint(metaMutationCheckpoint(input));
}

function metaMutationCheckpoint(input: {
  requestLog: MetaMutationLogEntry[];
  responseLog: MetaMutationLogEntry[];
}): MetaMutationExecutionResult {
  return {
    status: "applying",
    requestLog: [...input.requestLog],
    responseLog: [...input.responseLog],
    lastError: null,
  };
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
  onCheckpoint?: (result: MetaMutationExecutionResult) => Promise<void>;
  requestLog: MetaMutationLogEntry[];
  responseLog: MetaMutationLogEntry[];
  step: string;
  path: string;
  body: Record<string, unknown>;
  operationSignal?: AbortSignal;
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
  await checkpointMetaMutationProgress(input);

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input.body),
    signal: metaMutationRequestSignal(input.operationSignal),
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
  let checkpointError: unknown = null;
  try {
    await checkpointMetaMutationProgress(input);
  } catch (error) {
    checkpointError = error;
  }
  if (!response.ok) {
    const error = payload.error as { message?: string } | undefined;
    throw new Error(error?.message ?? `Meta mutation ${input.step} failed with ${response.status}.`);
  }
  if (checkpointError) throw checkpointError;
}

async function getMetaMutationObjectStatus(input: {
  accessToken: string;
  graphVersion?: string;
  fetchImpl?: typeof fetch;
  onCheckpoint?: (result: MetaMutationExecutionResult) => Promise<void>;
  requestLog: MetaMutationLogEntry[];
  responseLog: MetaMutationLogEntry[];
  step: string;
  objectId: string;
  operationSignal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const path = `/${input.objectId}?fields=configured_status,effective_status,status`;
  const createdAt = new Date().toISOString();
  const url = `https://graph.facebook.com/${input.graphVersion ?? DEFAULT_META_GRAPH_VERSION}${path}`;

  input.requestLog.push({
    step: input.step,
    method: "GET",
    path,
    createdAt,
  });
  await checkpointMetaMutationProgress(input);

  const response = await fetchImpl(url, {
    method: "GET",
    headers: { authorization: `Bearer ${input.accessToken}` },
    signal: metaMutationRequestSignal(input.operationSignal),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  input.responseLog.push({
    step: input.step,
    method: "GET",
    path,
    response: payload,
    status: response.status,
    createdAt: new Date().toISOString(),
  });
  let checkpointError: unknown = null;
  try {
    await checkpointMetaMutationProgress(input);
  } catch (error) {
    checkpointError = error;
  }
  if (!response.ok) {
    const error = payload.error as { message?: string } | undefined;
    throw new Error(error?.message ?? `Meta mutation ${input.step} failed with ${response.status}.`);
  }
  if (checkpointError) throw checkpointError;
  return payload;
}

function metaMutationRequestSignal(operationSignal?: AbortSignal): AbortSignal {
  const requestTimeout = AbortSignal.timeout(META_MUTATION_REQUEST_TIMEOUT_MS);
  return operationSignal
    ? AbortSignal.any([operationSignal, requestTimeout])
    : requestTimeout;
}
