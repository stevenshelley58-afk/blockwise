import * as Sentry from "@sentry/nextjs";
import { after } from "next/server";

import { ConfirmRegistrationTracker } from "@/components/confirm-registration-tracker";
import { HomeDashboard } from "@/components/self-serve/home-dashboard";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { loadHomeDashboardData } from "@/lib/home/home-dashboard-data";
import { queueReportingRefresh } from "@/lib/meta-monitor/reporting-refresh-queue";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function SelfServeHome() {
  const { supabase, access } = await requirePageSurfaceAccess("self_serve");
  const serviceSupabase = createSupabaseServiceClient();
  const loaded = await Sentry.startSpan(
    {
      name: "Load Home dashboard snapshot",
      op: "db.home_dashboard",
      attributes: { "workspace.id": access.workspaceId },
    },
    () => loadHomeDashboardData({
      supabase,
      serviceSupabase,
      workspaceId: access.workspaceId,
      workspaceName: access.workspaceName,
    }),
  );

  if (loaded.reportingNeedsRefresh) {
    after(() => queueReportingRefresh({
      workspaceId: access.workspaceId,
      range: "last_30",
      reason: "stale_navigation",
    }).catch(() => undefined));
  }

  return (
    <>
      <ConfirmRegistrationTracker />
      <HomeDashboard data={loaded.data} />
    </>
  );
}
