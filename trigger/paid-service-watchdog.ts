import { schedules } from "@trigger.dev/sdk/v3";

import {
  collectPaidServiceStatuses,
  diffForAlerts,
  formatAlert,
  toState,
  type WatchdogState,
} from "../src/lib/alerts/paid-service-watchdog.ts";
import { sendPaidServiceAlert } from "../src/lib/alerts/notify.ts";
import { createSupabaseServiceClient } from "../src/lib/supabase/service.ts";

const STATE_KEY = "paid_service_watchdog_state";

/**
 * Every 2 hours: poll paid-service usage/health, compare against the last
 * alerted level stored in research.runtime_settings, and email + WhatsApp on
 * escalation or recovery. Frequent enough to catch credits running out while
 * customers are generating ads, silent while nothing changes.
 */
export const paidServiceWatchdog = schedules.task({
  id: "paid-service-watchdog",
  cron: "0 */2 * * *",
  run: async () => {
    const supabase = createSupabaseServiceClient();
    const statuses = await collectPaidServiceStatuses(supabase);

    let previous: WatchdogState = {};
    try {
      const { data } = await supabase
        .schema("research")
        .from("runtime_settings")
        .select("setting_value")
        .eq("setting_key", STATE_KEY)
        .maybeSingle();
      if (data?.setting_value && typeof data.setting_value === "object") {
        previous = data.setting_value as WatchdogState;
      }
    } catch (err) {
      // Missing state means we alert as if everything was previously ok —
      // noisier is safer than silent.
      console.error("Watchdog state load failed", err);
    }

    const diff = diffForAlerts(previous, statuses);
    let delivery: { email: boolean; whatsapp: boolean } | null = null;
    if (diff.escalations.length > 0 || diff.recoveries.length > 0) {
      delivery = await sendPaidServiceAlert(formatAlert(diff, statuses));
    }

    try {
      await supabase
        .schema("research")
        .from("runtime_settings")
        .upsert({
          setting_key: STATE_KEY,
          setting_value: toState(statuses),
          description: "Last alerted level per paid service (paid-service-watchdog).",
          updated_by: "paid-service-watchdog",
        });
    } catch (err) {
      console.error("Watchdog state save failed", err);
    }

    return {
      statuses,
      escalations: diff.escalations.map((s) => s.service),
      recoveries: diff.recoveries.map((s) => s.service),
      delivery,
    };
  },
});
