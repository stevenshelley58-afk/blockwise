import { randomUUID } from "node:crypto";

import type { ApprovalStatus } from "../publishing/readiness.ts";
import {
  getDurablyCreatedMetaObjects,
  type MetaPublishPlan,
} from "./meta-execution.ts";
import { DEFAULT_META_GRAPH_VERSION } from "./meta-graph-version.ts";

export type MetaPlanMutationAction = "activate" | "pause" | "increase_budget" | "export_leads";
export type MetaPlanMutationStatus = "requested" | "approved" | "applying" | "applied" | "failed";

export type MetaPlanMutationPayload = {
  campaignId?: string;
  adSetIds?: string[];
  adIds?: string[];
  reusedCampaignId?: string;
  reusedAdSetIds?: string[];
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

/**
 * Activation ownership comes from a server-recorded successful create exchange,
 * never from IDs posted by the browser. Reused parents are carried only for a
 * GET-only active-status preflight and are never activation targets.
 */
export function buildOwnedMetaActivationPayload(plan: MetaPublishPlan): MetaPlanMutationPayload {
  const target = plan.controls.target;
  if (!target) throw new Error("The publish plan has no explicit Meta parent target.");
  const durablyCreated = getDurablyCreatedMetaObjects(plan);

  const payload: MetaPlanMutationPayload = { adSetIds: [], adIds: [] };
  if (target.mode === "new_campaign_new_adset") {
    const ownedCampaignId = normalizedObjectId(durablyCreated.campaignId);
    if (!ownedCampaignId || ownedCampaignId !== normalizedObjectId(plan.reconciledObjects.campaignId)) {
      throw new Error("The publish plan cannot prove ownership of its Meta campaign; activation is blocked.");
    }
    payload.campaignId = ownedCampaignId;
  } else {
    const reusedCampaignId = normalizedObjectId(target.campaignId);
    if (!reusedCampaignId || reusedCampaignId !== normalizedObjectId(plan.reconciledObjects.campaignId)) {
      throw new Error("The selected reused campaign no longer matches the publish plan; activation is blocked.");
    }
    payload.reusedCampaignId = reusedCampaignId;
  }

  const reusedAdSetIds: string[] = [];
  for (const adSet of plan.adSets) {
    const reconciledId = normalizedObjectId(plan.reconciledObjects.adSetIds[adSet.localId]);
    if (!reconciledId) throw new Error(`Meta ad set ${adSet.localId} was not reconciled; activation is blocked.`);
    if (adSet.existingId) {
      if (reconciledId !== normalizedObjectId(adSet.existingId)) {
        throw new Error(`Reused Meta ad set ${adSet.localId} changed; activation is blocked.`);
      }
      reusedAdSetIds.push(reconciledId);
    } else {
      if (normalizedObjectId(durablyCreated.adSetIds[adSet.localId]) !== reconciledId) {
        throw new Error(`The publish plan cannot prove ownership of Meta ad set ${adSet.localId}; activation is blocked.`);
      }
      payload.adSetIds!.push(reconciledId);
    }
  }
  if (target.mode === "existing_adset") {
    if (!sameObjectIds(reusedAdSetIds, target.adSetIds)) {
      throw new Error("The reused Meta ad-set selection changed; activation is blocked.");
    }
    payload.reusedAdSetIds = uniqueObjectIds(reusedAdSetIds);
  } else if (reusedAdSetIds.length > 0) {
    throw new Error("The publish plan unexpectedly contains reused ad sets; activation is blocked.");
  }

  for (const ad of plan.ads) {
    const reconciledId = normalizedObjectId(plan.reconciledObjects.adIds[ad.localId]);
    if (!reconciledId || normalizedObjectId(durablyCreated.adIds[ad.localId]) !== reconciledId) {
      throw new Error(`The publish plan cannot prove ownership of Meta ad ${ad.localId}; activation is blocked.`);
    }
    payload.adIds!.push(reconciledId);
  }
  if (payload.adIds!.length === 0) throw new Error("The publish plan has no owned Meta ads to activate.");
  payload.adSetIds = uniqueObjectIds(payload.adSetIds ?? []);
  payload.adIds = uniqueObjectIds(payload.adIds ?? []);
  return payload;
}

export function buildOwnedMetaPausePayload(plan: MetaPublishPlan): MetaPlanMutationPayload {
  const durablyCreated = getDurablyCreatedMetaObjects(plan);
  const payload: MetaPlanMutationPayload = {
    ...(durablyCreated.campaignId ? { campaignId: durablyCreated.campaignId } : {}),
    adSetIds: uniqueObjectIds(Object.values(durablyCreated.adSetIds)),
    adIds: uniqueObjectIds(Object.values(durablyCreated.adIds)),
  };
  if (mutationObjectIds(payload).length === 0) {
    throw new Error("The publish plan has no durably created Meta objects to pause.");
  }
  return payload;
}

export function buildOwnedMetaBudgetPayload(
  plan: MetaPublishPlan,
  dailyBudgetMinorUnits: number,
): MetaPlanMutationPayload {
  if (!Number.isInteger(dailyBudgetMinorUnits) || dailyBudgetMinorUnits <= 0) {
    throw new Error("Meta daily budget must be a positive integer in minor units.");
  }
  const adSetIds = uniqueObjectIds(Object.values(getDurablyCreatedMetaObjects(plan).adSetIds));
  if (adSetIds.length === 0) {
    throw new Error("The publish plan has no durably created Meta ad sets whose budget can be changed.");
  }
  return {
    adSetBudgets: adSetIds.map((adSetId) => ({ adSetId, dailyBudgetMinorUnits })),
  };
}

export function assertMetaPlanMutationTargetsOwned(
  plan: MetaPublishPlan,
  mutation: MetaPlanMutation,
) {
  if (mutation.planId !== plan.planId || mutation.workspaceId !== plan.workspaceId) {
    throw new Error("The queued Meta mutation does not belong to its publish plan.");
  }

  const payload = mutation.payload;
  if (mutation.action === "activate") {
    const target = plan.controls.target;
    const created = getDurablyCreatedMetaObjects(plan);
    const allowedAdSetIds = new Set(uniqueObjectIds(Object.values(created.adSetIds)));
    const allowedAdIds = new Set(uniqueObjectIds(Object.values(created.adIds)));
    const campaignId = normalizedObjectId(payload.campaignId);
    const reusedCampaignId = normalizedObjectId(payload.reusedCampaignId);
    const expectedReusedCampaignId = target && target.mode !== "new_campaign_new_adset"
      ? normalizedObjectId(target.campaignId)
      : null;
    const expectedReusedAdSetIds = target?.mode === "existing_adset"
      ? uniqueObjectIds(target.adSetIds)
      : [];
    if (
      (campaignId !== null && campaignId !== normalizedObjectId(created.campaignId)) ||
      (expectedReusedCampaignId !== null && campaignId !== null) ||
      reusedCampaignId !== expectedReusedCampaignId ||
      uniqueObjectIds(payload.adSetIds ?? []).some((id) => !allowedAdSetIds.has(id)) ||
      uniqueObjectIds(payload.adIds ?? []).some((id) => !allowedAdIds.has(id)) ||
      !sameObjectIds(payload.reusedAdSetIds ?? [], expectedReusedAdSetIds) ||
      mutationObjectIds(payload).length === 0
    ) {
      throw new Error("The queued Meta activation targets do not match the plan's durably owned objects.");
    }
    assertOwnedBudgetTargets(plan, payload.adSetBudgets ?? []);
    return;
  }

  if (mutation.action === "pause") {
    const expected = buildOwnedMetaPausePayload(plan);
    if (
      normalizedObjectId(payload.campaignId) !== normalizedObjectId(expected.campaignId) ||
      !sameObjectIds(payload.adSetIds ?? [], expected.adSetIds ?? []) ||
      !sameObjectIds(payload.adIds ?? [], expected.adIds ?? []) ||
      normalizedObjectId(payload.reusedCampaignId) ||
      uniqueObjectIds(payload.reusedAdSetIds ?? []).length > 0 ||
      (payload.adSetBudgets?.length ?? 0) > 0
    ) {
      throw new Error("The queued Meta pause targets do not match the plan's durably owned objects.");
    }
    return;
  }

  if (mutation.action === "increase_budget") {
    if (!payload.adSetBudgets?.length) {
      throw new Error("A Meta budget mutation requires at least one durably owned ad set.");
    }
    if (
      normalizedObjectId(payload.campaignId) ||
      normalizedObjectId(payload.reusedCampaignId) ||
      uniqueObjectIds(payload.adSetIds ?? []).length > 0 ||
      uniqueObjectIds(payload.adIds ?? []).length > 0 ||
      uniqueObjectIds(payload.reusedAdSetIds ?? []).length > 0
    ) {
      throw new Error("A Meta budget mutation may target only durably owned ad sets.");
    }
    assertOwnedBudgetTargets(plan, payload.adSetBudgets);
    return;
  }

  if (mutationObjectIds(payload).length > 0 || uniqueObjectIds([
    payload.reusedCampaignId,
    ...(payload.reusedAdSetIds ?? []),
    ...(payload.adSetBudgets ?? []).map((budget) => budget.adSetId),
  ]).length > 0) {
    throw new Error("A Meta lead export cannot contain provider object mutation targets.");
  }
}

function assertOwnedBudgetTargets(
  plan: MetaPublishPlan,
  budgets: NonNullable<MetaPlanMutationPayload["adSetBudgets"]>,
) {
  if (budgets.length === 0) return;
  const ownedIds = new Set(uniqueObjectIds(Object.values(getDurablyCreatedMetaObjects(plan).adSetIds)));
  const seen = new Set<string>();
  for (const budget of budgets) {
    const adSetId = normalizedObjectId(budget.adSetId);
    if (
      !adSetId ||
      !ownedIds.has(adSetId) ||
      seen.has(adSetId) ||
      !Number.isInteger(budget.dailyBudgetMinorUnits) ||
      budget.dailyBudgetMinorUnits <= 0
    ) {
      throw new Error(`Meta ad set ${adSetId ?? "unknown"} lacks durable ownership proof for this budget mutation.`);
    }
    seen.add(adSetId);
  }
}

export async function executeMetaPlanMutation(input: {
  mutation: MetaPlanMutation;
  publishPlan: MetaPublishPlan | null;
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
  if (input.mutation.planId) {
    if (!input.publishPlan) {
      throw new Error("A plan-backed Meta mutation requires its authoritative publish plan.");
    }
    assertMetaPlanMutationTargetsOwned(input.publishPlan, input.mutation);
  } else if (input.mutation.action !== "export_leads") {
    throw new Error("Meta provider mutations without durable publish-plan ownership proof are blocked.");
  }

  const requestLog = [...input.mutation.requestLog];
  const responseLog = [...input.mutation.responseLog];
  if (input.mutation.action === "activate") {
    try {
      await verifyReusedActivationParents({ ...input, requestLog, responseLog });
    } catch (error) {
      return {
        status: "failed",
        requestLog,
        responseLog,
        lastError: errorMessage(error),
      };
    }
  }

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

/** GET-only preflight. A paused/stale reused parent fails before any ACTIVE or PAUSED POST. */
async function verifyReusedActivationParents(input: {
  mutation: MetaPlanMutation;
  accessToken: string;
  graphVersion?: string;
  fetchImpl?: typeof fetch;
  onCheckpoint?: (result: MetaMutationExecutionResult) => Promise<void>;
  requestLog: MetaMutationLogEntry[];
  responseLog: MetaMutationLogEntry[];
}) {
  const ownedAdSetIds = new Set(uniqueObjectIds(input.mutation.payload.adSetIds ?? []));
  for (const budget of input.mutation.payload.adSetBudgets ?? []) {
    if (!ownedAdSetIds.has(budget.adSetId)) {
      throw new Error(`Activation cannot change the budget of reused Meta ad set ${budget.adSetId}.`);
    }
  }

  const reusedParents = [
    ...uniqueObjectIds([input.mutation.payload.reusedCampaignId]).map((id) => ({ kind: "campaign", id })),
    ...uniqueObjectIds(input.mutation.payload.reusedAdSetIds ?? []).map((id) => ({ kind: "ad set", id })),
  ];
  for (const parent of reusedParents) {
    const status = await getMetaMutationObjectStatus({
      ...input,
      step: `activate.preflight_reused_${parent.kind.replace(" ", "_")}.${parent.id}`,
      objectId: parent.id,
    });
    if (!reusedParentConfirmsActive(status)) {
      throw new Error(`The reused Meta ${parent.kind} ${parent.id} is not active; activation made no provider writes.`);
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

function sameObjectIds(left: string[], right: string[]): boolean {
  const normalizedLeft = uniqueObjectIds(left).sort();
  const normalizedRight = uniqueObjectIds(right).sort();
  return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((id, index) => id === normalizedRight[index]);
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

function reusedParentConfirmsActive(payload: Record<string, unknown>): boolean {
  return normalizedStatus(payload.configured_status) === "ACTIVE" &&
    normalizedStatus(payload.effective_status) === "ACTIVE";
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
