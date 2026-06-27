import { schedules } from "@trigger.dev/sdk/v3";
import * as Sentry from "@sentry/nextjs";

import { runAdRadarAccuracyAudit } from "../src/lib/research/ad-radar-accuracy-audit.ts";
import { createSupabaseServiceClient } from "../src/lib/supabase/service.ts";

export const weeklyAdRadarAccuracyAuditTask = schedules.task({
  id: "research.ad-radar.accuracy.weekly",
  cron: {
    pattern: "0 8 * * 1",
    timezone: "Australia/Perth",
  },
  run: async () => {
    try {
      return await runAdRadarAccuracyAudit(createSupabaseServiceClient());
    } catch (error) {
      Sentry.captureException(error);
      throw error;
    }
  },
});
