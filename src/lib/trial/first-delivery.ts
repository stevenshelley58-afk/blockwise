import type { createSupabaseServiceClient } from "../supabase/service.ts";
import { offerVersionRunsCheckoutTrial } from "../billing/offers.ts";

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
 * True when this workspace is on a self-serve offer whose trial starts at
 * verified Checkout completion. Such a workspace must never have its trial
 * started, restarted or extended by a Meta delivery report.
 *
 * Read from the workspace's recorded accepted offer, not from "the offer
 * version is not the current one", so the rule cannot change meaning when a
 * version is bumped. A read failure returns false: the delivery hook is a
 * legacy path and must stay available to legacy cohorts.
 */
async function workspaceRunsCheckoutTrial(
  service: ServiceClient,
  workspaceId: string,
): Promise<boolean> {
  try {
    const { data, error } = await service
      .from("workspaces")
      .select("billing_offer_key, billing_offer_version")
      .eq("id", workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const row = data as { billing_offer_key?: unknown; billing_offer_version?: unknown } | null;
    const offerKey = typeof row?.billing_offer_key === "string" ? row.billing_offer_key : "";
    const offerVersion =
      typeof row?.billing_offer_version === "string" ? row.billing_offer_version : null;
    return offerKey.startsWith("ad_studio_") && offerVersionRunsCheckoutTrial("ad_studio", offerVersion);
  } catch (error) {
    console.error("[trial] could not resolve the workspace trial cohort", { workspaceId, error });
    return false;
  }
}

/**
 * Start the legacy 14-day no-card app trial the first time Meta reports
 * delivery.
 *
 * No-op for the current self-serve offer, whose trial starts at Checkout and
 * whose 168 hours must not be shortened, restarted or extended by delivery.
 * Legacy cohorts keep the original behaviour. Durable and idempotent
 * server-side: only a pending_delivery workspace transitions, so duplicate or
 * out-of-order delivery reports are no-ops.
 */
export async function startTrialOnFirstDelivery(input: {
  service: ServiceClient;
  workspaceId: string;
  deliveredAt?: Date;
}): Promise<boolean> {
  if (await workspaceRunsCheckoutTrial(input.service, input.workspaceId)) {
    return false;
  }

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
