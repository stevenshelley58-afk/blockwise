import { schedules } from "@trigger.dev/sdk/v3";

import { runPaidServiceWatchdog } from "../src/lib/alerts/paid-service-runner.ts";
import { createSupabaseServiceClient } from "../src/lib/supabase/service.ts";

/**
 * Every 2 hours: poll paid-service usage/health, compare against the last
 * alerted level stored in research.runtime_settings, and email + WhatsApp on
 * escalation or recovery. Frequent enough to catch credits running out while
 * customers are generating ads, silent while nothing changes.
 */
export const paidServiceWatchdog = schedules.task({
  id: "paid-service-watchdog",
  cron: "0 */2 * * *",
  run: async () => runPaidServiceWatchdog(createSupabaseServiceClient()),
});
