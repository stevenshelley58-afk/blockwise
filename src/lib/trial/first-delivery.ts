import type { createSupabaseServiceClient } from "../supabase/service.ts";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/**
 * True when a Meta reporting payload reflects actual delivery: live
 * (non-demo, non-empty) data with at least one impression. Signup, publishing,
 * and approval never satisfy this — Meta must have reported delivery itself.
 */
export function reportIndicatesMetaDelivery(payload: {
  source?: unknown;
  connected?: unknown;
  summary?: { impressions?: unknown } | null;
}): boolean {
  return (
    payload.source === "live" &&
    payload.connected === true &&
    typeof payload.summary?.impressions === "number" &&
    Number.isFinite(payload.summary.impressions) &&
    payload.summary.impressions > 0
  );
}

/**
 * Start the 14-day no-card app trial the first time Meta reports delivery.
 * Durable and idempotent server-side: only a pending_delivery workspace
 * transitions, so duplicate or out-of-order delivery reports are no-ops.
 */
export async function startTrialOnFirstDelivery(input: {
  service: ServiceClient;
  workspaceId: string;
  deliveredAt?: Date;
}): Promise<boolean> {
  const { data, error } = await input.service.rpc("start_trial_on_first_delivery", {
    p_workspace_id: input.workspaceId,
    p_delivery_at: (input.deliveredAt ?? new Date()).toISOString(),
  });
  if (error) throw new Error(`Trial delivery start failed: ${error.message}`);
  return data === true;
}

export async function startTrialOnFirstDeliveryBestEffort(input: {
  service: ServiceClient;
  workspaceId: string;
  deliveredAt?: Date;
}): Promise<boolean> {
  try {
    return await startTrialOnFirstDelivery(input);
  } catch (error) {
    console.error("[trial] failed to start trial on first delivery", {
      workspaceId: input.workspaceId,
      error,
    });
    return false;
  }
}
