export const FREE_TRIAL_RENDER_LIMIT = 6;
export const RENDERS_PER_AD_PACK = 2;
export const TRIAL_UPGRADE_HREF = "/settings#billing";

export type TrialStatus = {
  isTrial: true;
  /** pending_delivery until Meta first reports actual delivery, then active. */
  trialState: "pending_delivery" | "active" | null;
  includedRenders: number;
  usedRenders: number;
  remainingRenders: number;
  planName: string | null;
  trialEndsAt: string | null;
  trialDaysRemaining: number | null;
  trialExpired: boolean;
  upgradeHref: string;
};

type TrialRpcResult = {
  data: unknown;
  error: unknown;
};

type TrialRpc = (
  functionName: "get_trial_status",
  parameters: { target_workspace_id: string },
) => PromiseLike<TrialRpcResult>;

export async function loadTrialStatus(
  rpc: TrialRpc,
  workspaceId: string | undefined,
): Promise<TrialStatus | null> {
  if (!workspaceId) return null;

  try {
    const { data, error } = await rpc("get_trial_status", {
      target_workspace_id: workspaceId,
    });
    return error ? null : normalizeTrialStatus(data);
  } catch {
    return null;
  }
}

export function adPacksForRenders(renders: number): number {
  return Math.floor(Math.max(0, renders) / RENDERS_PER_AD_PACK);
}

function normalizeTrialStatus(value: unknown): TrialStatus | null {
  const row = firstRecord(value);
  if (!row) return null;
  const planKey = row.plan_key ?? row.planKey;
  if (planKey !== "trial" && row.is_trial !== true && row.isTrial !== true) {
    return null;
  }

  const includedRenders = renderValue(
    row.credits_granted ?? row.render_limit ?? row.included_renders,
    row.ad_packs_limit ?? row.included_ad_packs,
  );
  const usedRenders = renderValue(
    row.credits_consumed ?? row.renders_used ?? row.used_renders,
    row.ad_packs_used ?? row.used_ad_packs,
  );
  const remainingRenders = renderValue(
    row.credits_remaining ?? row.renders_remaining ?? row.remaining_renders,
    row.ad_packs_remaining ?? row.remaining_ad_packs,
  );

  // A status without the wallet-derived grant is not trustworthy. The current
  // trial entitlement is six renders (three Feed + Story ad packs).
  if (
    includedRenders === null ||
    usedRenders === null ||
    remainingRenders === null ||
    includedRenders !== FREE_TRIAL_RENDER_LIMIT
  ) {
    return null;
  }

  const trialState =
    row.trial_state === "pending_delivery" || row.trialState === "pending_delivery"
      ? "pending_delivery"
      : row.trial_state === "active" || row.trialState === "active"
        ? "active"
        : null;

  return {
    isTrial: true,
    trialState,
    includedRenders,
    usedRenders: Math.min(includedRenders, Math.max(0, usedRenders)),
    remainingRenders: Math.min(
      includedRenders,
      Math.max(0, remainingRenders),
    ),
    planName:
      typeof (row.plan_name ?? row.planName) === "string"
        ? String(row.plan_name ?? row.planName)
        : null,
    trialEndsAt:
      typeof (row.trial_ends_at ?? row.trialEndsAt) === "string"
        ? String(row.trial_ends_at ?? row.trialEndsAt)
        : null,
    trialDaysRemaining:
      row.trial_days_remaining === null ||
      row.trial_days_remaining === undefined
        ? null
        : numeric(row.trial_days_remaining),
    trialExpired: Boolean(row.trial_expired ?? row.trialExpired),
    upgradeHref: TRIAL_UPGRADE_HREF,
  };
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return firstRecord(value[0]);
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function renderValue(
  directValue: unknown,
  adPackValue: unknown,
): number | null {
  const direct = numeric(directValue);
  if (direct !== null) return direct;
  const adPacks = numeric(adPackValue);
  return adPacks === null ? null : adPacks * RENDERS_PER_AD_PACK;
}

function numeric(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
