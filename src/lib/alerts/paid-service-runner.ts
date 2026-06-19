import type { SupabaseClient } from "@supabase/supabase-js";

import {
  collectPaidServiceStatuses,
  diffForAlerts,
  formatAlert,
  toState,
  type ServiceStatus,
  type WatchdogState,
} from "./paid-service-watchdog.ts";
import { sendPaidServiceAlert } from "./notify.ts";
import type { AlertMessage } from "./notify.ts";

export const PAID_SERVICE_WATCHDOG_STATE_KEY = "paid_service_watchdog_state";

// Seams so the alerting wiring (escalate-at-WARN-and-CRITICAL) is unit-testable
// without live provider polling. Production uses the real collect/send.
export type PaidServiceWatchdogDeps = {
  collect?: (supabase: SupabaseClient) => Promise<ServiceStatus[]>;
  send?: (message: AlertMessage) => Promise<{ email: boolean; whatsapp: boolean }>;
};

export async function runPaidServiceWatchdog(
  supabase: SupabaseClient,
  deps: PaidServiceWatchdogDeps = {},
) {
  const collect = deps.collect ?? collectPaidServiceStatuses;
  const send = deps.send ?? sendPaidServiceAlert;

  const statuses = await collect(supabase);
  const previous = await loadPreviousWatchdogState(supabase);
  const diff = diffForAlerts(previous, statuses);
  let delivery: { email: boolean; whatsapp: boolean } | null = null;

  // diffForAlerts escalates on every level rise (ok→warn, warn→critical,
  // ok→critical), so both the 80% WARN and 95% CRITICAL thresholds email.
  if (diff.escalations.length > 0 || diff.recoveries.length > 0) {
    delivery = await send(formatAlert(diff, statuses));
  }

  await saveWatchdogState(supabase, toState(statuses));

  return {
    statuses,
    escalations: diff.escalations.map((s) => s.service),
    recoveries: diff.recoveries.map((s) => s.service),
    delivery,
  };
}

async function loadPreviousWatchdogState(supabase: SupabaseClient): Promise<WatchdogState> {
  try {
    const { data } = await supabase
      .schema("research")
      .from("runtime_settings")
      .select("setting_value")
      .eq("setting_key", PAID_SERVICE_WATCHDOG_STATE_KEY)
      .maybeSingle();

    if (data?.setting_value && typeof data.setting_value === "object") {
      return data.setting_value as WatchdogState;
    }
  } catch (err) {
    console.error("Watchdog state load failed", err);
  }

  return {};
}

async function saveWatchdogState(supabase: SupabaseClient, state: WatchdogState) {
  try {
    await supabase
      .schema("research")
      .from("runtime_settings")
      .upsert({
        setting_key: PAID_SERVICE_WATCHDOG_STATE_KEY,
        setting_value: state,
        description: "Last alerted level per paid service (paid-service-watchdog).",
        updated_by: "paid-service-watchdog",
      });
  } catch (err) {
    console.error("Watchdog state save failed", err);
  }
}
